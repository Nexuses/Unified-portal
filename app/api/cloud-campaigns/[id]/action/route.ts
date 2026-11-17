import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  pauseCloudSending,
  prepareChromeProfileLogin,
  restartCloudSending,
  resumeCloudSending,
  sendNextCloudRow,
  signInChromeProfileOnBoat,
  startCloudComputer,
  startCloudSending,
  stopCloudSending,
  submitChromeProfileAuthCode,
  clearCloudSendLog,
  checkScriptSender,
  scheduleCloudSending,
  cancelCloudSchedule,
  checkCloudInbox,
  previewCloudRow,
  saveCloudColumnMap,
  probeOutlookSender,
  readSheetThroughSender,
  testScriptSend,
  verifyCloudCsv,
  verifyCloudSheet,
} from "@/lib/cloud-boat-runner";
import { learnBoatMemoryFromSender } from "@/lib/boat-memory";
import {
  getChromeProfile,
  getCloudCampaign,
  markChromeProfileVerified,
  patchCloudCampaignDoc,
  resolveChromeProfileEmail,
} from "@/lib/cloud-campaigns-server";
import { openBoatDesktop } from "@/lib/boat";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

async function maybeLearnSenderMemory(
  projectId: ObjectId,
  profile: { id: string; provider?: string; gmail?: string },
  email: string,
  updatedBy?: string,
) {
  if (!email.includes("@")) return;
  await learnBoatMemoryFromSender(projectId, {
    provider: profile.provider === "outlook" ? "outlook" : "gmail",
    profileId: profile.id,
    email,
    updatedBy,
  }).catch(() => undefined);
}

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

type ActionBody = {
  action?: string;
  sheetUrl?: string;
  profileId?: string;
  email?: string;
  password?: string;
  code?: string;
  csvText?: string;
  xlsxBase64?: string;
  fileName?: string;
  columnMap?: Record<string, unknown>;
  row?: number;
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

    if (action === "sender_check") {
      const result = await checkScriptSender(projectId, id);
      return NextResponse.json({ sender: result, desktopUrl: result.desktopUrl });
    }

    if (action === "sender_test_send" || action === "sender_dry_run") {
      const result = await testScriptSend(projectId, id, {
        dryRun: action === "sender_dry_run",
        to: String(body?.email ?? "").trim() || undefined,
      });
      return NextResponse.json({ sender: result, desktopUrl: result.desktopUrl });
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
        restoredFromSnapshot: result.restoredFromSnapshot,
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
        await maybeLearnSenderMemory(projectId, profile, knownEmail, session.email);
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
        await maybeLearnSenderMemory(projectId, profile, confirmedEmail, session.email);
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
        await maybeLearnSenderMemory(projectId, profile, login.email, session.email);
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
        await maybeLearnSenderMemory(projectId, profile, login.email, session.email);
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

    if (action === "sender_probe_outlook") {
      const result = await probeOutlookSender(projectId, id, String(body?.email ?? ""));
      return NextResponse.json({ probe: result });
    }

    if (action === "sender_read_sheet") {
      const result = await readSheetThroughSender(projectId, id, String(body?.sheetUrl ?? ""));
      return NextResponse.json({ sheet: result });
    }

    if (action === "schedule") {
      const campaign = await scheduleCloudSending(projectId, id);
      return NextResponse.json({ campaign });
    }

    if (action === "cancel_schedule") {
      const campaign = await cancelCloudSchedule(projectId, id);
      return NextResponse.json({ campaign });
    }

    if (action === "check_inbox") {
      const result = await checkCloudInbox(projectId, id);
      const campaign = await getCloudCampaign(projectId, id);
      return NextResponse.json({ inbox: result, campaign });
    }

    if (action === "save_column_map") {
      const campaign = await saveCloudColumnMap(projectId, id, body?.columnMap ?? {});
      return NextResponse.json({ campaign });
    }

    if (action === "preview_row") {
      const preview = await previewCloudRow(projectId, id, typeof body?.row === "number" ? body.row : undefined);
      return NextResponse.json({ preview });
    }

    if (action === "verify_csv") {
      const csvText = String(body?.csvText ?? "");
      const xlsxBase64 = String(body?.xlsxBase64 ?? "");
      if (!csvText.trim() && !xlsxBase64) {
        return NextResponse.json({ error: "Upload a CSV or Excel file first." }, { status: 400 });
      }
      const verified = await verifyCloudCsv(projectId, id, {
        csvText,
        xlsx: xlsxBase64 ? Buffer.from(xlsxBase64, "base64") : undefined,
        fileName: String(body?.fileName ?? ""),
      });
      const campaign = await getCloudCampaign(projectId, id);
      return NextResponse.json({ campaign, ...verified });
    }

    if (action === "verify_sheet") {
      const sheetUrl = String(body?.sheetUrl ?? "").trim();
      if (!sheetUrl) {
        return NextResponse.json(
          { error: "Paste a Google Sheet link first." },
          { status: 400 },
        );
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

    if (action === "pause" || action === "stop") {
      const campaign =
        action === "stop"
          ? await stopCloudSending(projectId, id)
          : await pauseCloudSending(projectId, id);
      return NextResponse.json({ campaign });
    }

    if (action === "resume") {
      const campaign = await resumeCloudSending(projectId, id);
      return NextResponse.json({ campaign });
    }

    if (action === "restart") {
      const campaign = await restartCloudSending(projectId, id);
      return NextResponse.json({ campaign });
    }

    if (action === "clear_send_log") {
      const campaign = await clearCloudSendLog(projectId, id);
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
