import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteCloudCampaign,
  getChromeProfile,
  getChromeProfileDefaults,
  getCloudCampaign,
  getCloudCampaignDoc,
  markChromeProfileVerified,
  patchCloudCampaignDoc,
  resolveChromeProfileEmail,
  saveChromeProfileDefaults,
} from "@/lib/cloud-campaigns-server";
import { columnMapStats, reconcileColumnMap } from "@/lib/cloud-sheet-csv";
import { deleteCloudSends } from "@/lib/cloud-campaign-tracking";
import { deleteCloudFollowups, normalizeFollowupSettings, planCloudFollowups } from "@/lib/cloud-followups";
import { normalizeEmailStyle } from "@/lib/cloud-campaigns";
import { deleteCloudAttachment } from "@/lib/cloud-attachments";
import { isValidTimezone } from "@/lib/cloud-schedule";
import { cleanSignatureHtml } from "@/lib/personalise-types";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const { id } = await params;
    const campaign = await getCloudCampaign(new ObjectId(session.projectId), id);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    return NextResponse.json({ campaign });
  } catch (error) {
    console.error("Get cloud campaign failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load campaign" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const { id } = await params;
    const projectId = new ObjectId(session.projectId);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) {
      patch.name = body.name.trim();
    }
    if (typeof body.sheetUrl === "string") {
      patch.sheetUrl = body.sheetUrl.trim();
      patch.sheetVerifiedAt = undefined;
      patch.sheetHeaders = [];
      patch.sheetSamples = [];
      patch.sheetRows = [];
      patch.sheetRowCount = 0;
      patch.sheetSource = undefined;
      patch.sheetFileName = undefined;
    }
    if (body.gapMinutes !== undefined) {
      const gap = Math.max(0, Math.min(120, Number(body.gapMinutes) || 0));
      patch.gapMinutes = gap;
    }
    if (typeof body.profileId === "string") {
      const profile = await getChromeProfile(projectId, body.profileId);
      if (!profile) {
        return NextResponse.json({ error: "Gmail profile not found" }, { status: 404 });
      }
      const email = resolveChromeProfileEmail(profile);
      if (email && !profile.gmail?.includes("@")) {
        await markChromeProfileVerified(projectId, profile.id, email);
      }
      patch.profileId = profile.id;
      patch.profileProvider = profile.provider;
      patch.profileGmail = email || profile.gmail || "";
      patch.profileDirectory = profile.directoryName;
      // Fill this campaign from what the sender remembers (only where it's still unset).
      const existing = await getCloudCampaignDoc(projectId, id);
      const defaults = await getChromeProfileDefaults(projectId, profile.id);
      if (existing && defaults) {
        if (!existing.signatureReady && defaults.signatureSet && typeof body.signatureHtml !== "string") {
          patch.signatureHtml = defaults.signatureHtml || "";
          patch.signatureReady = true;
        }
        if (typeof defaults.gapMinutes === "number" && body.gapMinutes === undefined && existing.gapMinutes === undefined) {
          patch.gapMinutes = defaults.gapMinutes;
        }
        const current = await getCloudCampaignDoc(projectId, id);
      const headers = Array.isArray(current?.sheetHeaders) ? current.sheetHeaders.map(String) : [];
        const rows = Array.isArray(existing.sheetRows) ? existing.sheetRows : [];
        if (!existing.columnMap && defaults.columnMap && headers.length) {
          const columnMap = reconcileColumnMap(defaults.columnMap, headers, rows);
          patch.columnMap = columnMap;
          patch.columnStats = columnMapStats(rows, columnMap);
        }
      }
    }
    if (body.emailStyle && typeof body.emailStyle === "object") {
      patch.emailStyle = { ...normalizeEmailStyle(body.emailStyle), savedAt: new Date().toISOString() };
    }
    if (body.followups && typeof body.followups === "object") {
      const current = await getCloudCampaignDoc(projectId, id);
      const headers = Array.isArray(current?.sheetHeaders) ? current.sheetHeaders.map(String) : [];
      patch.followups = normalizeFollowupSettings(body.followups, headers);
    }
    if (body.schedule && typeof body.schedule === "object") {
      const raw = body.schedule as Record<string, unknown>;
      const timezone = String(raw.timezone || "UTC");
      if (!isValidTimezone(timezone)) {
        return NextResponse.json({ error: "Unknown timezone" }, { status: 400 });
      }
      const excludedDays = Array.isArray(raw.excludedDays)
        ? [...new Set(raw.excludedDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
        : [];
      const hhmm = (v: unknown) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : undefined);
      const startAt =
        typeof raw.startAt === "string" && raw.startAt && !Number.isNaN(Date.parse(raw.startAt))
          ? new Date(raw.startAt).toISOString()
          : undefined;
      patch.schedule = {
        timezone,
        excludedDays,
        windowStart: hhmm(raw.windowStart),
        windowEnd: hhmm(raw.windowEnd),
        startAt,
      };
    }
    for (const key of ["trackOpens", "trackClicks", "unsubscribeFooter"] as const) {
      if (typeof body[key] === "boolean") patch[key] = body[key];
    }
    if (typeof body.signatureHtml === "string") {
      patch.signatureHtml = cleanSignatureHtml(body.signatureHtml);
    }
    if (body.signatureReady === true) {
      patch.signatureReady = true;
    }
    if (body.signatureReady === false) {
      patch.signatureReady = false;
    }
    if (typeof body.customPrompt === "string") {
      patch.customPrompt = body.customPrompt.trim().slice(0, 4000);
    }
    if (body.customPromptReady === true) {
      patch.customPromptReady = true;
    }
    if (body.customPromptReady === false) {
      patch.customPromptReady = false;
    }
    if (
      body.status === "draft" ||
      body.status === "ready" ||
      body.status === "paused" ||
      body.status === "sending" ||
      body.status === "sent"
    ) {
      patch.status = body.status;
    }

    const campaign = await patchCloudCampaignDoc(projectId, id, patch);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (patch.followups || patch.schedule) {
      // Book / re-time / drop queued follow-ups to match the new settings.
      await planCloudFollowups(projectId, id).catch((error) => console.error("Plan follow-ups failed:", error));
    }
    // Remember the sender's signature and gap for its next campaign.
    if (campaign.profileId && typeof body.profileId !== "string") {
      if (body.signatureReady === true) {
        await saveChromeProfileDefaults(projectId, campaign.profileId, {
          signatureHtml: campaign.signatureHtml || "",
          signatureSet: true,
        });
      }
      if (body.gapMinutes !== undefined) {
        await saveChromeProfileDefaults(projectId, campaign.profileId, { gapMinutes: campaign.gapMinutes });
      }
    }
    return NextResponse.json({ campaign });
  } catch (error) {
    console.error("Patch cloud campaign failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save campaign" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const { id } = await params;
    const projectId = new ObjectId(session.projectId);
    const before = await getCloudCampaignDoc(projectId, id);
    if (before) {
      // Clear its sends while the campaign still exists: the lookup uses its id (indexed).
      await deleteCloudSends(projectId, id);
      await deleteCloudFollowups(projectId, id);
    }
    const ok = await deleteCloudCampaign(projectId, id);
    if (ok) {
      for (const attachment of before?.attachments || []) await deleteCloudAttachment(attachment.id);
    }
    if (!ok) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete cloud campaign failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete campaign" },
      { status: 500 },
    );
  }
}
