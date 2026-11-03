import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import {
  ANALYTICS_SHARE_TTL_DAYS,
  analyticsShareExpiresAt,
  isAnalyticsShareExpired,
  resolveAnalyticsShareExpiry,
} from "@/lib/analytics";
import {
  listProjectLeadReports,
  type LeadReportListItem,
} from "@/lib/crm-lead-reports-server";
import {
  normalizeLeadReportColumns,
  type LeadReportColumnId,
} from "@/lib/lead-reports-columns";
import { getDb } from "@/lib/mongodb";
import { getProjectBranding } from "@/lib/project-branding";

export { ANALYTICS_SHARE_TTL_DAYS as LEAD_REPORTS_SHARE_TTL_DAYS };

export type LeadReportsShareDoc = {
  _id: ObjectId;
  token: string;
  projectId: ObjectId;
  title: string;
  columns: LeadReportColumnId[];
  createdBy: ObjectId | null;
  createdAt: Date;
  expiresAt: Date;
};

export async function ensureProjectLeadReportsShare(
  projectId: ObjectId,
  userId: ObjectId | null,
  options?: {
    title?: string;
    columns?: readonly string[] | null;
  },
) {
  const title = options?.title?.trim() || "Lead reports";
  const columns = normalizeLeadReportColumns(options?.columns);
  const db = await getDb();
  const shares = db.collection<LeadReportsShareDoc>("lead_reports_shares");

  const existing = await shares.findOne(
    { projectId, expiresAt: { $gt: new Date() } },
    { sort: { createdAt: -1 } },
  );
  if (existing && !isAnalyticsShareExpired(existing)) {
    const nextColumns =
      options?.columns != null
        ? columns
        : normalizeLeadReportColumns(existing.columns);
    const patch: Partial<LeadReportsShareDoc> = {};
    if (existing.title !== title) {
      patch.title = title;
    }
    const sameColumns =
      Array.isArray(existing.columns) &&
      existing.columns.length === nextColumns.length &&
      existing.columns.every((id, index) => id === nextColumns[index]);
    if (!sameColumns) {
      patch.columns = nextColumns;
    }
    if (Object.keys(patch).length > 0) {
      await shares.updateOne({ _id: existing._id }, { $set: patch });
      return { ...existing, ...patch, columns: nextColumns };
    }
    return {
      ...existing,
      columns: nextColumns,
    };
  }

  const createdAt = new Date();
  const doc: LeadReportsShareDoc = {
    _id: new ObjectId(),
    token: randomBytes(18).toString("base64url"),
    projectId,
    title,
    columns,
    createdBy: userId,
    createdAt,
    expiresAt: analyticsShareExpiresAt(createdAt),
  };
  await shares.insertOne(doc);
  return doc;
}

export async function findLeadReportsShareByToken(token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  const db = await getDb();
  return db
    .collection<LeadReportsShareDoc>("lead_reports_shares")
    .findOne({ token: trimmed });
}

export async function getValidLeadReportsShare(token: string) {
  const share = await findLeadReportsShareByToken(token);
  if (!share || isAnalyticsShareExpired(share)) {
    return null;
  }
  return share;
}

export function leadReportsShareExpiresAt(share: LeadReportsShareDoc) {
  return resolveAnalyticsShareExpiry(share);
}

export async function getPublicLeadReportsBundle(token: string) {
  const share = await getValidLeadReportsShare(token);
  if (!share) {
    return null;
  }

  const branding = await getProjectBranding(share.projectId);
  const columns = normalizeLeadReportColumns(share.columns);

  const collected: LeadReportListItem[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const batch = await listProjectLeadReports(share.projectId, {
      page,
      pageSize: 100,
    });
    collected.push(...batch.items);
    totalPages = batch.totalPages;
    page += 1;
  } while (page <= totalPages && page <= 50);

  return {
    share,
    projectName: branding.name || "Workspace",
    projectLogoUrl: branding.logoUrl
      ? `/api/public/lead-reports/${encodeURIComponent(token)}/project-logo`
      : "",
    columns,
    items: collected.map((item) => ({
      id: item.id,
      firstName: item.firstName,
      lastName: item.lastName,
      email: item.email,
      companyName: item.companyName,
      position: item.position,
      solutions: item.solutions,
      leadStage: item.leadStage,
      leadStageLabel: item.leadStageLabel,
      leadProject: item.leadProject,
      leadOwner: item.leadOwner,
      leadReportAt: item.leadReportAt,
      lists: item.lists?.map((list) => ({ id: list.id, name: list.name })),
    })),
    total: collected.length,
    expiresAt: leadReportsShareExpiresAt(share).toISOString(),
  };
}
