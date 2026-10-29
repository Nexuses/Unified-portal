import type { ContactProfile } from "@/lib/crm";
import { LEAD_STATUS_ORDER, type LeadStatus } from "@/lib/lead-status";

/** Attribute keys written onto migrated / flagged lead-report contacts. */
export const LEAD_REPORT_ATTR = {
  flag: "leadReport",
  legacyId: "legacyLeadReportId",
  project: "leadReportProject",
  owner: "leadReportOwner",
  solutions: "leadReportSolutions",
  /** ISO timestamp when the lead report was originally created. */
  createdAt: "leadReportCreatedAt",
} as const;

export type LegacyLeadReport = {
  _id?: unknown;
  email?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  reportOwnerName?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  meetingDate?: string;
  meetingTime?: string;
  meetingTimezone?: string;
  meetingPlatform?: string;
  meetingLink?: string;
  meetingLocation?: string;
  meetingObjective?: string;
  problemPitch?: string;
  companyNews?: unknown;
  aiContent?: {
    news?: unknown;
    strategicBrief?: unknown;
    overview?: unknown;
  };
  leadData?: {
    name?: string;
    companyName?: string;
    position?: string;
    project?: string;
    solutions?: string[];
    status?: string;
    photo?: string;
    aboutLead?: string;
    aboutCompany?: string;
    contactDetails?: {
      linkedin?: string;
      email?: string;
      phone?: string;
    };
    companyDetails?: {
      headquarters?: string;
      website?: string;
      industry?: string;
      employees?: string | number;
      linkedin?: string;
    };
    leadScoring?: {
      rating?: string;
      qualificationCriteria?: Record<string, string>;
      overallScore?: number;
    };
    notes?: Array<{
      id?: string;
      content?: string;
      createdAt?: string | Date;
      updatedAt?: string | Date;
    }>;
    engagementTimeline?: Array<{
      id?: string;
      type?: string;
      content?: string;
      createdAt?: string | Date;
    }>;
  };
};

export type MappedLeadContact = {
  email: string;
  firstName: string;
  lastName: string;
  companyName: string;
  legacyProject: string;
  profile: ContactProfile;
  attributes: Record<string, string>;
  legacyId: string;
};

function asText(value: unknown) {
  return String(value ?? "").trim();
}

function yesNo(value: unknown) {
  const text = asText(value).toLowerCase();
  return text === "yes" || text === "true" || text === "y" || text === "1";
}

function toIso(value: unknown) {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function splitName(fullName: string) {
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function normalizeStatus(value: unknown): LeadStatus | undefined {
  const raw = asText(value).toLowerCase().replace(/\s+/g, "_");
  return (LEAD_STATUS_ORDER as readonly string[]).includes(raw)
    ? (raw as LeadStatus)
    : undefined;
}

function newsToString(value: unknown) {
  if (!value) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const row = item as Record<string, unknown>;
          return [row.title, row.summary, row.content, row.url]
            .map(asText)
            .filter(Boolean)
            .join(" — ");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return undefined;
}

function briefFromLegacy(report: LegacyLeadReport) {
  const ai = report.aiContent?.strategicBrief;
  if (typeof ai === "string" && ai.trim()) {
    return { objective: ai.trim() };
  }
  if (ai && typeof ai === "object") {
    const row = ai as Record<string, unknown>;
    return {
      problem: asText(row.problem || row.challenge) || undefined,
      objective: asText(row.objective || row.goal) || undefined,
      stakes: asText(row.stakes || row.impact) || undefined,
    };
  }
  const pitch = asText(report.problemPitch);
  return pitch ? { problem: pitch } : undefined;
}

export function normalizeProjectKey(name: string) {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

/** Manual aliases: legacy leadData.project → portal projects.name */
export const LEAD_REPORT_PROJECT_ALIASES: Record<string, string> = {
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

export function resolvePortalProjectName(
  legacyProject: string,
  portalNames: string[],
) {
  const legacy = asText(legacyProject);
  if (!legacy) return null;
  const key = normalizeProjectKey(legacy);
  const aliased = LEAD_REPORT_PROJECT_ALIASES[key];
  const target = aliased || legacy;
  const targetKey = normalizeProjectKey(target);
  const exact = portalNames.find(
    (name) => normalizeProjectKey(name) === targetKey,
  );
  if (exact) return exact;
  const contains = portalNames.find((name) => {
    const nk = normalizeProjectKey(name);
    return nk.includes(targetKey) || targetKey.includes(nk);
  });
  return contains || null;
}

export function mapLegacyLeadReport(report: LegacyLeadReport): MappedLeadContact | null {
  const lead = report.leadData || {};
  const email = asText(report.email || lead.contactDetails?.email).toLowerCase();
  if (!email || !email.includes("@")) {
    return null;
  }

  const fromLead = splitName(asText(lead.name));
  const firstName =
    asText(report.firstName) || fromLead.firstName || email.split("@")[0] || "Lead";
  const lastName = asText(report.lastName) || fromLead.lastName;
  const companyName =
    asText(report.companyName) || asText(lead.companyName) || "";
  const legacyProject = asText(lead.project);
  const legacyId = asText(report._id);
  const status = normalizeStatus(lead.status);
  const criteria = lead.leadScoring?.qualificationCriteria || {};
  const meetingAt =
    [asText(report.meetingDate), asText(report.meetingTime)].filter(Boolean).join("T") ||
    undefined;

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

  const news =
    newsToString(report.companyNews) ||
    newsToString(report.aiContent?.news) ||
    undefined;

  const profile: ContactProfile = {
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
    brief: briefFromLegacy(report),
    news,
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
    profile,
    legacyId,
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
