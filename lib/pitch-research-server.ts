import ExcelJS from "exceljs";
import { ObjectId, type Document } from "mongodb";
import { runInApiCredit } from "@/lib/api-credits-server";
import { getDb } from "@/lib/mongodb";
import { getRecordsCollection } from "@/lib/datatool-server";
import { loadKnowledgeMarkdown } from "@/lib/knowledge-base-server";
import { inferSeniorityFromTitle } from "@/lib/people/seniority-inference";
import {
  assertWebResearchConfigured,
  researchWithWeb,
  webResearchConfigured,
} from "@/lib/web-search-server";
import {
  PITCH_RESEARCH_MAX_COMPANIES,
  PITCH_RESEARCH_PEOPLE_PER_COMPANY,
  type PitchCompanyResearch,
  type PitchCompanyResult,
  type PitchPerson,
  type PitchResearchJob,
  type PitchSource,
} from "@/lib/pitch-research";

const JOBS = "pitch_research_jobs";
const CONCURRENCY = 3;
const GROK_TIMEOUT_MS = 4 * 60 * 1000;
const STALE_MS = 6 * 60 * 1000;
const CANDIDATES_FOR_MODEL = 12;

export type CompanyInput = { name: string; domain?: string };

type JobDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  projectName: string;
  createdBy: string;
  status: PitchResearchJob["status"];
  focus: string;
  sourceName: string;
  inputs: CompanyInput[];
  companies: PitchCompanyResult[];
  createdAt: Date;
  updatedAt: Date;
  error?: string;
};

type PortalRow = {
  first_name?: string;
  last_name?: string;
  title?: string;
  seniority?: string;
  company_name?: string;
  email?: string;
  email_status?: string;
  person_linkedin_url?: string;
  contact_country?: string;
  website?: string;
  industry?: string;
  employees?: string;
  company_country?: string;
};

const runningJobs = ((globalThis as { __pitchResearchJobs?: Set<string> }).__pitchResearchJobs ??=
  new Set<string>());

/* ------------------------------------------------------------------ */
/* Input parsing                                                       */
/* ------------------------------------------------------------------ */

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const delimiter = text.split("\n")[0]?.includes("\t") && !text.split("\n")[0]?.includes(",") ? "\t" : ",";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

async function xlsxRows(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  const rows: string[][] = [];
  sheet?.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1).map((value) => {
      if (value == null) return "";
      if (typeof value === "object" && "text" in value) return String(value.text ?? "");
      if (typeof value === "object" && "result" in value) return String(value.result ?? "");
      if (typeof value === "object" && "richText" in value) {
        return (value.richText as Array<{ text: string }>).map((part) => part.text).join("");
      }
      return String(value);
    });
    rows.push(values);
  });
  return rows;
}

function domainFrom(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  const host = trimmed.includes("@") ? trimmed.split("@")[1] : trimmed;
  return host.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0] ?? "";
}

/** Reads company names (and optional website) from an uploaded CSV, Excel or text list. */
export async function companiesFromUpload(fileName: string, buffer: Buffer) {
  const lower = fileName.toLowerCase();
  let rows: string[][];
  if (lower.endsWith(".xlsx")) rows = await xlsxRows(buffer);
  else if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    rows = parseCsv(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  } else if (lower.endsWith(".txt")) {
    rows = buffer
      .toString("utf8")
      .split(/\r?\n/)
      .map((line) => [line]);
  } else {
    throw new Error("Upload the company list as .csv, .xlsx or .txt.");
  }
  rows = rows.filter((row) => row.some((cell) => cell.trim()));
  if (rows.length === 0) throw new Error("That file has no rows.");

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  let nameCol = header.findIndex((cell) =>
    /^(company|company name|companyname|organi[sz]ation|account|account name|business|employer)$/.test(cell),
  );
  if (nameCol < 0) nameCol = header.findIndex((cell) => /company|organi[sz]ation|account/.test(cell));
  const webCol = header.findIndex((cell) => /website|domain|url|site/.test(cell));
  const hasHeader = nameCol >= 0 || webCol >= 0;
  if (nameCol < 0) nameCol = 0;

  return normalizeCompanyInputs(
    rows.slice(hasHeader ? 1 : 0).map((row) => ({
      name: (row[nameCol] ?? "").trim(),
      domain: webCol >= 0 ? domainFrom(row[webCol] ?? "") : undefined,
    })),
  );
}

export function normalizeCompanyInputs(inputs: CompanyInput[]) {
  const seen = new Set<string>();
  const companies: CompanyInput[] = [];
  let skipped = 0;
  for (const input of inputs) {
    const name = input.name.replace(/\s+/g, " ").trim().slice(0, 160);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (companies.length >= PITCH_RESEARCH_MAX_COMPANIES) {
      skipped += 1;
      continue;
    }
    companies.push({ name, ...(input.domain ? { domain: input.domain } : {}) });
  }
  return { companies, skipped };
}

/* ------------------------------------------------------------------ */
/* Data Portal                                                         */
/* ------------------------------------------------------------------ */

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLegalSuffix(name: string) {
  return name
    .replace(/[.,]/g, " ")
    .replace(/\b(inc|incorporated|ltd|limited|llc|plc|corp|corporation|co|company|gmbh|sa|ag|bv|pvt|private|wll|fzco|fze|llp|group|holding|holdings)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PORTAL_FIELDS = {
  first_name: 1,
  last_name: 1,
  title: 1,
  seniority: 1,
  company_name: 1,
  email: 1,
  email_status: 1,
  person_linkedin_url: 1,
  contact_country: 1,
  website: 1,
  industry: 1,
  employees: 1,
  company_country: 1,
};

const SENIORITY_RANK: Record<string, number> = {
  Owner: 1,
  Founder: 1,
  "C suite": 1,
  Partner: 1,
  President: 1,
  "Executive Vice President": 2,
  "Senior Vice President": 2,
  Vp: 2,
  Head: 3,
  Director: 3,
  Manager: 4,
  Senior: 5,
  Lead: 5,
  Entry: 7,
  Intern: 8,
};

function seniorityRank(row: PortalRow) {
  const level =
    inferSeniorityFromTitle(String(row.seniority ?? "")) ??
    inferSeniorityFromTitle(String(row.title ?? ""));
  return level ? (SENIORITY_RANK[level] ?? 6) : 6;
}

function isVerifiedStatus(status: string) {
  return /^(verified|valid|deliverable)$/i.test(status.trim());
}

function fullName(row: PortalRow) {
  return `${row.first_name ?? ""} ${row.last_name ?? ""}`.replace(/\s+/g, " ").trim();
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(dr|mr|mrs|ms|eng|prof)\b\.?/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function findPortalCompany(input: CompanyInput) {
  const records = await getRecordsCollection();
  const attempts: Document[] = [];
  if (input.domain) {
    attempts.push({ website: { $regex: escapeRegex(input.domain), $options: "i" } });
  }
  attempts.push({ company_name: { $regex: `^${escapeRegex(input.name)}$`, $options: "i" } });
  const core = stripLegalSuffix(input.name);
  if (core && core.length >= 3 && core.toLowerCase() !== input.name.toLowerCase()) {
    attempts.push({ company_name: { $regex: `^${escapeRegex(core)}\\b`, $options: "i" } });
  }
  if (core.length >= 4) {
    attempts.push({ company_name: { $regex: `\\b${escapeRegex(core)}\\b`, $options: "i" } });
  }

  for (const filter of attempts) {
    const rows = (await records
      .find(filter, { projection: PORTAL_FIELDS })
      .limit(500)
      .toArray()) as PortalRow[];
    if (rows.length === 0) continue;
    const counts = new Map<string, number>();
    for (const row of rows) {
      const name = String(row.company_name ?? "").trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const matchedName = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const companyRows = rows.filter(
      (row) => String(row.company_name ?? "").trim().toLowerCase() === matchedName.toLowerCase(),
    );
    return { matchedName, rows: companyRows };
  }
  return { matchedName: "", rows: [] as PortalRow[] };
}

function rankCandidates(rows: PortalRow[]) {
  const seen = new Set<string>();
  return rows
    .filter((row) => fullName(row))
    .sort((a, b) => {
      const rank = seniorityRank(a) - seniorityRank(b);
      if (rank !== 0) return rank;
      return Number(isVerifiedStatus(String(b.email_status ?? ""))) -
        Number(isVerifiedStatus(String(a.email_status ?? "")));
    })
    .filter((row) => {
      const key = String(row.email || fullName(row)).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function portalFacts(matchedName: string, rows: PortalRow[]) {
  const pick = (field: keyof PortalRow) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = String(row[field] ?? "").trim();
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  };
  return {
    matchedName,
    domain: domainFrom(pick("website")),
    industry: pick("industry"),
    employees: pick("employees"),
    country: pick("company_country"),
    people: rows.length,
  };
}

/* ------------------------------------------------------------------ */
/* Grok research                                                       */
/* ------------------------------------------------------------------ */

type GrokPerson = {
  candidate?: number | null;
  name?: string;
  title?: string;
  linkedin?: string;
  location?: string;
  insights?: string[];
  subject?: string;
  hook?: string;
  body?: string;
};

type GrokResult = {
  company?: {
    summary?: string;
    website?: string;
    industry?: string;
    size?: string;
    location?: string;
    priorities?: string[];
    news?: Array<{ title?: string; date?: string; url?: string }>;
  };
  people?: GrokPerson[];
  sources?: Array<{ title?: string; url?: string }>;
};

export function pitchResearchConfigured() {
  return webResearchConfigured();
}

function parseJsonObject(raw: string): GrokResult {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Research did not return structured results.");
  return JSON.parse(trimmed.slice(start, end + 1)) as GrokResult;
}

async function callGrok(system: string, user: string) {
  const { text, sources } = await researchWithWeb({ system, user, timeoutMs: GROK_TIMEOUT_MS });
  return { text, sources: sources as PitchSource[] };
}

function researchSystemPrompt() {
  return `You are a B2B sales researcher writing one-to-one outreach.
Use the web_search and x_search tools. Research the target company's website, recent news (last 12 months), its LinkedIn company page, and each chosen person's public LinkedIn profile, posts, talks and interviews, and X posts.
Rules:
- Only state facts you found. Never invent people, titles, numbers or news. If something is unknown, leave it empty.
- Prefer people from the Data Portal candidate list. Only add a person who is not on the list when fewer than 4 suitable candidates exist, and only if you found them on a public source (give their LinkedIn URL).
- Each pitch must open with a specific, recent, researched fact about the person or company (the hook), connect it to what the seller offers, and end with one soft question. 90 to 140 words, plain text, no em dashes, no placeholders, no signature.
- Subject lines: under 8 words, specific, no clickbait.
Return only JSON, no prose, matching:
{"company":{"summary":"","website":"","industry":"","size":"","location":"","priorities":[""],"news":[{"title":"","date":"YYYY-MM","url":""}]},
 "people":[{"candidate":0,"name":"","title":"","linkedin":"","location":"","insights":[""],"hook":"","subject":"","body":""}],
 "sources":[{"title":"","url":""}]}
"candidate" is the index from the candidate list, or null for a person you found on the web.`;
}

function researchUserPrompt(input: {
  sellerName: string;
  knowledge: string;
  focus: string;
  company: CompanyInput;
  facts: PitchCompanyResearch["portal"];
  candidates: PortalRow[];
}) {
  const candidateList = input.candidates.map((row, index) => ({
    candidate: index,
    name: fullName(row),
    title: row.title ?? "",
    linkedin: row.person_linkedin_url ?? "",
    country: row.contact_country ?? "",
  }));
  return [
    `Seller: ${input.sellerName}`,
    input.knowledge
      ? `What the seller offers (from their knowledge base):\n${input.knowledge}`
      : "The seller has no knowledge base yet. Keep the offer generic and say less about the product.",
    input.focus ? `Campaign focus from the user: ${input.focus}` : "",
    `Target company: ${input.company.name}${input.company.domain ? ` (${input.company.domain})` : ""}`,
    input.facts.matchedName
      ? `Data Portal record: ${JSON.stringify(input.facts)}`
      : "The company is not in the Data Portal.",
    candidateList.length
      ? `Data Portal candidates (pick the ${PITCH_RESEARCH_PEOPLE_PER_COMPANY} best decision-makers for this offer):\n${JSON.stringify(candidateList)}`
      : `No Data Portal candidates. Find up to ${PITCH_RESEARCH_PEOPLE_PER_COMPANY} real decision-makers for this offer from public sources.`,
    `Choose 4 to ${PITCH_RESEARCH_PEOPLE_PER_COMPANY} people. Return the JSON only.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function titleWords(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !["and", "the", "for", "of"].includes(word)),
  );
}

function titlesAgree(a: string, b: string) {
  if (!a.trim() || !b.trim()) return null;
  const left = titleWords(a);
  const right = titleWords(b);
  if (left.size === 0 || right.size === 0) return null;
  const shared = [...left].filter((word) => right.has(word)).length;
  if (shared / Math.min(left.size, right.size) >= 0.5) return true;
  const levelA = inferSeniorityFromTitle(a);
  return Boolean(levelA && levelA === inferSeniorityFromTitle(b) && shared > 0);
}

function buildPerson(person: GrokPerson, candidates: PortalRow[], allRows: PortalRow[]): PitchPerson {
  let row: PortalRow | undefined =
    typeof person.candidate === "number" ? candidates[person.candidate] : undefined;
  const researchedName = String(person.name ?? "").trim();
  if (!row && researchedName) {
    const target = normalizeName(researchedName);
    row = allRows.find((candidate) => normalizeName(fullName(candidate)) === target);
  }
  const source: PitchPerson["source"] = typeof person.candidate === "number" ? "data-portal" : "web";
  const portalTitle = String(row?.title ?? "");
  const researchedTitle = String(person.title ?? "").trim();
  const emailStatus = String(row?.email_status ?? "");
  const notes: string[] = [];

  if (!row) {
    notes.push("Not in the Data Portal. Found on the web, so there is no verified email.");
  } else {
    if (source === "web") notes.push("Found on the web and matched to a Data Portal record.");
    if (researchedName && normalizeName(researchedName) !== normalizeName(fullName(row))) {
      notes.push(`Data Portal name: ${fullName(row)}.`);
    }
  }
  const titleMatches = row ? titlesAgree(researchedTitle, portalTitle) : null;
  if (titleMatches === false) {
    notes.push(`Title differs. Data Portal: "${portalTitle}". Web: "${researchedTitle}". The person may have changed role.`);
  }
  if (row && !row.email) notes.push("No email in the Data Portal.");
  else if (row && !isVerifiedStatus(emailStatus)) {
    notes.push(`Email status in the Data Portal: ${emailStatus || "unknown"}.`);
  }

  return {
    name: row ? fullName(row) || researchedName : researchedName,
    title: researchedTitle || portalTitle,
    email: String(row?.email ?? ""),
    emailStatus,
    linkedin: String(person.linkedin || row?.person_linkedin_url || ""),
    location: String(person.location || row?.contact_country || ""),
    source,
    insights: (person.insights ?? []).map(String).filter(Boolean).slice(0, 5),
    pitch: {
      subject: String(person.subject ?? "").trim(),
      hook: String(person.hook ?? "").trim(),
      body: String(person.body ?? "").replace(/\u2014/g, ", ").trim(),
    },
    validation: {
      inDataPortal: Boolean(row),
      titleMatches,
      emailVerified: Boolean(row?.email) && isVerifiedStatus(emailStatus),
      notes,
    },
  };
}

function dedupeSources(sources: PitchSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (!/^https?:\/\//i.test(source.url) || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

async function researchCompany(
  job: Pick<JobDoc, "projectName" | "focus">,
  knowledge: string,
  input: CompanyInput,
): Promise<Omit<PitchCompanyResult, "name" | "status">> {
  const { matchedName, rows } = await findPortalCompany(input);
  const candidates = rankCandidates(rows).slice(0, CANDIDATES_FOR_MODEL);
  const facts = portalFacts(matchedName, rows);

  const { text, sources } = await callGrok(
    researchSystemPrompt(),
    researchUserPrompt({
      sellerName: job.projectName,
      knowledge,
      focus: job.focus,
      company: input,
      facts,
      candidates,
    }),
  );
  const result = parseJsonObject(text);
  const people = (result.people ?? [])
    .slice(0, PITCH_RESEARCH_PEOPLE_PER_COMPANY)
    .map((person) => buildPerson(person, candidates, rows))
    .filter((person) => person.name && person.pitch.body);

  const company = result.company ?? {};
  const website = String(company.website ?? "");
  const researchedDomain = domainFrom(website);
  const research: PitchCompanyResearch = {
    summary: String(company.summary ?? ""),
    website,
    industry: String(company.industry ?? ""),
    size: String(company.size ?? ""),
    location: String(company.location ?? ""),
    priorities: (company.priorities ?? []).map(String).filter(Boolean).slice(0, 6),
    news: (company.news ?? [])
      .map((item) => ({
        title: String(item.title ?? ""),
        date: String(item.date ?? ""),
        url: String(item.url ?? ""),
      }))
      .filter((item) => item.title)
      .slice(0, 6),
    portal: facts,
    companyMatchesPortal: Boolean(
      matchedName && (!researchedDomain || !facts.domain || researchedDomain === facts.domain),
    ),
  };

  return {
    research,
    people,
    sources: dedupeSources([
      ...sources,
      ...(result.sources ?? []).map((source) => ({
        title: String(source.title || source.url || ""),
        url: String(source.url ?? ""),
      })),
    ]).slice(0, 20),
  };
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

async function jobsCollection() {
  const db = await getDb();
  return db.collection<JobDoc>(JOBS);
}

function toJob(doc: JobDoc): PitchResearchJob {
  return {
    id: doc._id.toString(),
    status: doc.status,
    focus: doc.focus,
    sourceName: doc.sourceName,
    total: doc.companies.length,
    completed: doc.companies.filter((c) => c.status === "done" || c.status === "failed").length,
    companies: doc.companies,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    ...(doc.error ? { error: doc.error } : {}),
  };
}

async function runJob(jobId: ObjectId) {
  const key = jobId.toString();
  if (runningJobs.has(key)) return;
  runningJobs.add(key);
  const jobs = await jobsCollection();
  try {
    const job = await jobs.findOne({ _id: jobId });
    if (!job) return;
    await runInApiCredit(job.projectId.toString(), "pitch", async () => {
    await jobs.updateOne({ _id: jobId }, { $set: { status: "running", updatedAt: new Date() } });
    const knowledge = await loadKnowledgeMarkdown(job.projectId.toString(), 6000).catch(() => "");

    const queue = job.companies
      .map((company, index) => ({ company, index }))
      .filter(({ company }) => company.status !== "done" && company.status !== "failed");

    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { index } = next;
        const input = job.inputs[index];
        await jobs.updateOne(
          { _id: jobId },
          { $set: { [`companies.${index}.status`]: "researching", updatedAt: new Date() } },
        );
        try {
          const result = await researchCompany(job, knowledge, input);
          await jobs.updateOne(
            { _id: jobId },
            {
              $set: {
                [`companies.${index}`]: { name: input.name, status: "done", ...result },
                updatedAt: new Date(),
              },
            },
          );
        } catch (error) {
          await jobs.updateOne(
            { _id: jobId },
            {
              $set: {
                [`companies.${index}`]: {
                  name: input.name,
                  status: "failed",
                  error: error instanceof Error ? error.message : "Research failed",
                  people: [],
                  sources: [],
                },
                updatedAt: new Date(),
              },
            },
          );
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const finished = await jobs.findOne({ _id: jobId });
    const allFailed = finished?.companies.every((company) => company.status === "failed");
    await jobs.updateOne(
      { _id: jobId },
      {
        $set: {
          status: allFailed ? "failed" : "done",
          ...(allFailed ? { error: finished?.companies[0]?.error ?? "Research failed" } : {}),
          updatedAt: new Date(),
        },
      },
    );
    });
  } catch (error) {
    console.error("[pitch-research] job failed:", error);
    await jobs.updateOne(
      { _id: jobId },
      {
        $set: {
          status: "failed",
          error: error instanceof Error ? error.message : "Research failed",
          updatedAt: new Date(),
        },
      },
    );
  } finally {
    runningJobs.delete(key);
  }
}

export async function createPitchResearchJob(input: {
  projectId: string;
  projectName: string;
  createdBy: string;
  companies: CompanyInput[];
  focus: string;
  sourceName: string;
}) {
  assertWebResearchConfigured();
  if (input.companies.length === 0) throw new Error("Add at least one company to research.");
  const jobs = await jobsCollection();
  const now = new Date();
  const doc: Omit<JobDoc, "_id"> = {
    projectId: new ObjectId(input.projectId),
    projectName: input.projectName,
    createdBy: input.createdBy,
    status: "queued",
    focus: input.focus.trim().slice(0, 600),
    sourceName: input.sourceName,
    inputs: input.companies,
    companies: input.companies.map((company) => ({
      name: company.name,
      status: "pending",
      people: [],
      sources: [],
    })),
    createdAt: now,
    updatedAt: now,
  };
  const result = await jobs.insertOne(doc as JobDoc);
  void runJob(result.insertedId);
  return toJob({ ...doc, _id: result.insertedId });
}

export async function getPitchResearchJob(projectId: string, id: string) {
  if (!ObjectId.isValid(id)) return null;
  const jobs = await jobsCollection();
  const doc = await jobs.findOne({ _id: new ObjectId(id), projectId: new ObjectId(projectId) });
  if (!doc) return null;
  const stale = Date.now() - doc.updatedAt.getTime() > STALE_MS;
  if ((doc.status === "running" || doc.status === "queued") && stale && !runningJobs.has(id)) {
    void runJob(doc._id);
  }
  return toJob(doc);
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export async function pitchResearchWorkbook(job: PitchResearchJob) {
  const workbook = new ExcelJS.Workbook();
  const pitches = workbook.addWorksheet("Pitches");
  pitches.columns = [
    { header: "Company", key: "company", width: 26 },
    { header: "Name", key: "name", width: 24 },
    { header: "Title", key: "title", width: 30 },
    { header: "Email", key: "email", width: 30 },
    { header: "Email status", key: "emailStatus", width: 14 },
    { header: "LinkedIn", key: "linkedin", width: 36 },
    { header: "Location", key: "location", width: 18 },
    { header: "Found via", key: "source", width: 12 },
    { header: "In Data Portal", key: "inPortal", width: 14 },
    { header: "Title matches", key: "titleMatches", width: 14 },
    { header: "Email verified", key: "emailVerified", width: 14 },
    { header: "Validation notes", key: "notes", width: 50 },
    { header: "Insights", key: "insights", width: 60 },
    { header: "Subject", key: "subject", width: 34 },
    { header: "Pitch", key: "body", width: 90 },
  ];
  const companies = workbook.addWorksheet("Companies");
  companies.columns = [
    { header: "Company", key: "company", width: 26 },
    { header: "Status", key: "status", width: 12 },
    { header: "Summary", key: "summary", width: 70 },
    { header: "Website", key: "website", width: 30 },
    { header: "Industry", key: "industry", width: 22 },
    { header: "Size", key: "size", width: 16 },
    { header: "Location", key: "location", width: 20 },
    { header: "Priorities", key: "priorities", width: 60 },
    { header: "Recent news", key: "news", width: 80 },
    { header: "Data Portal match", key: "portal", width: 30 },
    { header: "Sources", key: "sources", width: 80 },
  ];
  const yesNo = (value: boolean | null) => (value == null ? "" : value ? "Yes" : "No");

  for (const company of job.companies) {
    const research = company.research;
    companies.addRow({
      company: company.name,
      status: company.status === "failed" ? `Failed: ${company.error ?? ""}` : company.status,
      summary: research?.summary ?? "",
      website: research?.website ?? "",
      industry: research?.industry ?? "",
      size: research?.size ?? "",
      location: research?.location ?? "",
      priorities: (research?.priorities ?? []).join("\n"),
      news: (research?.news ?? []).map((n) => `${n.date} ${n.title} ${n.url}`.trim()).join("\n"),
      portal: research?.portal.matchedName
        ? `${research.portal.matchedName} (${research.portal.people} people)`
        : "Not found",
      sources: company.sources.map((s) => s.url).join("\n"),
    });
    for (const person of company.people) {
      pitches.addRow({
        company: company.name,
        name: person.name,
        title: person.title,
        email: person.email,
        emailStatus: person.emailStatus,
        linkedin: person.linkedin,
        location: person.location,
        source: person.source === "data-portal" ? "Data Portal" : "Web",
        inPortal: yesNo(person.validation.inDataPortal),
        titleMatches: yesNo(person.validation.titleMatches),
        emailVerified: yesNo(person.validation.emailVerified),
        notes: person.validation.notes.join("\n"),
        insights: person.insights.join("\n"),
        subject: person.pitch.subject,
        body: person.pitch.body,
      });
    }
  }
  for (const sheet of [pitches, companies]) {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.eachRow((row, index) => {
      if (index > 1) row.alignment = { vertical: "top", wrapText: true };
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
