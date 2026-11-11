import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteCloudCampaign,
  getChromeProfile,
  getCloudCampaign,
  markChromeProfileVerified,
  patchCloudCampaignDoc,
  resolveChromeProfileEmail,
} from "@/lib/cloud-campaigns-server";
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
      patch.sheetRowCount = 0;
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
