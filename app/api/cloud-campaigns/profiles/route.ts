import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { prepareChromeProfileLogin } from "@/lib/cloud-boat-runner";
import {
  createChromeProfile,
  deleteChromeProfile,
  listChromeProfiles,
  renameChromeProfile,
} from "@/lib/cloud-campaigns-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const maxDuration = 180;

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const profiles = await listChromeProfiles(new ObjectId(session.projectId));
    return NextResponse.json({ profiles });
  } catch (error) {
    console.error("List chrome profiles failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load profiles" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const body = (await request.json().catch(() => null)) as
      | { label?: string; campaignId?: string; openLogin?: boolean; provider?: string }
      | null;
    const projectId = new ObjectId(session.projectId);
    const provider = body?.provider === "outlook" ? "outlook" : "gmail";
    const profile = await createChromeProfile(projectId, {
      label: body?.label,
      provider,
    });
    if (body?.openLogin === false) {
      return NextResponse.json({ profile, needsLogin: true });
    }
    const login = await prepareChromeProfileLogin(
      projectId,
      profile.id,
      typeof body?.campaignId === "string" ? body.campaignId : undefined,
    );
    return NextResponse.json({
      profile: login.email
        ? { ...profile, gmail: login.email || profile.gmail }
        : profile,
      needsLogin: login.needsLogin,
      report: login.report,
      desktopUrl: login.desktopUrl,
    });
  } catch (error) {
    console.error("Create chrome profile failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create profile" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const body = (await request.json().catch(() => null)) as
      | { profileId?: string; label?: string }
      | null;
    const profileId = String(body?.profileId ?? "").trim();
    const label = String(body?.label ?? "");
    if (!profileId) {
      return NextResponse.json({ error: "profileId is required" }, { status: 400 });
    }
    const profile = await renameChromeProfile(
      new ObjectId(session.projectId),
      profileId,
      label,
    );
    if (!profile) {
      return NextResponse.json({ error: "Sender profile not found" }, { status: 404 });
    }
    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Rename chrome profile failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not rename profile" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const profileId = String(
      request.nextUrl.searchParams.get("profileId") || "",
    ).trim();
    if (!profileId) {
      return NextResponse.json({ error: "profileId is required" }, { status: 400 });
    }
    const result = await deleteChromeProfile(
      new ObjectId(session.projectId),
      profileId,
    );
    if (!result.ok && result.reason === "not_found") {
      return NextResponse.json({ error: "Sender profile not found" }, { status: 404 });
    }
    if (!result.ok && result.reason === "in_use_sending") {
      return NextResponse.json(
        {
          error:
            "This sender is used by a campaign that is sending. Pause or finish that campaign first.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete chrome profile failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete profile" },
      { status: 500 },
    );
  }
}
