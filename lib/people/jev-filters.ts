import {
  DEPARTMENT_GROUPS,
  MANAGEMENT_LEVELS,
} from "@/app/components/portal/crm/people/job-title-options";
import type { AiSearchFilters } from "@/lib/people/ai-search";
import type { DataView } from "@/lib/people/data-views";
import {
  asChoice,
  callJevSystemOne,
  getJevConfig,
  type JevAnswer,
  type JevQuestion,
} from "@/lib/people/jev";

const NONE = "none";
const NONE_CRITERIA = "Not mentioned or implied by the request";
const JEV_TIMEOUT_MS = 8_000;

const LEVEL_HINTS: Record<string, string> = {
  Owner: "Business owners",
  Founder: "Founders or co-founders",
  "C suite": "C-level executives (CEO, CFO, CTO, COO, CMO, CIO)",
  Partner: "Partners at a firm",
  President: "Presidents",
  "Executive Vice President": "Executive vice presidents (EVP)",
  "Senior Vice President": "Senior vice presidents (SVP)",
  Vp: "Vice presidents (VP)",
  Head: "Heads of a function (Head of Sales, Head of Engineering)",
  Director: "Directors",
  Manager: "Managers",
  Senior: "Senior individual contributors",
  Lead: "Team leads",
  Entry: "Entry-level or junior roles",
  Intern: "Interns",
};

const INDUSTRY_BUCKETS: Record<string, { criteria: string; labels: string[] }> = {
  saas: { criteria: "SaaS / software-as-a-service companies", labels: ["SaaS"] },
  software: {
    criteria: "Software or tech product companies",
    labels: ["Software", "Information Technology & Services"],
  },
  finance: {
    criteria: "Finance, banking, or financial services",
    labels: ["Finance", "Financial Services", "Banking"],
  },
  fintech: { criteria: "Fintech", labels: ["Fintech", "Financial Services"] },
  healthcare: {
    criteria: "Healthcare or life sciences",
    labels: ["Healthcare", "Hospital & Health Care"],
  },
  retail: { criteria: "Retail or e-commerce", labels: ["Retail", "E-commerce"] },
  manufacturing: { criteria: "Manufacturing or industrial", labels: ["Manufacturing"] },
  education: { criteria: "Education or edtech", labels: ["Education", "E-Learning"] },
  real_estate: { criteria: "Real estate or proptech", labels: ["Real Estate"] },
};

function toKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const LEVEL_BY_KEY = new Map(MANAGEMENT_LEVELS.map((level) => [toKey(level), level]));
const DEPARTMENT_BY_KEY = new Map(
  DEPARTMENT_GROUPS.map((group) => [toKey(group.label), group.label])
);

function choiceCriteria(
  entries: Iterable<[string, string]>,
  describe: (label: string) => string
): Record<string, string> {
  const criteria: Record<string, string> = { [NONE]: NONE_CRITERIA };
  for (const [key, label] of entries) criteria[key] = describe(label);
  return criteria;
}

function buildQuestions(view: DataView): Record<string, JevQuestion> {
  const industry: JevQuestion = {
    type: "choice",
    instructions: "Which industry group is the user targeting, if any?",
    criteria: {
      [NONE]: NONE_CRITERIA,
      ...Object.fromEntries(
        Object.entries(INDUSTRY_BUCKETS).map(([key, bucket]) => [key, bucket.criteria])
      ),
    },
  };

  if (view === "companies") return { industry };

  return {
    industry,
    management_level: {
      type: "choice",
      instructions: "Which seniority level does the user want, if any?",
      criteria: choiceCriteria(LEVEL_BY_KEY, (label) => LEVEL_HINTS[label] ?? label),
    },
    department: {
      type: "choice",
      instructions: "Which department or job function does the user want, if any?",
      criteria: choiceCriteria(DEPARTMENT_BY_KEY, (label) => `${label} team or function`),
    },
    email_status: {
      type: "choice",
      instructions: "Does the user ask for verified emails?",
      criteria: {
        verified: "Explicitly wants verified, valid, or confirmed emails",
        not_requested: "Does not ask about email verification",
      },
    },
  };
}

export type JevFilterDecisions = {
  managementLevel?: string;
  department?: string;
  industries?: string[];
  verifiedEmails?: boolean;
};

function confidentChoice(
  answer: JevAnswer | undefined,
  confidenceMin: number
): string | null {
  const { choice, confidence } = asChoice(answer, NONE);
  if (!choice || choice === NONE || confidence < confidenceMin) return null;
  return choice;
}

export function isJevFiltersEnabled(): boolean {
  return process.env.AI_FILTERS_JEV === "on" && Boolean(getJevConfig().apiKey);
}

export async function askJevForFilterDecisions(
  query: string,
  view: DataView
): Promise<JevFilterDecisions> {
  const { confidenceMin } = getJevConfig();
  const { answers } = await callJevSystemOne({
    state: {
      request: query,
      page: view === "people" ? "People search (contacts)" : "Companies search (organizations)",
    },
    questions: buildQuestions(view),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });

  const decisions: JevFilterDecisions = {};

  const industryKey = confidentChoice(answers.industry, confidenceMin);
  if (industryKey && INDUSTRY_BUCKETS[industryKey]) {
    decisions.industries = INDUSTRY_BUCKETS[industryKey].labels;
  }

  if (view === "people") {
    const levelKey = confidentChoice(answers.management_level, confidenceMin);
    const level = levelKey ? LEVEL_BY_KEY.get(levelKey) : undefined;
    if (level) decisions.managementLevel = level;

    const departmentKey = confidentChoice(answers.department, confidenceMin);
    const department = departmentKey ? DEPARTMENT_BY_KEY.get(departmentKey) : undefined;
    if (department) decisions.department = department;

    const email = asChoice(answers.email_status);
    if (email.confidence >= confidenceMin) {
      if (email.choice === "verified") decisions.verifiedEmails = true;
      if (email.choice === "not_requested") decisions.verifiedEmails = false;
    }
  }

  return decisions;
}

function includesIgnoreCase(values: string[], value: string): boolean {
  const needle = value.toLowerCase();
  return values.some((entry) => entry.toLowerCase() === needle);
}

/** Keep the model's values when they already contain Jev's pick; otherwise Jev's pick wins. */
function preferJevValue(current: string[], jevValue: string): string[] {
  return includesIgnoreCase(current, jevValue) ? current : [jevValue];
}

export function applyJevDecisions(
  filters: AiSearchFilters,
  decisions: JevFilterDecisions
): AiSearchFilters {
  const added: string[] = [];
  let next: AiSearchFilters = { ...filters };

  if (decisions.industries?.length) {
    const current = next.industryKeywordsFilter.industries;
    const overlaps = decisions.industries.some((label) => includesIgnoreCase(current, label));
    if (!overlaps) {
      const missing = decisions.industries.filter((label) => !includesIgnoreCase(current, label));
      next = {
        ...next,
        industryKeywordsFilter: {
          ...next.industryKeywordsFilter,
          industries: [...current, ...missing],
        },
      };
      added.push(decisions.industries[0]);
    }
  }

  if (next.view === "people") {
    const jobTitleFilter = { ...next.jobTitleFilter };

    if (decisions.managementLevel) {
      const updated = preferJevValue(jobTitleFilter.managementLevel, decisions.managementLevel);
      if (updated !== jobTitleFilter.managementLevel) added.push(decisions.managementLevel);
      jobTitleFilter.managementLevel = updated;
    }

    if (decisions.department) {
      const updated = preferJevValue(jobTitleFilter.departments, decisions.department);
      if (updated !== jobTitleFilter.departments) added.push(decisions.department);
      jobTitleFilter.departments = updated;
    }

    next = { ...next, jobTitleFilter };

    if (decisions.verifiedEmails !== undefined) {
      const emailStatus = (next.filters.emailStatus ?? []).filter(
        (status) => status !== "verified"
      );
      if (decisions.verifiedEmails) {
        if (!next.filters.emailStatus?.includes("verified")) added.push("verified emails");
        emailStatus.push("verified");
      }
      next = { ...next, filters: { ...next.filters, emailStatus } };
    }
  }

  const explanation = next.explanation.toLowerCase();
  const newLabels = added.filter((label) => !explanation.includes(label.toLowerCase()));
  if (newLabels.length > 0) {
    next = { ...next, explanation: [next.explanation, ...newLabels].join(" — ") };
  }

  return next;
}
