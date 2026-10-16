import { AsyncLocalStorage } from "node:async_hooks";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  API_FEATURE_LABELS,
  ApiCreditLimitError,
  DEFAULT_API_CREDIT_LIMIT_USD,
  estimateApiCostUsd,
  normalizeApiCreditLimit,
  type ApiCreditEntry,
  type ApiCreditStatus,
  type ApiFeature,
} from "@/lib/api-credits";

type Scope = { projectId: string; feature: ApiFeature };

type UsageDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  feature: ApiFeature;
  provider: string;
  model: string;
  costMicros: number;
  createdAt: Date;
};

const COLLECTION = "api_credit_usage";

type CreditGlobal = typeof globalThis & {
  __nexusesApiCredit?: AsyncLocalStorage<Scope>;
};

function creditStorage() {
  const holder = globalThis as CreditGlobal;
  holder.__nexusesApiCredit ??= new AsyncLocalStorage<Scope>();
  return holder.__nexusesApiCredit;
}

let indexesReady: Promise<unknown> | null = null;

function usdToMicros(usd: number) {
  return Math.max(1, Math.round(usd * 1_000_000));
}

function microsToUsd(micros: number) {
  return Math.round(micros) / 1_000_000;
}

async function usageCollection() {
  const db = await getDb();
  const collection = db.collection<UsageDoc>(COLLECTION);
  indexesReady ??= collection
    .createIndex({ projectId: 1, createdAt: -1 })
    .catch((error) => {
      indexesReady = null;
      console.error("Failed to create API credit index:", error);
    });
  await indexesReady;
  return collection;
}

async function projectLimitUsd(projectId: ObjectId) {
  const db = await getDb();
  const project = await db
    .collection<{ apiCreditLimitUsd?: number }>("projects")
    .findOne({ _id: projectId }, { projection: { apiCreditLimitUsd: 1 } });
  return normalizeApiCreditLimit(
    project?.apiCreditLimitUsd ?? DEFAULT_API_CREDIT_LIMIT_USD,
  );
}

async function usedMicros(projectId: ObjectId) {
  const collection = await usageCollection();
  const [row] = await collection
    .aggregate<{ costMicros: number }>([
      { $match: { projectId } },
      { $group: { _id: null, costMicros: { $sum: "$costMicros" } } },
    ])
    .toArray();
  return row?.costMicros ?? 0;
}

export async function assertApiCredit(projectId: string) {
  if (!ObjectId.isValid(projectId)) return;
  const id = new ObjectId(projectId);
  const [limitUsd, spent] = await Promise.all([projectLimitUsd(id), usedMicros(id)]);
  if (microsToUsd(spent) >= limitUsd) {
    throw new ApiCreditLimitError(limitUsd);
  }
}

/** Bills the rest of this request to the project. Uses one shared store so every API call can see it. */
export async function bindApiCredit(projectId: string, feature: ApiFeature) {
  await assertApiCredit(projectId);
  creditStorage().enterWith({ projectId, feature });
}

/** Runs fn while AI calls inside it are billed to this project and feature. */
export async function runInApiCredit<T>(
  projectId: string,
  feature: ApiFeature,
  fn: () => Promise<T>,
) {
  await assertApiCredit(projectId);
  return creditStorage().run({ projectId, feature }, fn);
}

/** Throws when the in-progress request's project is already at its dollar limit. */
export async function guardApiCredit() {
  const scope = creditStorage().getStore();
  if (!scope) return;
  await assertApiCredit(scope.projectId);
}

/** Records one paid API call. Pass projectId when this call is outside a billed request. */
export async function noteApiUsage(input: {
  projectId?: string;
  feature?: ApiFeature;
  provider: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  flatUsd?: number;
  kind?: "chat" | "image" | "search";
}) {
  const scope = creditStorage().getStore();
  const projectId = input.projectId || scope?.projectId;
  const feature = input.feature || scope?.feature;
  if (!projectId || !feature || !ObjectId.isValid(projectId)) return;
  const costMicros = usdToMicros(
    estimateApiCostUsd({
      provider: input.provider,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      flatUsd: input.flatUsd,
      kind: input.kind,
    }),
  );
  try {
    const collection = await usageCollection();
    await collection.insertOne({
      _id: new ObjectId(),
      projectId: new ObjectId(projectId),
      feature,
      provider: input.provider,
      model: input.model?.trim() || input.provider,
      costMicros,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error("Failed to record API credit:", error);
  }
}

export function readTokenUsage(usage: unknown) {
  if (!usage || typeof usage !== "object") {
    return { inputTokens: 0, outputTokens: 0 };
  }
  const row = usage as {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  return {
    inputTokens: Number(row.prompt_tokens ?? row.input_tokens) || 0,
    outputTokens: Number(row.completion_tokens ?? row.output_tokens) || 0,
  };
}

export async function getApiCreditStatus(projectId: string): Promise<ApiCreditStatus> {
  const id = new ObjectId(projectId);
  const collection = await usageCollection();
  const [limitUsd, rows, latest] = await Promise.all([
    projectLimitUsd(id),
    collection
      .aggregate<{ _id: ApiFeature; calls: number; costMicros: number }>([
        { $match: { projectId: id } },
        {
          $group: {
            _id: "$feature",
            calls: { $sum: 1 },
            costMicros: { $sum: "$costMicros" },
          },
        },
        { $sort: { costMicros: -1 } },
      ])
      .toArray(),
    collection.find({ projectId: id }).sort({ createdAt: -1 }).limit(40).toArray(),
  ]);
  const items = rows
    .filter((row) => row._id in API_FEATURE_LABELS)
    .map((row) => ({
      feature: row._id,
      label: API_FEATURE_LABELS[row._id],
      calls: row.calls,
      costUsd: microsToUsd(row.costMicros),
    }));
  const recent: ApiCreditEntry[] = latest
    .filter((row) => row.feature in API_FEATURE_LABELS)
    .map((row) => ({
      feature: row.feature,
      label: API_FEATURE_LABELS[row.feature],
      provider: row.provider,
      model: row.model,
      costUsd: microsToUsd(row.costMicros),
      createdAt: row.createdAt.toISOString(),
    }));
  const usedUsd = microsToUsd(rows.reduce((sum, row) => sum + row.costMicros, 0));
  return {
    limitUsd,
    usedUsd,
    remainingUsd: Math.max(0, Math.round((limitUsd - usedUsd) * 1_000_000) / 1_000_000),
    items,
    recent,
  };
}

/** Dollars used so far, for the admin project list. */
export async function getApiCreditUsedByProject(projectIds: ObjectId[]) {
  const totals = new Map<string, number>();
  if (projectIds.length === 0) return totals;
  const collection = await usageCollection();
  const rows = await collection
    .aggregate<{ _id: ObjectId; costMicros: number }>([
      { $match: { projectId: { $in: projectIds } } },
      { $group: { _id: "$projectId", costMicros: { $sum: "$costMicros" } } },
    ])
    .toArray();
  for (const row of rows) {
    totals.set(row._id.toString(), microsToUsd(row.costMicros));
  }
  return totals;
}
