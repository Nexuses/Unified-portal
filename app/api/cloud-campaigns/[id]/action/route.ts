import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  pauseCloudSending,
  prepareChromeProfileLogin,
  resumeCloudSending,
  sendNextCloudRow,
  signInChromeProfileOnBoat,
  startCloudComputer,
  startCloudSending,
  submitChromeProfileAuthCode,
  verifyCloudSheet,
} from "@/lib/cloud-boat-runner";
import {
  getChromeProfile,
  getCloudCampaign,
  markChromeProfileVerified,
  patchCloudCampaignDoc,
  resolveChromeProfileEmail,
} from "@/lib/cloud-campaigns-server";
import { openBoatDesktop } from "@/lib/boat";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

type ActionBody = {
  action?: string;
  sheetUrl?: string;
  profileId?: string;
  email?: string;
  password?: string;
  code?: string;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const { id } = await params;
    const projectId = new ObjectId(session.projectId);
    const body = (await request.json().catch(() => null)) as ActionBody | null;
    const action = String(body?.action ?? "").trim();
    const existing = await getCloudCampaign(projectId, id);
    if (!existing) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (action === "start_computer") {
      const result = await startCloudComputer(projectId, id);
      const campaign = await getCloudCampaign(projectId, id);
      return NextResponse.json({
        campaign,
        desktopUrl: result.desktopUrl,
        sandboxId: result.sandbox.id,
        state: result.sandbox.state,
        replacedDeletedDisk: result.replacedDeletedDisk,
      });
    }

    if (action === "verify_sender") {
      const profileId = String(body?.profileId || existing.profileId || "").trim();
      if (!profileId) {
        return NextResponse.json({ error: "Pick a sender profile first" }, { status: 400 });
      }
      const profile = await getChromeProfile(projectId, profileId);
      if (!profile) {
        return NextResponse.json({ error: "Gmail profile not found" }, { status: 404 });
      }
      const knownEmail = resolveChromeProfileEmail(profile);
      if (knownEmail && !profile.gmail?.includes("@")) {
        await markChromeProfileVerified(projectId, profileId, knownEmail);
      }
      await patchCloudCampaignDoc(projectId, id, {
        profileId: profile.id,
        profileProvider: profile.provider,
        profileGmail: knownEmail || profile.gmail,
        profileDirectory: profile.directoryName,
      });

      // Already-known inbox address: accept without forcing another Boat login probe.
      if (knownEmail && (profile.verifiedAt || profile.gmail?.includes("@"))) {
        const campaign = await getCloudCampaign(projectId, id);
        return NextResponse.json({
          campaign,
          needsLogin: false,
          report: `Inbox already verified for ${knownEmail}`,
          profile: { ...profile, gmail: knownEmail },
        });
      }

      const login = await prepareChromeProfileLogin(projectId, profileId, id);
      const readyEmail =
        !login.needsLogin && login.email?.includes("@") ? login.email : "";
      const confirmedEmail = readyEmail || knownEmail || "";
      if (confirmedEmail && !login.needsLogin) {
        await markChromeProfileVerified(projectId, profileId, confirmedEmail);
        await patchCloudCampaignDoc(projectId, id, {
          profileGmail: confirmedEmail,
        });
      }
      const campaign = await getCloudCampaign(projectId, id);
      return NextResponse.json({
        campaign,
        needsLogin: login.needsLogin === true,
        needsOtp: login.needsOtp === true,
        needsUserInput: login.needsUserInput === true,
        report: login.report,
        desktopUrl: login.desktopUrl,
        profile: confirmedEmail ? { ...profile, gmail: confirmedEmail } : profile,
      });
    }

    if (action === "sign_in_sender") {
      const profileId = String(body?.profileId || existing.profileId || "").trim();
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      if (!profileId) {
        return NextResponse.json({ error: "Pick a sender profile first" }, { status: 400 });
      }
      if (!isValidEmail(email)) {
        return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
      }
      if (!password) {
        return NextResponse.json({ error: "Password is required" }, { status: 400 });
      }
      const profile = await getChromeProfile(projectId, profileId);
      if (!profile) {
        return NextResponse.json({ error: "Sender profile not found" }, { status: 404 });
      }
      await patchCloudCampaignDoc(projectId, id, {
        profileId: profile.id,
        profileProvider: profile.provider,
        profileGmail: profile.gmail || email,
        profileDirectory: profile.directoryName,
      });
      const login = await signInChromeProfileOnBoat(projectId, profileId, id, {
        email,
        password,
      });
      if (!login.needsLogin && !login.needsOtp && !login.needsUserInput && login.email) {
        await patchCloudCampaignDoc(projectId, id, {
          profileGmail: login.email,
        });
      }
      const campaign = await getCloudCampaign(projectId, id);
      return NextResponse.json({
        campaign,
        needsLogin: login.needsLogin,
        needsOtp: login.needsOtp,
        needsUserInput: login.needsUserInput,
        report: login.report,
        desktopUrl: login.desktopUrl,
        profile: login.email ? { ...profile, gmail: login.email } : profile,
      });
    }

    if (action === "submit_auth_code") {
      const profileId = String(body?.profileId || existing.profileId || "").trim();
      const code = String(body?.code ?? "").trim();
      if (!profileId) {
        return NextResponse.json({ error: "Pick a sender profile first" }, { status: 400 });
      }
      if (!code) {
        return NextResponse.json({ error: "Verification code is required" }, { status: 400 });
      }
      const profile = await getChromeProfile(projectId, profileId);
      if (!profile) {
        return NextResponse.json({ error: "Sender profile not found" }, { status: 404 });
      }
      const login = await submitChromeProfileAuthCode(projectId, profileId, id, { code });
      if (!login.needsLogin && !login.needsOtp && !login.needsUserInput && login.email) {
        await patchCloudCampaignDoc(projectId, id, {
          profileGmail: login.email,
        });
      }
      const campaign = await getCloudCampaign(projectId, id);
      return NextResponse.json({
        campaign,
        needsLogin: login.needsLogin,
        needsOtp: login.needsOtp,
        needsUserInput: login.needsUserInput,
        report: login.report,
        desktopUrl: login.desktopUrl,
        profile: login.email ? { ...profile, gmail: login.email } : profile,
      });
    }

    if (action === "verify_sheet") {
      const sheetUrl = String(body?.sheetUrl || existing.sheetUrl || "").trim();
      if (!sheetUrl) {
        return NextResponse.json({ error: "Paste a Google Sheet link" }, { status: 400 });
      }
      let url: URL;
      try {
        url = new URL(sheetUrl);
      } catch {
        return NextResponse.json({ error: "That sheet link is not a valid URL" }, { status: 400 });
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return NextResponse.json({ error: "Use an http(s) Google Sheet link" }, { status: 400 });
      }
      const verified = await verifyCloudSheet(projectId, id, sheetUrl);
      const campaign = await getCloudCampaign(projectId, id);
      return NextResponse.json({
        campaign,
        ...verified,
      });
    }

    if (action === "start") {
      const campaign = await startCloudSending(projectId, id);
      return NextResponse.json({ campaign });
    }

    if (action === "pause") {
      const campaign = await pauseCloudSending(projectId, id);
      return NextResponse.json({ campaign });
    }

    if (action === "resume") {
      const campaign = await resumeCloudSending(projectId, id);
      return NextResponse.json({ campaign });
    }

    if (action === "tick") {
      const result = await sendNextCloudRow(projectId, id);
      let desktopUrl = "";
      try {
        desktopUrl = await openBoatDesktop(result.sandbox.id);
      } catch {
        desktopUrl = "";
      }
      return NextResponse.json({
        campaign: result.campaign,
        done: result.done,
        needsLogin: result.needsLogin,
        needsOtp: result.needsOtp,
        needsUserInput: result.needsUserInput,
        report: result.report,
        desktopUrl: desktopUrl || undefined,
      });
    }

    return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cloud campaign action failed";
    console.error("Cloud campaign action failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
