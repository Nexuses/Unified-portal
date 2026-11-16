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
        const headers = Array.isArray(existing.sheetHeaders) ? existing.sheetHeaders.map(String) : [];
        const rows = Array.isArray(existing.sheetRows) ? existing.sheetRows : [];
        if (!existing.columnMap && defaults.columnMap && headers.length) {
          const columnMap = reconcileColumnMap(defaults.columnMap, headers, rows);
          patch.columnMap = columnMap;
          patch.columnStats = columnMapStats(rows, columnMap);
        }
      }
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
    const ok = await deleteCloudCampaign(new ObjectId(session.projectId), id);
    if (ok) await deleteCloudSends(new ObjectId(session.projectId), id);
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
