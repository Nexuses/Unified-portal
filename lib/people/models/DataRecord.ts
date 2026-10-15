import type { Document, Filter, Sort } from "mongodb";
import { getRecordsCollection } from "@/lib/datatool-server";
import type { DataView } from "@/lib/people/data-views";

export interface IDataRecord {
  _id: unknown;
  recordType: DataView;
  sourceFile: string;
  isUsed: boolean;
  createdAt: Date;
  updatedAt: Date;
  [field: string]: unknown;
}

type Projection = string | Record<string, 0 | 1>;

function toProjection(select: Projection | undefined) {
  if (!select) return undefined;
  if (typeof select !== "string") return select;
  return Object.fromEntries(
    select
      .split(/\s+/)
      .filter(Boolean)
      .map((field) => (field.startsWith("-") ? [field.slice(1), 0] : [field, 1])),
  );
}

/** Lazy, awaitable query: runs once when first awaited, like a mongoose query. */
abstract class LazyQuery<T> implements PromiseLike<T> {
  private promise?: Promise<T>;

  protected abstract run(): Promise<T>;

  private start() {
    this.promise ??= this.run();
    return this.promise;
  }

  then<A = T, B = never>(
    onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.start().then(onFulfilled, onRejected);
  }

  catch<B = never>(onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<T | B> {
    return this.start().catch(onRejected);
  }
}

class FindQuery<T> extends LazyQuery<T[]> {
  private projection?: Projection;
  private sortSpec?: Sort;
  private skipCount = 0;
  private limitCount = 0;
  private timeoutMs = 20_000;

  constructor(private readonly filter: Filter<Document>) {
    super();
  }

  select(projection: Projection) {
    this.projection = projection;
    return this;
  }
  sort(spec: Sort) {
    this.sortSpec = spec;
    return this;
  }
  skip(count: number) {
    this.skipCount = count;
    return this;
  }
  limit(count: number) {
    this.limitCount = count;
    return this;
  }
  maxTimeMS(ms: number) {
    this.timeoutMs = ms;
    return this;
  }
  lean<R = T[]>() {
    return this as unknown as LazyQuery<R>;
  }

  protected async run() {
    const collection = await getRecordsCollection();
    let cursor = collection.find(this.filter, {
      projection: toProjection(this.projection),
      maxTimeMS: this.timeoutMs,
    });
    if (this.sortSpec) cursor = cursor.sort(this.sortSpec);
    if (this.skipCount) cursor = cursor.skip(this.skipCount);
    if (this.limitCount) cursor = cursor.limit(this.limitCount);
    return (await cursor.toArray()) as T[];
  }
}

class CountQuery extends LazyQuery<number> {
  private timeoutMs = 20_000;

  constructor(private readonly filter: Filter<Document>) {
    super();
  }

  maxTimeMS(ms: number) {
    this.timeoutMs = ms;
    return this;
  }

  protected async run() {
    const collection = await getRecordsCollection();
    return collection.countDocuments(this.filter, { maxTimeMS: this.timeoutMs });
  }
}

class AggregateQuery<T extends Document> extends LazyQuery<T[]> {
  private options: { maxTimeMS?: number; allowDiskUse?: boolean } = { maxTimeMS: 30_000 };

  constructor(private readonly pipeline: Document[]) {
    super();
  }

  option(options: { maxTimeMS?: number; allowDiskUse?: boolean }) {
    this.options = { ...this.options, ...options };
    return this;
  }

  protected async run() {
    const collection = await getRecordsCollection();
    return collection.aggregate<T>(this.pipeline, this.options).toArray();
  }
}

export const DataRecord = {
  find<T = IDataRecord>(filter: Filter<Document> = {}) {
    return new FindQuery<T>(filter);
  },
  countDocuments(filter: Filter<Document> = {}) {
    return new CountQuery(filter);
  },
  // Untyped by default, matching mongoose's aggregate().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aggregate<T extends Document = any>(pipeline: Document[]) {
    return new AggregateQuery<T>(pipeline);
  },
};
