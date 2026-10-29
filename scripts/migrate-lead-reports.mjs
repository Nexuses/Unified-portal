#!/usr/bin/env node
/**
 * Migrate leadreport-ai Mongo (`lead-reports.reports`) into Unified Portal CRM contacts.
 *
 * Usage:
 *   node --env-file=.env.local scripts/migrate-lead-reports.mjs --dry-run
 *   node --env-file=.env.local scripts/migrate-lead-reports.mjs
 *
 * Env:
 *   MONGO_DB_URL                 portal Mongo (unified_portal)
 *   LEAD_REPORT_MONGODB_URI or MONGODB_URI  source lead-reports cluster
 */

import { MongoClient, ObjectId } from "mongodb";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const DRY = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : 0;

function loadEnvFile() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "MONGODB_URI" && value.startsWith("MONGODB_URI=")) {
      value = value.slice("MONGODB_URI=".length);
    }
    if (!(key in process.env) || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const LEAD_REPORT_ATTR = {
  flag: "leadReport",
  legacyId: "legacyLeadReportId",
  project: "leadReportProject",
  owner: "leadReportOwner",
  solutions: "leadReportSolutions",
  createdAt: "leadReportCreatedAt",
};

const LEAD_STATUS_ORDER = [
  "warm",
  "hot",
  "meeting_scheduled",
  "meeting_rescheduled",
  "meeting_done",
  "contact_later",
  "client_manage",
  "client_unavailable",
  "client_rejected",
  "lost",
];

const ALIASES = {
  rsmsaudi: "RSM Saudi",
  qaagility: "Qaagility",
  sandbconsulting: "S&B",
  sbconsulting: "S&B",
  sandb: "S&B",
  shiftpurple: "Shiftpurple",
  intertechnts: "NTS",
  nts: "NTS",
  "6clicks": "6clicks",
  convenant: "Covenant",
  covenant: "Covenant",
  avantenow: "Avantenow",
  digitinary: "Digitinary",
  mynd: "Mynd Solution",
  myndsolution: "Mynd Solution",
  smiforce: "Smiforce",
  marssolutionsgroup: "Mars",
  mars: "Mars",
  enghouse: "Enghouse",
  enghouseclient: "Enghouse Client",
  krvauditing: "KRV",
  krv: "KRV",
  wefundco: "Wefundco",
  finvoxanalytics: "Finvox",
  finvox: "Finvox",
  smcindia: "SMC",
  smc: "SMC",
  rsmcybersecurity: "RSM Cyber",
  rsmcyber: "RSM Cyber",
  can: "Can",
  investera: "Investera",
  marketvines: "Marketvines",
  looyal: "Loyyal",
  loyyal: "Loyyal",
};

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeProjectKey(name) {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

function resolvePortalProjectName(legacyProject, portalNames) {
  const legacy = asText(legacyProject);
  if (!legacy) return null;
  const key = normalizeProjectKey(legacy);
  const target = ALIASES[key] || legacy;
  const targetKey = normalizeProjectKey(target);
  const exact = portalNames.find((name) => normalizeProjectKey(name) === targetKey);
  if (exact) return exact;
  return (
    portalNames.find((name) => {
      const nk = normalizeProjectKey(name);
      return nk.includes(targetKey) || targetKey.includes(nk);
    }) || null
  );
}

function yesNo(value) {
  const text = asText(value).toLowerCase();
  return text === "yes" || text === "true" || text === "y" || text === "1";
}

function toIso(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function splitName(fullName) {
  const parts = asText(fullName).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function normalizeStatus(value) {
  const raw = asText(value).toLowerCase().replace(/\s+/g, "_");
  return LEAD_STATUS_ORDER.includes(raw) ? raw : undefined;
}

function newsToString(value) {
  if (!value) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          return [item.title, item.summary, item.content, item.url]
            .map(asText)
            .filter(Boolean)
            .join(" — ");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return undefined;
}

function mapReport(report) {
  const lead = report.leadData || {};
  const email = asText(report.email || lead.contactDetails?.email).toLowerCase();
  if (!email || !email.includes("@")) return null;

  const fromLead = splitName(lead.name);
  const firstName =
    asText(report.firstName) || fromLead.firstName || email.split("@")[0] || "Lead";
  const lastName = asText(report.lastName) || fromLead.lastName;
  const companyName = asText(report.companyName) || asText(lead.companyName) || "";
  const legacyProject = asText(lead.project);
  const legacyId = asText(report._id);
  const status = normalizeStatus(lead.status);
  const criteria = lead.leadScoring?.qualificationCriteria || {};
  const meetingAt = [asText(report.meetingDate), asText(report.meetingTime)]
    .filter(Boolean)
    .join("T") || undefined;

  const notes = (lead.notes || [])
    .map((note, index) => ({
      id: asText(note.id) || `note-${index}`,
      at: toIso(note.createdAt || note.updatedAt) || new Date().toISOString(),
      body: asText(note.content),
    }))
    .filter((note) => note.body);

  const timeline = (lead.engagementTimeline || [])
    .map((item, index) => ({
      id: asText(item.id) || `tl-${index}`,
      at: toIso(item.createdAt) || new Date().toISOString(),
      body: asText(item.content),
      kind: asText(item.type) || "note",
    }))
    .filter((item) => item.body);

  const profile = {
    title: asText(lead.position) || undefined,
    phone: asText(lead.contactDetails?.phone) || undefined,
    linkedinUrl: asText(lead.contactDetails?.linkedin) || undefined,
    photoUrl: asText(lead.photo) || undefined,
    location: asText(lead.companyDetails?.headquarters) || undefined,
    about: asText(lead.aboutLead) || undefined,
    leadStage: status,
    source: "leadreport-migrate",
    qualification: {
      decisionMaker: yesNo(criteria.decisionMaker),
      viewedDeck: yesNo(criteria.viewedSolutionDeck || criteria.viewedDeck),
      haveBudget: yesNo(criteria.haveBudget),
      need: yesNo(criteria.need),
      overallScore:
        typeof lead.leadScoring?.overallScore === "number"
          ? lead.leadScoring.overallScore
          : undefined,
    },
    company: {
      industry: asText(lead.companyDetails?.industry) || undefined,
      employees:
        lead.companyDetails?.employees != null
          ? String(lead.companyDetails.employees)
          : undefined,
      location: asText(lead.companyDetails?.headquarters) || undefined,
      website: asText(lead.companyDetails?.website) || undefined,
      linkedinUrl: asText(lead.companyDetails?.linkedin) || undefined,
      description: asText(lead.aboutCompany) || undefined,
    },
    meeting: {
      at: meetingAt,
      timezone: asText(report.meetingTimezone) || undefined,
      channel: asText(report.meetingPlatform) || undefined,
      title: asText(report.meetingObjective) || undefined,
      joinUrl: asText(report.meetingLink) || undefined,
    },
    brief: asText(report.problemPitch)
      ? { problem: asText(report.problemPitch) }
      : undefined,
    news:
      newsToString(report.companyNews) ||
      newsToString(report.aiContent?.news) ||
      undefined,
    notes,
    timeline,
  };

  const solutions = Array.isArray(lead.solutions)
    ? lead.solutions.map(asText).filter(Boolean)
    : [];
  const reportCreatedAt =
    toIso(report.createdAt) || toIso(report.updatedAt) || undefined;

  return {
    email,
    firstName,
    lastName,
    companyName,
    legacyProject,
    legacyId,
    profile,
    attributes: {
      [LEAD_REPORT_ATTR.flag]: "1",
      ...(legacyId ? { [LEAD_REPORT_ATTR.legacyId]: legacyId } : {}),
      ...(legacyProject ? { [LEAD_REPORT_ATTR.project]: legacyProject } : {}),
      ...(asText(report.reportOwnerName)
        ? { [LEAD_REPORT_ATTR.owner]: asText(report.reportOwnerName) }
        : {}),
      ...(solutions.length
        ? { [LEAD_REPORT_ATTR.solutions]: solutions.join(", ") }
        : {}),
      ...(reportCreatedAt
        ? { [LEAD_REPORT_ATTR.createdAt]: reportCreatedAt }
        : {}),
      ...(asText(lead.position) ? { title: asText(lead.position) } : {}),
    },
  };
}

function mergeProfile(existing = {}, incoming = {}) {
  const out = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const prev = Array.isArray(existing[key]) ? existing[key] : [];
      const seen = new Set(prev.map((item) => item.id || JSON.stringify(item)));
      out[key] = [
        ...prev,
        ...value.filter((item) => !seen.has(item.id || JSON.stringify(item))),
      ];
      continue;
    }
    if (typeof value === "object") {
      out[key] = { ...(existing[key] || {}), ...value };
      continue;
    }
    if (existing[key] == null || existing[key] === "") {
      out[key] = value;
    } else if (key === "leadStage" || key === "source") {
      out[key] = value;
    }
  }
  return out;
}

async function main() {
  const portalUri = process.env.MONGO_DB_URL;
  let sourceUri =
    process.env.LEAD_REPORT_MONGODB_URI || process.env.MONGODB_URI || "";
  sourceUri = sourceUri.replace(/^MONGODB_URI=/i, "").trim();

  if (!portalUri) throw new Error("Missing MONGO_DB_URL");
  if (!sourceUri) {
    throw new Error("Missing LEAD_REPORT_MONGODB_URI or MONGODB_URI");
  }

  console.log(DRY ? "DRY RUN" : "WRITE MODE");
  const portal = new MongoClient(portalUri);
  const source = new MongoClient(sourceUri);
  await portal.connect();
  await source.connect();

  const portalDb = portal.db("unified_portal");
  const sourceDb = source.db("lead-reports");

  const projects = await portalDb
    .collection("projects")
    .find({}, { projection: { name: 1 } })
    .toArray();
  const projectByName = new Map(
    projects.map((project) => [project.name, project._id]),
  );
  const portalNames = projects.map((project) => project.name);

  let cursor = sourceDb.collection("reports").find({});
  if (LIMIT > 0) cursor = cursor.limit(LIMIT);
  const reports = await cursor.toArray();
  console.log(`Loaded ${reports.length} source reports`);

  const stats = {
    created: 0,
    updated: 0,
    skippedNoEmail: 0,
    skippedNoProject: 0,
    skippedUnmapped: 0,
    byProject: {},
    unmapped: {},
  };

  for (const report of reports) {
    const mapped = mapReport(report);
    if (!mapped) {
      stats.skippedNoEmail += 1;
      continue;
    }
    if (!mapped.legacyProject) {
      stats.skippedNoProject += 1;
      continue;
    }

    const portalName = resolvePortalProjectName(
      mapped.legacyProject,
      portalNames,
    );
    if (!portalName) {
      stats.skippedUnmapped += 1;
      stats.unmapped[mapped.legacyProject] =
        (stats.unmapped[mapped.legacyProject] || 0) + 1;
      continue;
    }

    const projectId = projectByName.get(portalName);
    stats.byProject[portalName] = (stats.byProject[portalName] || 0) + 1;

    const existing =
      (await portalDb.collection("contacts").findOne({
        projectId,
        [`attributes.${LEAD_REPORT_ATTR.legacyId}`]: mapped.legacyId,
      })) ||
      (await portalDb.collection("contacts").findOne({
        projectId,
        email: mapped.email,
      }));

    const now = new Date();
    if (existing) {
      const attributes = {
        ...(existing.attributes || {}),
        ...mapped.attributes,
      };
      const profile = mergeProfile(existing.profile || {}, mapped.profile);
      if (!DRY) {
        await portalDb.collection("contacts").updateOne(
          { _id: existing._id },
          {
            $set: {
              firstName: mapped.firstName || existing.firstName,
              lastName: mapped.lastName || existing.lastName,
              companyName: mapped.companyName || existing.companyName,
              attributes,
              profile,
              updatedAt: now,
            },
          },
        );
      }
      stats.updated += 1;
      continue;
    }

    if (!DRY) {
      await portalDb.collection("contacts").insertOne({
        _id: new ObjectId(),
        projectId,
        firstName: mapped.firstName,
        lastName: mapped.lastName,
        email: mapped.email,
        companyId: null,
        companyName: mapped.companyName,
        attributes: mapped.attributes,
        profile: mapped.profile,
        subscribed: true,
        blocklisted: false,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    stats.created += 1;
  }

  console.log(JSON.stringify(stats, null, 2));
  await portal.close();
  await source.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
