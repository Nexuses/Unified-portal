import {
  DEPARTMENT_ALIAS_GROUPS,
  INDUSTRY_ALIAS_GROUPS,
  JOB_TITLE_ALIAS_GROUPS,
  aliasGroupsToRecord,
} from "@/lib/people/alias-pool";
import { getDataToolDb } from "@/lib/datatool-server";

type SearchAliasConfigDoc = {
  key: string;
  jobTitleGroups?: string[][];
  departmentGroups?: string[][];
  industryGroups?: string[][];
};

export type RuntimeAliasBundles = {
  jobTitle: Record<string, string[]>;
  department: Record<string, string[]>;
  industry: Record<string, string[]>;
  jobTitleGroups: string[][];
  departmentGroups: string[][];
  industryGroups: string[][];
};

const CACHE_TTL_MS = 60_000;
let cache: { at: number; value: RuntimeAliasBundles } | null = null;

function mergeAliasGroups(staticGroups: string[][], customGroups: string[][]): string[][] {
  const merged: string[][] = staticGroups.map((group) => [...group]);
  const keyToIndex = new Map<string, number>();

  for (let i = 0; i < merged.length; i += 1) {
    for (const entry of merged[i]) {
      keyToIndex.set(entry.trim().toLowerCase(), i);
    }
  }

  for (const custom of customGroups) {
    const cleaned = custom.map((e) => e.trim()).filter(Boolean);
    if (cleaned.length === 0) continue;

    let targetIndex = -1;
    for (const entry of cleaned) {
      const hit = keyToIndex.get(entry.toLowerCase());
      if (hit !== undefined) {
        targetIndex = hit;
        break;
      }
    }

    if (targetIndex >= 0) {
      const existing = new Set(merged[targetIndex].map((e) => e.toLowerCase()));
      for (const entry of cleaned) {
        if (!existing.has(entry.toLowerCase())) {
          merged[targetIndex].push(entry);
          existing.add(entry.toLowerCase());
          keyToIndex.set(entry.toLowerCase(), targetIndex);
        }
      }
    } else {
      const index = merged.length;
      merged.push(cleaned);
      for (const entry of cleaned) {
        keyToIndex.set(entry.toLowerCase(), index);
      }
    }
  }

  return merged;
}

export function invalidateSearchAliasCache() {
  cache = null;
}

export async function getRuntimeAliasBundles(
  options: { bypassCache?: boolean } = {}
): Promise<RuntimeAliasBundles> {
  if (!options.bypassCache && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  let customJob: string[][] = [];
  let customDept: string[][] = [];
  let customIndustry: string[][] = [];

  try {
    const db = await getDataToolDb();
    const doc = await db
      .collection<SearchAliasConfigDoc>("searchaliasconfigs")
      .findOne({ key: "default" });
    if (doc) {
      customJob = Array.isArray(doc.jobTitleGroups) ? doc.jobTitleGroups : [];
      customDept = Array.isArray(doc.departmentGroups) ? doc.departmentGroups : [];
      customIndustry = Array.isArray(doc.industryGroups) ? doc.industryGroups : [];
    }
  } catch {
    // Fall back to static aliases if DB unavailable
  }

  const jobTitleGroups = mergeAliasGroups(JOB_TITLE_ALIAS_GROUPS, customJob);
  const departmentGroups = mergeAliasGroups(DEPARTMENT_ALIAS_GROUPS, customDept);
  const industryGroups = mergeAliasGroups(INDUSTRY_ALIAS_GROUPS, customIndustry);

  const value: RuntimeAliasBundles = {
    jobTitleGroups,
    departmentGroups,
    industryGroups,
    jobTitle: aliasGroupsToRecord(jobTitleGroups),
    department: aliasGroupsToRecord(departmentGroups),
    industry: aliasGroupsToRecord(industryGroups),
  };

  cache = { at: Date.now(), value };
  return value;
}

export function getStaticAliasBundles(): RuntimeAliasBundles {
  return {
    jobTitleGroups: JOB_TITLE_ALIAS_GROUPS,
    departmentGroups: DEPARTMENT_ALIAS_GROUPS,
    industryGroups: INDUSTRY_ALIAS_GROUPS,
    jobTitle: aliasGroupsToRecord(JOB_TITLE_ALIAS_GROUPS),
    department: aliasGroupsToRecord(DEPARTMENT_ALIAS_GROUPS),
    industry: aliasGroupsToRecord(INDUSTRY_ALIAS_GROUPS),
  };
}
