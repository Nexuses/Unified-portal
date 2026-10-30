import { ObjectId, type Document, type Filter } from "mongodb";
import { DATA_HEADERS } from "@/lib/people/data-headers";
import { buildExpandedHighlights } from "@/lib/people/expand-highlight-terms";
import {
  getFilterSidebarMeta,
  warmFilterSidebarMeta,
} from "@/lib/people/filter-sidebar-cache";
import { buildTechnologyFacets } from "@/lib/people/technologies";
import {
  buildDataRecordsFilter,
  parseDataRecordsQuery,
} from "@/lib/people/data-records-query";
import { DataRecord, type IDataRecord } from "@/lib/people/models/DataRecord";
import {
  emailsAlreadyInLists,
  getRecordsCollection,
  projectListSavedScope,
  suppressionFor,
} from "@/lib/datatool-server";
import { isSuppressedAddress } from "@/lib/unsubscribe-server";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 5000;
const EXCLUSION_SCAN_CAP = 50_000;
const SCAN_CACHE_MS = 2 * 60 * 1000;
const MAX_RECORDS_BY_IDS = 25_000;

export type EnrichPeopleRecord = { id: string } & Record<(typeof DATA_HEADERS)[number], string>;

type Exclusions = { unsubscribed: boolean; existing: boolean };

function parseExclusions(searchParams: URLSearchParams): Exclusions {
  return {
    unsubscribed: searchParams.get("excludeUnsubscribed") === "1",
    existing: searchParams.get("excludeExisting") === "1",
  };
}

function toRecord(record: IDataRecord | Document): EnrichPeopleRecord {
  return {
    id: String(record._id),
    ...Object.fromEntries(
      DATA_HEADERS.map((header) => [header, String(record[header] ?? "")])
    ),
  } as EnrichPeopleRecord;
}

type ScanResult = {
  ids: string[];
  scanned: number;
  capped: boolean;
  removedUnsubscribed: number;
  removedExisting: number;
};

const scanCache = new Map<string, { at: number; result: Promise<ScanResult> }>();

/** Newest-first ids of matches that survive the exclusions, scanned on a slim projection. */
function scanWithExclusions(
  projectId: ObjectId,
  recordsFilter: Filter<Document>,
  exclusions: Exclusions
): Promise<ScanResult> {
  const key = JSON.stringify([projectId.toString(), exclusions, recordsFilter]);
  const cached = scanCache.get(key);
  if (cached && Date.now() - cached.at < SCAN_CACHE_MS) {
    return cached.result;
  }
  const result = (async () => {
    const [suppression, listed, collection] = await Promise.all([
      exclusions.unsubscribed ? suppressionFor(projectId) : null,
      exclusions.existing ? emailsAlreadyInLists(projectId) : null,
      getRecordsCollection(),
    ]);
    const ids: string[] = [];
    let scanned = 0;
    let capped = false;
    let removedUnsubscribed = 0;
    let removedExisting = 0;
    const cursor = collection
      .find(recordsFilter, { projection: { email: 1 }, maxTimeMS: 30_000 })
      .sort({ createdAt: -1 })
      .batchSize(5000);
    for await (const doc of cursor) {
      scanned += 1;
      const email = String(doc.email ?? "").trim().toLowerCase();
      if (suppression && isSuppressedAddress(email, suppression)) {
        removedUnsubscribed += 1;
      } else if (listed && email && listed.has(email)) {
        removedExisting += 1;
      } else {
        ids.push(String(doc._id));
      }
      if (scanned >= EXCLUSION_SCAN_CAP) {
        capped = true;
        break;
      }
    }
    await cursor.close();
    return { ids, scanned, capped, removedUnsubscribed, removedExisting };
  })();
  scanCache.set(key, { at: Date.now(), result });
  result.catch(() => scanCache.delete(key));
  for (const [entryKey, entry] of scanCache) {
    if (Date.now() - entry.at > SCAN_CACHE_MS) {
      scanCache.delete(entryKey);
    }
  }
  return result;
}

async function fetchRecordsByIds(ids: string[]) {
  const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  if (objectIds.length === 0) return [];
  const collection = await getRecordsCollection();
  const projection = Object.fromEntries(DATA_HEADERS.map((header) => [header, 1]));
  const docs = await collection
    .find({ _id: { $in: objectIds } }, { projection, maxTimeMS: 30_000 })
    .toArray();
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
  return ids.flatMap((id) => {
    const doc = byId.get(id);
    return doc ? [toRecord(doc)] : [];
  });
}

export async function getEnrichPeopleRecordsByIds(ids: string[]) {
  return fetchRecordsByIds(Array.from(new Set(ids)).slice(0, MAX_RECORDS_BY_IDS));
}

/** Permanently remove enrich people rows from the DataTool records collection. */
export async function deleteEnrichPeopleRecordsByIds(ids: string[]) {
  const unique = Array.from(new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))).slice(
    0,
    MAX_RECORDS_BY_IDS,
  );
  const objectIds = unique.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  if (objectIds.length === 0) {
    return { deleted: 0 };
  }
  const collection = await getRecordsCollection();
  const result = await collection.deleteMany({
    _id: { $in: objectIds },
    recordType: "people",
  });
  return { deleted: result.deletedCount ?? 0 };
}

/**
 * Same contract as the data tool's `GET /api/data` (people view), plus
 * `excludeUnsubscribed=1` / `excludeExisting=1`, which drop matches that are
 * unsubscribed or already in one of this project's lists.
 */
export async function queryEnrichPeople(searchParams: URLSearchParams, projectId: ObjectId) {
  const params = new URLSearchParams(searchParams);
  params.set("view", "people");
  params.delete("listId");

  const page = Math.max(1, Number(params.get("page") || "1"));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(params.get("limit") || String(DEFAULT_LIMIT)))
  );
  const includeFacets = params.get("includeFacets") !== "0";
  const includeRecords = params.get("includeRecords") !== "0";
  const includeCounts = params.get("includeCounts") !== "0";
  const exclusions = parseExclusions(params);
  const hasExclusions = exclusions.unsubscribed || exclusions.existing;

  const query = parseDataRecordsQuery(params);
  const { stat, jobTitleFilter, industryKeywordsFilter } = query;

  const savedScope = await projectListSavedScope(projectId);
  const {
    baseFilter,
    recordsFilter,
    distinctTitles,
    distinctDepartments,
    distinctIndustries,
    aliasOverrides,
  } = await buildDataRecordsFilter(query, {
    resolvedView: "people",
    projectSavedScope: {
      emails: savedScope.emails,
      recordIds: savedScope.recordIds,
    },
  });

  if (params.get("idsOnly") === "true") {
    return { ids: await selectMatchingIds(params, recordsFilter, projectId, exclusions) };
  }

  const scanPromise = hasExclusions
    ? scanWithExclusions(projectId, recordsFilter as Filter<Document>, exclusions)
    : null;

  const recordsPromise: Promise<EnrichPeopleRecord[]> = !includeRecords
    ? Promise.resolve([])
    : scanPromise
      ? scanPromise.then((scan) =>
          fetchRecordsByIds(scan.ids.slice((page - 1) * limit, page * limit))
        )
      : DataRecord.find(recordsFilter)
          .select(DATA_HEADERS.join(" "))
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .maxTimeMS(20_000)
          .lean<IDataRecord[]>()
          .then((rows) => rows.map(toRecord));

  // Total from DataTool; Saved from CRM list membership (no DataTool join).
  const statsPromise = includeCounts
    ? (async () => {
        const totalAgg = await DataRecord.aggregate<{ total: number }>([
          { $match: baseFilter },
          { $group: { _id: null, total: { $sum: 1 } } },
        ]).option({ maxTimeMS: 30_000 });
        const total = Number(totalAgg[0]?.total ?? 0);
        const saved = Math.min(
          savedScope.listedCount || savedScope.emails.length,
          total,
        );
        return [{ total, saved, netNew: Math.max(0, total - saved) }];
      })().catch((error) => {
        console.error("[enrich/people] stats failed", error);
        return [] as Array<{ total: number; netNew: number; saved: number }>;
      })
    : Promise.resolve([] as Array<{ total: number; netNew: number; saved: number }>);

  // Facets must never take down / delay the table: catch and continue with null.
  const sidebarPromise = includeFacets
    ? getFilterSidebarMeta("people").catch((error) => {
        console.error("[enrich/people] sidebar meta failed", error);
        return null;
      })
    : Promise.resolve(null);
  if (!includeFacets) {
    warmFilterSidebarMeta("people");
  }

  const [records, statsAgg, sidebarMeta, scan] = await Promise.all([
    recordsPromise,
    statsPromise,
    sidebarPromise,
    scanPromise ?? Promise.resolve(null),
  ]);

  const stats = statsAgg[0] ?? { total: 0, netNew: 0, saved: 0 };
  const rawTotal = Number(stats.total ?? 0);
  const rawSaved = Number(stats.saved ?? 0);
  const rawNetNew = Number(stats.netNew ?? 0);
  const statTotal =
    stat === "net_new" ? rawNetNew : stat === "saved" ? rawSaved : rawTotal;

  // Remove chips can only reduce counts — never replace them with a larger scan size.
  // (Net New's Mongo filter is intentionally loose for speed; a full exclusion scan
  // can match more rows than the CRM-based Net New number, which previously inflated it.)
  const removedU = scan && exclusions.unsubscribed ? scan.removedUnsubscribed : 0;
  const removedE = scan && exclusions.existing ? scan.removedExisting : 0;
  const removedFromStat = removedU + removedE;

  let statsTotal = rawTotal;
  let statsSaved = rawSaved;
  let statsNetNew = rawNetNew;
  if (scan && hasExclusions) {
    // Subtract removals from Net New / Total only. Do NOT also cut Saved by
    // removedExisting — that cancels out (netNew = total - saved stays flat).
    statsNetNew = Math.max(0, rawNetNew - removedFromStat);
    statsTotal = Math.max(0, rawTotal - removedFromStat);
    statsSaved = Math.min(rawSaved, statsTotal);
  }

  const total = scan
    ? Math.min(
        Math.max(0, statTotal - removedFromStat),
        scan.capped
          ? Math.max(scan.ids.length, Math.max(0, statTotal - removedFromStat))
          : scan.ids.length,
      )
    : statTotal;

  const rawFacets = sidebarMeta?.facets ?? {};
  const facets: Record<string, string[]> = Object.fromEntries(
    Object.entries(rawFacets).map(([key, rows]) => [
      key,
      rows
        .map((row) => row._id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .sort((a, b) => a.localeCompare(b)),
    ])
  );
  const facetCounts: Record<string, Record<string, number>> = Object.fromEntries(
    Object.entries(rawFacets).map(([key, rows]) => [
      key,
      Object.fromEntries(
        rows
          .filter((row) => typeof row._id === "string" && row._id.length > 0)
          .map((row) => [row._id, Number(row.count ?? 0)])
      ),
    ])
  );

  if (sidebarMeta) {
    const technologyFacets = buildTechnologyFacets(rawFacets.technologies ?? []);
    facets.technologies = technologyFacets.options;
    facetCounts.technologies = technologyFacets.counts;
  }

  const expandedHighlights = buildExpandedHighlights({
    jobTitleFilter,
    industryKeywordsFilter,
    titleCorpus: facets.jobTitles ?? distinctTitles,
    departmentCorpus: facets.departments ?? distinctDepartments,
    industryCorpus: facets.industryKeywords ?? distinctIndustries,
    aliasOverrides,
  });

  return {
    records,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    stats: {
      total: statsTotal,
      netNew: statsNetNew,
      saved: statsSaved,
    },
    exclusions: scan
      ? {
          removedUnsubscribed: scan.removedUnsubscribed,
          removedExisting: scan.removedExisting,
          scanned: scan.scanned,
          capped: scan.capped,
        }
      : null,
    ...(sidebarMeta
      ? {
          facets,
          facetCounts,
          managementLevelCounts: sidebarMeta.managementLevelCounts,
          employeeRangeCounts: sidebarMeta.employeeRangeCounts,
          peopleSuggestions: sidebarMeta.peopleSuggestions,
        }
      : {}),
    expandedHighlights,
  };
}

/** Non-empty email — save-to-list only includes these contacts. */
const HAS_EMAIL_FILTER: Filter<Document> = {
  email: { $type: "string", $gt: "" },
};

function withEmailRequirement(
  recordsFilter: Record<string, unknown>,
  requireEmail: boolean,
): Filter<Document> {
  if (!requireEmail) return recordsFilter as Filter<Document>;
  return { $and: [recordsFilter, HAS_EMAIL_FILTER] };
}

async function selectMatchingIds(
  params: URLSearchParams,
  recordsFilter: Record<string, unknown>,
  projectId: ObjectId,
  exclusions: Exclusions
): Promise<string[]> {
  const selectLimitRaw = Number(params.get("selectLimit") || "");
  const maxPerCompanyRaw = Number(params.get("maxPerCompany") || "");
  const selectLimit =
    Number.isFinite(selectLimitRaw) && selectLimitRaw > 0 ? Math.floor(selectLimitRaw) : null;
  const maxPerCompany =
    Number.isFinite(maxPerCompanyRaw) && maxPerCompanyRaw > 0
      ? Math.floor(maxPerCompanyRaw)
      : null;
  const hasExclusions = exclusions.unsubscribed || exclusions.existing;
  const requireEmail = params.get("requireEmail") === "1";
  const matchFilter = withEmailRequirement(recordsFilter, requireEmail);

  let ids: string[];
  if (maxPerCompany) {
    const pipeline: Document[] = [
      { $match: matchFilter },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { $toLower: { $trim: { input: { $ifNull: ["$company_name", ""] } } } },
          ids: { $push: "$_id" },
          firstCreated: { $first: "$createdAt" },
        },
      },
      { $project: { ids: { $slice: ["$ids", maxPerCompany] }, firstCreated: 1 } },
      { $sort: { firstCreated: -1 } },
      { $unwind: "$ids" },
    ];
    if (selectLimit && !hasExclusions) {
      pipeline.push({ $limit: selectLimit });
    }
    pipeline.push({ $project: { _id: "$ids" } });
    const rows = await DataRecord.aggregate<{ _id: unknown }>(pipeline).option({
      maxTimeMS: 30_000,
    });
    ids = rows.map((row) => String(row._id));
    if (hasExclusions) {
      const allowed = new Set(
        (await scanWithExclusions(projectId, matchFilter, exclusions)).ids
      );
      ids = ids.filter((id) => allowed.has(id));
    }
  } else if (hasExclusions) {
    ids = (await scanWithExclusions(projectId, matchFilter, exclusions)).ids;
  } else {
    let idsQuery = DataRecord.find(matchFilter)
      .select("_id")
      .sort({ createdAt: -1 })
      .maxTimeMS(30_000);
    if (selectLimit) {
      idsQuery = idsQuery.limit(selectLimit);
    }
    const rows = await idsQuery.lean<Array<{ _id: unknown }>>();
    ids = rows.map((row) => String(row._id));
  }
  return selectLimit ? ids.slice(0, selectLimit) : ids;
}

/** How many of the current matches each Remove button would hide (counted independently). */
export async function countEnrichPeopleExclusions(
  searchParams: URLSearchParams,
  projectId: ObjectId
) {
  const params = new URLSearchParams(searchParams);
  params.set("view", "people");
  params.delete("listId");
  const query = parseDataRecordsQuery(params);
  const savedScope = await projectListSavedScope(projectId);
  const { recordsFilter } = await buildDataRecordsFilter(query, {
    resolvedView: "people",
    projectSavedScope: {
      emails: savedScope.emails,
      recordIds: savedScope.recordIds,
    },
  });
  const key = JSON.stringify([projectId.toString(), recordsFilter]);
  const cached = countCache.get(key);
  if (cached && Date.now() - cached.at < SCAN_CACHE_MS) {
    return cached.result;
  }
  const result = (async () => {
    const [suppression, listed, collection] = await Promise.all([
      suppressionFor(projectId),
      emailsAlreadyInLists(projectId),
      getRecordsCollection(),
    ]);
    let scanned = 0;
    let capped = false;
    let unsubscribed = 0;
    let existing = 0;
    const cursor = collection
      .find(recordsFilter as Filter<Document>, { projection: { email: 1 }, maxTimeMS: 30_000 })
      .sort({ createdAt: -1 })
      .batchSize(5000);
    for await (const doc of cursor) {
      scanned += 1;
      const email = String(doc.email ?? "").trim().toLowerCase();
      if (isSuppressedAddress(email, suppression)) unsubscribed += 1;
      if (email && listed.has(email)) existing += 1;
      if (scanned >= EXCLUSION_SCAN_CAP) {
        capped = true;
        break;
      }
    }
    await cursor.close();
    return { unsubscribed, existing, scanned, capped };
  })();
  countCache.set(key, { at: Date.now(), result });
  result.catch(() => countCache.delete(key));
  return result;
}

const countCache = new Map<
  string,
  {
    at: number;
    result: Promise<{ unsubscribed: number; existing: number; scanned: number; capped: boolean }>;
  }
>();
