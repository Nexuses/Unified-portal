import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  pauseCloudSending,
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
  dryRunCloudFollowup,
} from "@/lib/cloud-boat-runner";
import { learnBoatMemoryFromSender } from "@/lib/boat-memory";
import { previewCloudFollowup, sendCloudFollowupNow } from "@/lib/cloud-followups";
import {
  getChromeProfile,
  getCloudCampaign,
  markChromeProfileVerified,
  patchCloudCampaignDoc,
  resolveChromeProfileEmail,
} from "@/lib/cloud-campaigns-server";
import { boatPhase, cloudBoatStatus, getCloudBoatMeta, isBoatRunning, openBoatDesktop } from "@/lib/boat";
import { ensureCloudVpn, getCloudVpnSetting, setCloudVpnEnabled } from "@/lib/cloud-vpn";
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
  withDesktop?: boolean;
  /** vpn_enable: "India" or "United Arab Emirates" (lib/cloud-campaigns CLOUD_VPN_LOCATIONS). */
  country?: string;
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
  step?: number;
  /** Unsaved follow-up setup to preview (followup_preview only). */
  followups?: unknown;
  focus?: boolean;
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
      const result = await checkScriptSender(projectId, id, { focus: body?.focus === true });
      return NextResponse.json({ sender: result, desktopUrl: result.desktopUrl });
    }

    if (action === "sender_test_send" || action === "sender_dry_run") {
      const result = await testScriptSend(projectId, id, {
        dryRun: action === "sender_dry_run",
        to: String(body?.email ?? "").trim() || undefined,
      });
      return NextResponse.json({ sender: result, desktopUrl: result.desktopUrl });
    }

    if (action === "vpn_status") {
      return NextResponse.json({ vpn: await getCloudVpnSetting(projectId) });
    }

    if (action === "vpn_enable") {
      await setCloudVpnEnabled(
        projectId,
        true,
        session.email,
        typeof body?.country === "string" ? body.country : undefined,
      );
      // Readying the computer installs, signs in and connects NordVPN (or explains why not).
      const result = await startCloudComputer(projectId, id).catch(async (error) => {
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : "Could not connect the VPN",
            vpn: await getCloudVpnSetting(projectId),
          },
          { status: 502 },
        );
      });
      if (result instanceof NextResponse) return result;
      return NextResponse.json({
        campaign: await getCloudCampaign(projectId, id),
        desktopUrl: result.desktopUrl,
        vpn: await getCloudVpnSetting(projectId),
      });
    }

    if (action === "vpn_disable") {
      await setCloudVpnEnabled(projectId, false, session.email);
      // Disconnect now if the computer is on; otherwise the next start does it.
      const { sandbox } = await cloudBoatStatus(projectId);
      if (sandbox && isBoatRunning(sandbox.state)) await ensureCloudVpn(projectId, sandbox.id);
      return NextResponse.json({ vpn: await getCloudVpnSetting(projectId) });
    }

    // Cheap: only asks Boat what the computer is doing (no start, no VPN), plus a live-view link
    // when it is running and the page asked for one.
    if (action === "computer_status") {
      const [{ sandbox }, meta] = await Promise.all([cloudBoatStatus(projectId), getCloudBoatMeta(projectId)]);
      // A saved computer Boat didn't answer for is "unknown", not "none".
      const phase = sandbox ? boatPhase(sandbox.state) : meta.sandboxId ? "unknown" : "none";
      const desktopUrl =
        phase === "running" && sandbox && body?.withDesktop === true
          ? await openBoatDesktop(sandbox.id).catch(() => "")
          : "";
      return NextResponse.json({
        computer: {
          phase,
          state: sandbox?.state || null,
          // When shutting down: since when, so the page can tell a stuck stop from a slow one.
          stoppingSince: phase === "stopping" ? sandbox?.stopPendingSince || sandbox?.updatedAt || null : null,
          checkedAt: new Date().toISOString(),
        },
        desktopUrl: desktopUrl || undefined,
      });
    }

    if (action === "start_computer") {
      const result = await startCloudComputer(projectId, id);
      const campaign = await getCloudCampaign(projectId, id);
      return NextResponse.json({
        vpn: await getCloudVpnSetting(projectId),
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

      // Read the signed-in address straight from the sender's own Chrome (script, a few
      // seconds). This used to ask the AI to look at the desktop, which took up to minutes.
      const check = await checkScriptSender(projectId, id);
      const signedIn = check.ok && check.status === "ready";
      const confirmedEmail = signedIn && check.accountMatches !== false ? String(check.email || "").toLowerCase() : "";
      if (confirmedEmail) {
        await patchCloudCampaignDoc(projectId, id, { profileGmail: confirmedEmail });
        await maybeLearnSenderMemory(projectId, profile, confirmedEmail, session.email);
      }
      const report = confirmedEmail
        ? `Inbox confirmed for ${confirmedEmail}.`
        : signedIn
          ? `This Chrome is signed in as ${check.email}, not ${check.expectedEmail}. Sign out and sign in as ${check.expectedEmail}, then check again.`
          : check.ok && check.status === "login_required"
            ? "Not signed in yet. Finish signing in on the computer, then check again."
            : `Couldn't check the inbox (${check.code || "error"}${check.message ? `: ${String(check.message).slice(0, 120)}` : ""}). Try again.`;
      const campaign = await getCloudCampaign(projectId, id);
      return NextResponse.json({
        campaign,
        needsLogin: !confirmedEmail,
        needsOtp: false,
        needsUserInput: false,
        report,
        desktopUrl: check.desktopUrl,
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

    // A first start needs the "When to send" step saved, so nobody sends on settings they never saw.
    if ((action === "schedule" || action === "start") && !existing.scheduleReady && (existing.sentCount || 0) === 0) {
      return NextResponse.json(
        { error: "Save the When to send step first (step 7): start time, days, hours and gap." },
        { status: 400 },
      );
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

    if (action === "followup_send_now") {
      const row = typeof body?.row === "number" ? Math.max(0, Math.floor(body.row)) : -1;
      const step = typeof body?.step === "number" ? Math.max(1, Math.floor(body.step)) : 1;
      await sendCloudFollowupNow(projectId, id, row, step);
      return NextResponse.json({ ok: true });
    }

    if (action === "followup_preview" || action === "followup_dry_run") {
      const row = typeof body?.row === "number" ? Math.max(0, Math.floor(body.row)) : 0;
      const step = typeof body?.step === "number" ? Math.max(1, Math.floor(body.step)) : 1;
      if (action === "followup_preview") {
        const preview = await previewCloudFollowup(projectId, id, row, step, body?.followups);
        return NextResponse.json({ preview });
      }
      const sender = await dryRunCloudFollowup(projectId, id, row, step);
      return NextResponse.json({ sender });
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
