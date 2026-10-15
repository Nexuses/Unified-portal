import { MongoClient, type Collection, type Document, type Filter, type ObjectId } from "mongodb";
import type { ContactDoc, ListMembershipDoc } from "@/lib/crm";
import { getDb } from "@/lib/mongodb";
import { getSuppressionSets, isSuppressedAddress } from "@/lib/unsubscribe-server";
import {
  ENRICH_EMPLOYEE_SIZE_LABELS,
  ENRICH_REVENUE_RANGE_LABELS,
  filterEnrichRecords,
  type DataToolRecord,
  type EnrichOptions,
  type EnrichSearchFilters,
} from "@/lib/datatool";

const OPTIONS_SAMPLE_SIZE = 5000;
const RANGE_SCAN_CAP = 50_000;
const QUERY_TIMEOUT_MS = 20_000;

const globalForDataTool = globalThis as typeof globalThis & {
  dataToolMongo?: { uri: string; client: Promise<MongoClient> };
};

function getConfig() {
  const uri = process.env.DATATOOL_MONGODB_URI?.trim();
  const dbName = process.env.DATATOOL_MONGODB_DB?.trim() || undefined;
  const collection = process.env.DATATOOL_MONGODB_COLLECTION?.trim() || "datarecords";
  if (!uri) {
    throw new Error("Enrich database is not set. Add DATATOOL_MONGODB_URI to .env.local.");
  }
  return { uri, dbName, collection };
}

export async function getDataToolDb() {
  const { uri, dbName } = getConfig();
  if (globalForDataTool.dataToolMongo?.uri !== uri) {
    globalForDataTool.dataToolMongo = {
      uri,
      client: new MongoClient(uri).connect(),
    };
  }
  const client = await globalForDataTool.dataToolMongo.client;
  return client.db(dbName);
}

export async function getRecordsCollection(): Promise<Collection<Document>> {
  const db = await getDataToolDb();
  return db.collection(getConfig().collection);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clean(values: string[] | undefined) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function anyOf(values: string[]) {
  return { $regex: values.map(escapeRegex).join("|"), $options: "i" };
}

function buildQuery(filters: EnrichSearchFilters): Filter<Document> {
  const and: Filter<Document>[] = [{ recordType: "people" }];
  const titles = clean(filters.titles);
  const levels = clean(filters.managementLevels);
  const industries = clean(filters.industryKeywords);
  const techs = clean(filters.technologies);
  const personLocs = clean(filters.personLocations);
  const companyLocs = clean(filters.companyLocations);

  if (titles.length > 0) {
    and.push({ title: anyOf(titles) });
  }
  if (levels.length > 0) {
    and.push({ $or: [{ seniority: anyOf(levels) }, { title: anyOf(levels) }] });
  }
  if (industries.length > 0) {
    and.push({ industry: anyOf(industries) });
  }
  if (techs.length > 0) {
    and.push({ technologies: anyOf(techs) });
  }
  if (personLocs.length > 0) {
    and.push({ contact_country: anyOf(personLocs) });
  }
  if (companyLocs.length > 0) {
    and.push({
      $or: [{ company_country: anyOf(companyLocs) }, { company_address: anyOf(companyLocs) }],
    });
  }
  return and.length === 1 ? and[0] : { $and: and };
}

function toRecord(doc: Document): DataToolRecord {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    id: String(rest.id ?? _id),
    type: String(rest.recordType ?? rest.type ?? "people"),
  } as DataToolRecord;
}

function pushUnique(target: Set<string>, value: unknown, splitMulti = false) {
  const text = String(value ?? "").trim();
  if (!text) {
    return;
  }
  if (!splitMulti) {
    target.add(text);
    return;
  }
  for (const part of text.split(/[,|;/]+/)) {
    const item = part.trim();
    if (item) {
      target.add(item);
    }
  }
}

function sortedOptions(values: Set<string>) {
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

const OPTIONS_CACHE_MS = 10 * 60 * 1000;
let optionsCache: { at: number; value: EnrichOptions } | null = null;

/** Distinct dropdown values from a random sample of people records. */
export async function collectEnrichOptions(input?: { q?: string }): Promise<EnrichOptions> {
  const q = input?.q?.trim();
  if (!q && optionsCache && Date.now() - optionsCache.at < OPTIONS_CACHE_MS) {
    return optionsCache.value;
  }
  const options = await loadEnrichOptions(q);
  if (!q) {
    optionsCache = { at: Date.now(), value: options };
  }
  return options;
}

async function loadEnrichOptions(q: string | undefined): Promise<EnrichOptions> {
  const collection = await getRecordsCollection();
  const match: Filter<Document> = q
    ? {
        recordType: "people",
        $or: ["title", "seniority", "industry", "technologies", "contact_country", "company_country"].map(
          (field) => ({ [field]: anyOf([q]) }),
        ),
      }
    : { recordType: "people" };

  const [docs, total] = await Promise.all([
    collection
      .aggregate(
        [
          { $match: match },
          { $sample: { size: OPTIONS_SAMPLE_SIZE } },
          {
            $project: {
              title: 1,
              seniority: 1,
              industry: 1,
              technologies: 1,
              contact_country: 1,
              company_country: 1,
              company_address: 1,
            },
          },
        ],
        { maxTimeMS: QUERY_TIMEOUT_MS },
      )
      .toArray(),
    collection.countDocuments(match, { maxTimeMS: QUERY_TIMEOUT_MS }),
  ]);

  const titles = new Set<string>();
  const managementLevels = new Set<string>();
  const industryKeywords = new Set<string>();
  const technologies = new Set<string>();
  const personLocations = new Set<string>();
  const companyLocations = new Set<string>();
  for (const doc of docs) {
    pushUnique(titles, doc.title);
    pushUnique(managementLevels, doc.seniority);
    pushUnique(industryKeywords, doc.industry, true);
    pushUnique(technologies, doc.technologies, true);
    pushUnique(personLocations, doc.contact_country);
    pushUnique(companyLocations, doc.company_country);
    pushUnique(companyLocations, doc.company_address);
  }

  return {
    titles: sortedOptions(titles),
    managementLevels: sortedOptions(managementLevels),
    employeeSizes: [...ENRICH_EMPLOYEE_SIZE_LABELS],
    industryKeywords: sortedOptions(industryKeywords),
    revenueRanges: [...ENRICH_REVENUE_RANGE_LABELS],
    technologies: sortedOptions(technologies),
    personLocations: sortedOptions(personLocations),
    companyLocations: sortedOptions(companyLocations),
    scanned: docs.length,
    total,
  };
}

const SUGGEST_FIELDS: Record<string, { field: string; multi: boolean }> = {
  titles: { field: "title", multi: false },
  managementLevels: { field: "seniority", multi: false },
  industryKeywords: { field: "industry", multi: true },
  technologies: { field: "technologies", multi: true },
  personLocations: { field: "contact_country", multi: false },
  companyLocations: { field: "company_country", multi: false },
};

export function isSuggestField(key: string) {
  return key in SUGGEST_FIELDS;
}

/** Values of one filter field containing `q`, most common first. */
export async function suggestEnrichValues(key: string, q: string, limit = 50) {
  const config = SUGGEST_FIELDS[key];
  const text = q.trim();
  if (!config || text.length < 2) {
    return [];
  }
  const collection = await getRecordsCollection();
  const match = { recordType: "people", [config.field]: anyOf([text]) };

  if (!config.multi) {
    const rows = await collection
      .aggregate<{ _id: unknown; n: number }>(
        [
          { $match: match },
          { $group: { _id: `$${config.field}`, n: { $sum: 1 } } },
          { $sort: { n: -1, _id: 1 } },
          { $limit: limit },
        ],
        { maxTimeMS: QUERY_TIMEOUT_MS },
      )
      .toArray();
    return rows
      .map((row) => ({ value: String(row._id ?? "").trim(), count: row.n }))
      .filter((row) => row.value);
  }

  // Industry and technologies hold comma-separated lists, so count the matching parts.
  const docs = await collection
    .find(match, { projection: { [config.field]: 1 }, maxTimeMS: QUERY_TIMEOUT_MS })
    .limit(5000)
    .toArray();
  const needle = text.toLowerCase();
  const counts = new Map<string, number>();
  for (const doc of docs) {
    for (const part of String(doc[config.field] ?? "").split(/[,|;/]+/)) {
      const value = part.trim();
      if (value && value.toLowerCase().includes(needle)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

export type EnrichExclusions = {
  projectId: ObjectId;
  unsubscribed?: boolean;
  existing?: boolean;
};

const LISTED_EMAILS_CACHE_MS = 60 * 1000;
const listedEmailsCache = new Map<string, { at: number; emails: Promise<Set<string>> }>();

/** Lowercased emails of project contacts that belong to at least one CRM list. */
export function emailsAlreadyInLists(projectId: ObjectId) {
  const key = projectId.toString();
  const cached = listedEmailsCache.get(key);
  if (cached && Date.now() - cached.at < LISTED_EMAILS_CACHE_MS) {
    return cached.emails;
  }
  const emails = (async () => {
    const db = await getDb();
    const listedIds = new Set(
      (
        await db
          .collection<ListMembershipDoc>("list_memberships")
          .distinct("contactId", { projectId })
      ).map((id) => String(id)),
    );
    const result = new Set<string>();
    const cursor = db
      .collection<ContactDoc>("contacts")
      .find({ projectId })
      .project<{ _id: ObjectId; email?: string }>({ _id: 1, email: 1 });
    for await (const contact of cursor) {
      if (contact.email && listedIds.has(contact._id.toString())) {
        result.add(contact.email.trim().toLowerCase());
      }
    }
    return result;
  })();
  listedEmailsCache.set(key, { at: Date.now(), emails });
  emails.catch(() => listedEmailsCache.delete(key));
  return emails;
}

const SUPPRESSION_CACHE_MS = 5 * 60 * 1000;
const suppressionCache = new Map<
  string,
  { at: number; sets: ReturnType<typeof getSuppressionSets> }
>();

export function suppressionFor(projectId: ObjectId) {
  const key = projectId.toString();
  const cached = suppressionCache.get(key);
  if (cached && Date.now() - cached.at < SUPPRESSION_CACHE_MS) {
    return cached.sets;
  }
  const sets = getSuppressionSets(projectId);
  suppressionCache.set(key, { at: Date.now(), sets });
  sets.catch(() => suppressionCache.delete(key));
  return sets;
}

/** Start loading exclusion data so the Remove buttons respond quickly. */
function warmExclusions(projectId: ObjectId) {
  void suppressionFor(projectId).catch(() => undefined);
  void emailsAlreadyInLists(projectId).catch(() => undefined);
}

const SCAN_CACHE_MS = 2 * 60 * 1000;
type ScanResult = {
  ids: ObjectId[];
  scanned: number;
  removedUnsubscribed: number;
  removedExisting: number;
};
const scanCache = new Map<string, { at: number; result: Promise<ScanResult> }>();

/** Ids of every match after range filters and exclusions, in stable _id order. */
async function scanMatches(
  collection: Collection<Document>,
  query: Filter<Document>,
  rangeFilters: EnrichSearchFilters,
  hasRangeFilters: boolean,
  exclude: EnrichExclusions | undefined,
): Promise<ScanResult> {
  const [suppression, listed] = await Promise.all([
    exclude?.unsubscribed ? suppressionFor(exclude.projectId) : null,
    exclude?.existing ? emailsAlreadyInLists(exclude.projectId) : null,
  ]);
  const ids: ObjectId[] = [];
  let scanned = 0;
  let removedUnsubscribed = 0;
  let removedExisting = 0;
  const cursor = collection
    .find(query, {
      projection: { email: 1, employees: 1, annual_revenue: 1 },
      maxTimeMS: QUERY_TIMEOUT_MS,
    })
    .batchSize(5000);
  for await (const doc of cursor) {
    scanned += 1;
    if (hasRangeFilters && filterEnrichRecords([toRecord(doc)], rangeFilters).length === 0) {
      continue;
    }
    const email = String(doc.email ?? "").trim().toLowerCase();
    if (suppression && isSuppressedAddress(email, suppression)) {
      removedUnsubscribed += 1;
    } else if (listed && email && listed.has(email)) {
      removedExisting += 1;
    } else {
      ids.push(doc._id as ObjectId);
    }
    if (scanned >= RANGE_SCAN_CAP) {
      break;
    }
  }
  await cursor.close();
  ids.sort((a, b) => a.toString().localeCompare(b.toString()));
  return { ids, scanned, removedUnsubscribed, removedExisting };
}

const countCache = new Map<string, { at: number; result: Promise<{ unsubscribed: number; existing: number }> }>();

/** Within the first `maxResults` matches, how many each Remove button would hide (counted independently). */
export function countEnrichExclusions(
  filters: EnrichSearchFilters,
  projectId: ObjectId,
  maxResults: number,
) {
  const key = JSON.stringify([projectId.toString(), maxResults, filters]);
  const cached = countCache.get(key);
  if (cached && Date.now() - cached.at < SCAN_CACHE_MS) {
    return cached.result;
  }
  const result = (async () => {
    const collection = await getRecordsCollection();
    const rangeFilters: EnrichSearchFilters = {
      employeeSizes: clean(filters.employeeSizes),
      revenueRanges: clean(filters.revenueRanges),
    };
    const hasRangeFilters =
      (rangeFilters.employeeSizes?.length ?? 0) > 0 ||
      (rangeFilters.revenueRanges?.length ?? 0) > 0;
    const [suppression, listed] = await Promise.all([
      suppressionFor(projectId),
      emailsAlreadyInLists(projectId),
    ]);
    const matches: Array<{ id: string; email: string }> = [];
    let scanned = 0;
    const cursor = collection
      .find(buildQuery(filters), {
        projection: { email: 1, employees: 1, annual_revenue: 1 },
        maxTimeMS: QUERY_TIMEOUT_MS,
      })
      .batchSize(5000);
    for await (const doc of cursor) {
      scanned += 1;
      if (hasRangeFilters && filterEnrichRecords([toRecord(doc)], rangeFilters).length === 0) {
        continue;
      }
      matches.push({ id: String(doc._id), email: String(doc.email ?? "").trim().toLowerCase() });
      if (scanned >= RANGE_SCAN_CAP) {
        break;
      }
    }
    await cursor.close();
    matches.sort((a, b) => a.id.localeCompare(b.id));
    let unsubscribed = 0;
    let existing = 0;
    for (const { email } of matches.slice(0, maxResults)) {
      if (isSuppressedAddress(email, suppression)) {
        unsubscribed += 1;
      }
      if (email && listed.has(email)) {
        existing += 1;
      }
    }
    return { unsubscribed, existing };
  })();
  countCache.set(key, { at: Date.now(), result });
  result.catch(() => countCache.delete(key));
  for (const [entryKey, entry] of countCache) {
    if (Date.now() - entry.at > SCAN_CACHE_MS) {
      countCache.delete(entryKey);
    }
  }
  return result;
}

export async function searchEnrichPeople(
  filters: EnrichSearchFilters,
  options?: { page?: number; limit?: number; exclude?: EnrichExclusions },
) {
  const collection = await getRecordsCollection();
  const page = Math.max(1, options?.page || 1);
  const limit = Math.min(1000, Math.max(1, options?.limit || 200));
  const skip = (page - 1) * limit;
  const query = buildQuery(filters);
  const exclude = options?.exclude;
  const excludeUnsubscribed = Boolean(exclude?.unsubscribed);
  const excludeExisting = Boolean(exclude?.existing);

  const rangeFilters: EnrichSearchFilters = {
    employeeSizes: clean(filters.employeeSizes),
    revenueRanges: clean(filters.revenueRanges),
  };
  const hasRangeFilters =
    (rangeFilters.employeeSizes?.length ?? 0) > 0 ||
    (rangeFilters.revenueRanges?.length ?? 0) > 0;

  if (exclude) {
    warmExclusions(exclude.projectId);
  }

  if (!hasRangeFilters && !excludeUnsubscribed && !excludeExisting) {
    const [total, docs] = await Promise.all([
      collection.countDocuments(query, { maxTimeMS: QUERY_TIMEOUT_MS }),
      collection
        .find(query, { maxTimeMS: QUERY_TIMEOUT_MS })
        .sort({ _id: 1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
    ]);
    const records = docs.map(toRecord);
    return {
      page,
      limit,
      total,
      scanned: total,
      matched: records.length,
      records,
      removedUnsubscribed: 0,
      removedExisting: 0,
    };
  }

  // Size/revenue are free text and exclusions live in the portal database, so these are checked in code
  // on a slim projection; full records are loaded only for the requested page.
  const cacheKey = JSON.stringify([
    exclude?.projectId.toString() ?? "",
    excludeUnsubscribed,
    excludeExisting,
    filters,
  ]);
  let scan = scanCache.get(cacheKey);
  if (!scan || Date.now() - scan.at > SCAN_CACHE_MS) {
    scan = { at: Date.now(), result: scanMatches(collection, query, rangeFilters, hasRangeFilters, exclude) };
    scanCache.set(cacheKey, scan);
    scan.result.catch(() => scanCache.delete(cacheKey));
    for (const [key, entry] of scanCache) {
      if (Date.now() - entry.at > SCAN_CACHE_MS) {
        scanCache.delete(key);
      }
    }
  }
  const { ids, scanned, removedUnsubscribed, removedExisting } = await scan.result;
  const total = ids.length;
  const pageIds = ids.slice(skip, skip + limit);

  const pageDocs =
    pageIds.length === 0
      ? []
      : await collection.find({ _id: { $in: pageIds } }, { maxTimeMS: QUERY_TIMEOUT_MS }).toArray();
  const byId = new Map(pageDocs.map((doc) => [String(doc._id), doc]));
  const records = pageIds
    .map((id) => byId.get(String(id)))
    .filter((doc) => doc !== undefined)
    .map(toRecord);

  return {
    page,
    limit,
    total,
    scanned,
    matched: records.length,
    records,
    removedUnsubscribed,
    removedExisting,
  };
}
