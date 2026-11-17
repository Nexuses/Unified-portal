"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import CloudSendersCard from "@/app/components/portal/CloudSendersCard";
import CloudBoatUsageCard from "@/app/components/portal/CloudBoatUsageCard";
import CloudCampaignRunPanel from "@/app/components/portal/CloudCampaignRunPanel";
import CloudCampaignReport from "@/app/components/portal/CloudCampaignReport";
import CloudSchedulePanel from "@/app/components/portal/CloudSchedulePanel";
import CloudAttachmentsPanel from "@/app/components/portal/CloudAttachmentsPanel";
import type { CloudSchedule } from "@/lib/cloud-schedule";
import CloudColumnMapPanel, {
  type CloudRowPreview,
} from "@/app/components/portal/CloudColumnMapPanel";
import { CLOUD_REQUIRED_FIELDS, type CloudColumnMap } from "@/lib/cloud-sheet-csv";
import { useConfirmDialog } from "@/app/components/portal/useConfirmDialog";
import CloudDesktopViewer, {
  type CloudDesktopLayout,
} from "@/app/components/portal/CloudDesktopViewer";
import CloudSenderSignInPanel, {
  type CloudAuthMode,
} from "@/app/components/portal/CloudSenderSignInPanel";
import {
  CLOUD_SHEET_COLUMNS,
  createCloudProfile,
  deleteCloudProfile,
  duplicateCloudCampaign,
  fetchCloudCampaign,
  fetchCloudProfiles,
  formatCloudSenderProvider,
  formatCloudStatus,
  patchCloudCampaign,
  renameCloudProfile,
  runCloudCampaignAction,
  setCloudProfileSensitivityLabel,
  type CloudCampaign,
  type CloudChromeProfile,
  type CloudSenderProvider,
  usesScriptSender,
} from "@/lib/cloud-campaigns";
import { cleanSignatureHtml } from "@/lib/personalise-types";
import { PORTAL_ROUTES } from "@/lib/portal-nav";
import { useRouter } from "next/navigation";

type StepId = "computer" | "sender" | "signature" | "sheet" | "review";



function authModeFromAction(data: Record<string, unknown>): CloudAuthMode | null {
  if (data.needsOtp === true) return "otp";
  if (data.needsUserInput === true) return "user_input";
  if (data.needsLogin === true) return "credentials";
  return null;
}

function needsInteractiveLogin(data: Record<string, unknown>) {
  return (
    data.needsLogin === true ||
    data.needsOtp === true ||
    data.needsUserInput === true
  );
}

export default function PortalCloudCampaignDetailPage({
  campaignId,
}: {
  campaignId: string;
}) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<CloudCampaign | null>(null);
  const [profiles, setProfiles] = useState<CloudChromeProfile[]>([]);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [desktopUrl, setDesktopUrl] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [signatureHtml, setSignatureHtml] = useState("");
  const [signatureTab, setSignatureTab] = useState<"code" | "preview">("code");
  const [gapMinutes, setGapMinutes] = useState(3);
  const [openStep, setOpenStep] = useState<StepId>("computer");
  const [newSenderProvider, setNewSenderProvider] = useState<CloudSenderProvider>("gmail");
  const [authMode, setAuthMode] = useState<CloudAuthMode | null>(null);
  const [authEmailHint, setAuthEmailHint] = useState("");
  const [desktopLayout, setDesktopLayout] = useState<CloudDesktopLayout>("floating");
  const [awaitingLoginConfirm, setAwaitingLoginConfirm] = useState(false);
  const [showPasswordAssist, setShowPasswordAssist] = useState(false);
  const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirm, confirmDialog] = useConfirmDialog();
  const [view, setView] = useState<"setup" | "report">("setup");

  function openDesktopForLogin(url?: string) {
    if (url) setDesktopUrl(url);
    setAwaitingLoginConfirm(true);
    setDesktopLayout("maximized");
    setOpenStep("sender");
  }

  const refresh = useCallback(async () => {
    const [nextCampaign, nextProfiles] = await Promise.all([
      fetchCloudCampaign(campaignId),
      fetchCloudProfiles(),
    ]);
    setCampaign(nextCampaign);
    setProfiles(nextProfiles);
    setSheetUrl(nextCampaign.sheetUrl || "");
    setSignatureHtml(nextCampaign.signatureHtml || "");
    setGapMinutes(nextCampaign.gapMinutes ?? 3);
    return nextCampaign;
  }, [campaignId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await refresh();
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Could not load campaign");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const selectedProfileEmail = useMemo(() => {
    if (!campaign?.profileId) return "";
    const fromCampaign =
      typeof campaign.profileGmail === "string" ? campaign.profileGmail.trim().toLowerCase() : "";
    if (fromCampaign.includes("@")) return fromCampaign;
    const profile = profiles.find((item) => item.id === campaign.profileId);
    const fromProfile = typeof profile?.gmail === "string" ? profile.gmail.trim().toLowerCase() : "";
    if (fromProfile.includes("@")) return fromProfile;
    const fromLabel = typeof profile?.label === "string" ? profile.label.trim().toLowerCase() : "";
    return fromLabel.includes("@") ? fromLabel : "";
  }, [campaign, profiles]);

  const stepsDone = useMemo(() => {
    if (!campaign) {
      return {
        computer: false,
        sender: false,
        senderVerified: false,
        signature: false,
        sheet: false,
        review: false,
      };
    }
    const computer = campaign.computerReady === true;
    const sender = Boolean(campaign.profileId && campaign.profileDirectory);
    const profile = profiles.find((item) => item.id === campaign.profileId);
    const scriptSender = usesScriptSender(profile?.provider || campaign.profileProvider);
    // Script senders are verified only once their dedicated Chrome is signed in as the sender.
    const senderVerified = Boolean(
      sender &&
        selectedProfileEmail.includes("@") &&
        (!scriptSender || profile?.scriptEmail === selectedProfileEmail),
    );
    const signature = campaign.signatureReady === true;
    const columnsMapped = CLOUD_REQUIRED_FIELDS.every((field) => campaign.columnMap?.[field]);
    const sheet = Boolean(
      campaign.sheetVerifiedAt &&
        (campaign.sheetRowCount ?? 0) > 0 &&
        (campaign.sheetUrl?.trim() || campaign.sheetSource === "csv") &&
        // Older campaigns without a saved mapping still count; new ones need the required columns.
        (!campaign.columnMap || (columnsMapped && (campaign.columnStats?.ready ?? 1) > 0)),
    );
    return {
      computer,
      sender,
      senderVerified,
      signature,
      sheet,
      review: computer && senderVerified && signature && sheet,
    };
  }, [campaign, profiles, selectedProfileEmail]);

  const selectedProfile = profiles.find((item) => item.id === campaign?.profileId);
  const scriptSenderSelected = Boolean(
    campaign?.profileId &&
      usesScriptSender(selectedProfile?.provider || campaign?.profileProvider),
  );

  /** Keep campaign.profileGmail in sync when the selected Chrome profile already has an address. */
  useEffect(() => {
    if (!campaign?.profileId || !campaign.profileDirectory) return;
    if (campaign.profileGmail?.includes("@")) return;
    if (!selectedProfileEmail.includes("@")) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await patchCloudCampaign(campaignId, {
          profileId: campaign.profileId,
        });
        if (!cancelled) setCampaign(next);
      } catch {
        /* ignore sync errors; UI still uses selectedProfileEmail */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    campaign?.profileId,
    campaign?.profileDirectory,
    campaign?.profileGmail,
    campaignId,
    selectedProfileEmail,
  ]);

  // Sending runs on the server (lib/cloud-send-worker). While a campaign is sending or
  // scheduled, mirror its live state into the page and surface when it stops.
  useEffect(() => {
    if (campaign?.status !== "sending" && campaign?.status !== "scheduled") return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetchCloudCampaign(campaignId)
        .then((next) => {
          if (cancelled) return;
          setCampaign((prev) => {
            if (prev && prev.status !== next.status) {
              if (next.status === "paused") setNotice(next.lastError || "Sending paused.");
              if (next.status === "sent") setNotice("All rows finished.");
              if (next.status === "sending" && prev.status === "scheduled") setNotice("Scheduled campaign started.");
            }
            return next;
          });
        })
        .catch(() => undefined);
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [campaign?.status, campaignId]);

  async function withBusy<T>(label: string, work: () => Promise<T>) {
    setBusy(label);
    setNotice("");
    try {
      return await work();
    } catch (error) {
      // Show in-page notice only — do not rethrow (avoids the Next.js error overlay).
      setNotice(error instanceof Error ? error.message : "Something went wrong");
      return undefined;
    } finally {
      setBusy("");
    }
  }

  async function startComputer() {
    await withBusy("Starting computer…", async () => {
      const data = await runCloudCampaignAction(campaignId, "start_computer");
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
      if (typeof data.desktopUrl === "string") {
        setDesktopUrl(data.desktopUrl);
        setDesktopLayout("floating");
      }
      if (data.restoredFromSnapshot === true) {
        setNotice(
          "The old computer had expired, so it was rebuilt from your saved backup — senders stay signed in. Click Check sign-in in step 2 to confirm.",
        );
      } else if (data.replacedDeletedDisk === true) {
        setNotice(
          "The old computer disk was deleted, so this is a blank desktop. Sign in to Gmail or Outlook again on the next step.",
        );
      } else {
        setNotice("Computer is on. Pick a sender, then open full screen to sign in if needed.");
      }
      setOpenStep("sender");
    });
  }

  function applyAuthResult(data: Record<string, unknown>) {
    if (data.campaign) setCampaign(data.campaign as CloudCampaign);
    if (typeof data.desktopUrl === "string" && data.desktopUrl) {
      setDesktopUrl(data.desktopUrl);
    }
    if (data.profile) {
      const profile = data.profile as CloudChromeProfile;
      setProfiles((current) =>
        current.map((item) => (item.id === profile.id ? profile : item)),
      );
      if (profile.gmail) setAuthEmailHint(profile.gmail);
    }
    if (needsInteractiveLogin(data)) {
      const mode = authModeFromAction(data);
      if (mode) setAuthMode(mode);
      openDesktopForLogin(
        typeof data.desktopUrl === "string" ? data.desktopUrl : undefined,
      );
      setNotice(
        mode === "otp"
          ? "A verification code is still required. Finish it on the full-screen computer, then confirm."
          : mode === "user_input"
            ? "Finish the phone / captcha step on the full-screen computer, then confirm."
            : "Inbox still needs a sign-in. Use the full-screen computer, then confirm.",
      );
      return false;
    }
    setAuthMode(null);
    setAwaitingLoginConfirm(false);
    setShowPasswordAssist(false);
    setDesktopLayout("floating");
    setNotice("Inbox confirmed. Add a signature next (or continue with none).");
    setOpenStep("signature");
    return true;
  }

  async function selectProfile(profileId: string) {
    await withBusy("Saving sender…", async () => {
      const next = await patchCloudCampaign(campaignId, { profileId });
      setCampaign(next);
      const profile = profiles.find((item) => item.id === profileId);
      setAuthEmailHint(profile?.gmail || next.profileGmail || "");
      setAuthMode(null);
      const verified = Boolean(
        (next.profileGmail && next.profileGmail.includes("@")) ||
          (profile?.gmail && profile.gmail.includes("@")),
      );
      if (usesScriptSender(profile?.provider)) {
        setNotice(
          profile?.scriptEmail
            ? `Sender selected (signed in as ${profile.scriptEmail}). Click “Check sign-in” to confirm.`
            : "Sender selected. Click “Open sender Chrome to sign in” — a one-time Gmail sign-in for this sender.",
        );
      } else if (verified) {
        setAwaitingLoginConfirm(false);
        setNotice("Sender ready. Add a signature next (or continue with none).");
        setOpenStep("signature");
      } else {
        setNotice(
          "Sender selected. Open full screen to sign in, then click “I’ve signed in — check inbox” before you start sending.",
        );
      }
    });
  }

  async function verifySender() {
    if (!campaign?.profileId) {
      setNotice("Pick a sender profile first.");
      return;
    }
    await withBusy("Checking inbox…", async () => {
      const data = await runCloudCampaignAction(campaignId, "verify_sender", {
        profileId: campaign.profileId,
      });
      applyAuthResult(data);
    });
  }

  async function signInSender(input: { email: string; password: string }) {
    if (!campaign?.profileId) {
      setNotice("Pick a sender profile first.");
      return;
    }
    setAuthEmailHint(input.email);
    await withBusy("Signing in on the computer…", async () => {
      const data = await runCloudCampaignAction(campaignId, "sign_in_sender", {
        profileId: campaign.profileId,
        email: input.email,
        password: input.password,
      });
      applyAuthResult(data);
    });
  }

  async function submitAuthCode(code: string) {
    if (!campaign?.profileId) {
      setNotice("Pick a sender profile first.");
      return;
    }
    await withBusy("Submitting code…", async () => {
      const data = await runCloudCampaignAction(campaignId, "submit_auth_code", {
        profileId: campaign.profileId,
        code,
      });
      applyAuthResult(data);
    });
  }

  async function addProfile() {
    await withBusy("Creating Chrome profile…", async () => {
      const label =
        newSenderProvider === "outlook" ? "New Outlook" : "New Gmail";
      const created = await createCloudProfile(newSenderProvider, label, campaignId);
      setProfiles((current) => [...current, created.profile]);
      const next = await patchCloudCampaign(campaignId, { profileId: created.profile.id });
      setCampaign(next);
      setAuthEmailHint(created.profile.gmail || "");
      if (usesScriptSender(newSenderProvider)) {
        const refreshedProfiles = await fetchCloudProfiles();
        setProfiles(refreshedProfiles);
        setNotice("New Gmail sender created. Click “Open sender Chrome to sign in”.");
        return;
      }
      if (created.needsLogin) {
        openDesktopForLogin(created.desktopUrl);
        setNotice(
          `Sign in to ${formatCloudSenderProvider(newSenderProvider)} on the full-screen computer, then confirm with “I’ve signed in — check inbox”.`,
        );
      } else {
        setAuthMode(null);
        setAwaitingLoginConfirm(false);
        if (created.desktopUrl) {
          setDesktopUrl(created.desktopUrl);
          setDesktopLayout("floating");
        }
        setNotice("New profile is ready.");
      }
      const refreshed = await fetchCloudProfiles();
      setProfiles(refreshed);
    });
  }

  async function confirmLoginFromDesktop() {
    if (scriptSenderSelected) {
      await checkScriptSender(false);
      return;
    }
    await verifySender();
  }

  /** No-AI sender: start its dedicated Chrome and check which Gmail account is signed in. */
  async function checkScriptSender(openForSignIn: boolean) {
    if (!campaign?.profileId) {
      setNotice("Pick a sender first.");
      return;
    }
    await withBusy(openForSignIn ? "Opening the sender Chrome…" : "Checking Gmail sign-in…", async () => {
      const data = await runCloudCampaignAction(campaignId, "sender_check");
      const sender = (data.sender || {}) as Record<string, unknown>;
      if (typeof data.desktopUrl === "string" && data.desktopUrl) setDesktopUrl(data.desktopUrl);
      const [nextCampaign, nextProfiles] = await Promise.all([
        fetchCloudCampaign(campaignId),
        fetchCloudProfiles(),
      ]);
      setCampaign(nextCampaign);
      setProfiles(nextProfiles);
      const expected = String(sender.expectedEmail || nextCampaign.profileGmail || "");
      if (sender.ok === true && sender.status === "ready" && sender.accountMatches === true) {
        setAwaitingLoginConfirm(false);
        setDesktopLayout("floating");
        setNotice(`Signed in as ${String(sender.email)}. Sending will run without AI.`);
        setOpenStep("signature");
        return;
      }
      if (sender.ok === true && sender.status === "ready") {
        setAwaitingLoginConfirm(true);
        setDesktopLayout("maximized");
        setNotice(
          `The sender Chrome is signed in as ${String(sender.email)}, not ${expected}. Take control, switch to ${expected}, then click Check sign-in.`,
        );
        return;
      }
      if (sender.ok === true && sender.status === "login_required") {
        setAwaitingLoginConfirm(true);
        setDesktopLayout("maximized");
        setNotice(
          `Take control and sign in to Gmail${expected ? ` as ${expected}` : ""} in the Chrome window, then click “Check sign-in”. You only do this once per sender.`,
        );
        return;
      }
      setNotice(
        `Couldn't check the sender Chrome (${String(sender.code || "error")}${
          sender.message ? `: ${String(sender.message).slice(0, 140)}` : ""
        }). Try again.`,
      );
    });
  }

  async function saveSchedule(schedule: CloudSchedule) {
    await withBusy("Saving schedule…", async () => {
      const next = await patchCloudCampaign(campaignId, { schedule });
      setCampaign(next);
      setNotice(
        schedule.startAt
          ? "Schedule saved. Click Schedule to queue it, or Start now to begin within the allowed days and hours."
          : "Schedule saved. Emails only go out on the allowed days and hours.",
      );
    });
  }

  async function scheduleSending() {
    await withBusy("Scheduling…", async () => {
      const data = await runCloudCampaignAction(campaignId, "schedule");
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
      setNotice("Scheduled. It starts on its own — you can close this page.");
    });
  }

  async function cancelSchedule() {
    await withBusy("Cancelling schedule…", async () => {
      const data = await runCloudCampaignAction(campaignId, "cancel_schedule");
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
      setNotice("Schedule cancelled.");
    });
  }

  async function checkInboxNow(): Promise<string> {
    const data = await runCloudCampaignAction(campaignId, "check_inbox");
    if (data.campaign) setCampaign(data.campaign as CloudCampaign);
    const inbox = (data.inbox || {}) as { checked?: number; newReplies?: number; newBounces?: number };
    const checked = inbox.checked ?? 0;
    return `Checked ${checked} address${checked === 1 ? "" : "es"}: ${inbox.newReplies ?? 0} new repl${inbox.newReplies === 1 ? "y" : "ies"}, ${inbox.newBounces ?? 0} new bounce${inbox.newBounces === 1 ? "" : "s"}.`;
  }

  async function saveTracking(patch: { trackOpens?: boolean; trackClicks?: boolean; unsubscribeFooter?: boolean }) {
    const next = await patchCloudCampaign(campaignId, patch);
    setCampaign(next);
  }

  async function saveColumnMap(map: CloudColumnMap) {
    await withBusy("Saving column mapping…", async () => {
      const data = await runCloudCampaignAction(campaignId, "save_column_map", { columnMap: map });
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
    });
  }

  async function previewRow(row?: number): Promise<CloudRowPreview | null> {
    try {
      const data = await runCloudCampaignAction(
        campaignId,
        "preview_row",
        typeof row === "number" ? { row } : undefined,
      );
      return (data.preview as CloudRowPreview) || null;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not build the preview");
      return null;
    }
  }

  async function saveSensitivityLabel(label: string) {
    if (!campaign?.profileId) return;
    await withBusy("Saving sensitivity label…", async () => {
      const profile = await setCloudProfileSensitivityLabel(campaign.profileId!, label);
      setProfiles((current) => current.map((item) => (item.id === profile.id ? profile : item)));
      setNotice(
        label
          ? `Every email from this sender will be labelled “${label}”.`
          : "Sensitivity label cleared.",
      );
    });
  }

  /** Send row 1's email as a test (to the sender itself, or to any address) via the no-AI sender. */
  async function sendTestToSelf(to?: string) {
    const target = (to || "").trim();
    if (to !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setNotice("Enter a valid email address for the test.");
      return;
    }
    await withBusy(target ? `Sending a test email to ${target}…` : "Sending a test email to yourself…", async () => {
      const data = await runCloudCampaignAction(
        campaignId,
        "sender_test_send",
        target ? { email: target } : undefined,
      );
      const sender = (data.sender || {}) as Record<string, unknown>;
      if (sender.ok === true && sender.status === "sent") {
        setNotice(
          `Test email sent to ${String(sender.to)}${
            sender.inSent === true ? " and confirmed in Gmail Sent" : ""
          }. Check its formatting in your inbox.`,
        );
        return;
      }
      if (sender.code === "SENSITIVITY_LABEL_REQUIRED" || sender.code === "SENSITIVITY_LABEL_NOT_FOUND") {
        setProfiles(await fetchCloudProfiles());
        setOpenStep("sender");
        setNotice(
          "Your Outlook organisation requires a sensitivity label. Pick one for this sender in step 2, then send the test again. Nothing was sent.",
        );
        return;
      }
      setNotice(
        `Test email was not sent (${String(sender.code || "error")}${
          sender.message ? `: ${String(sender.message).slice(0, 160)}` : ""
        }).`,
      );
    });
  }

  async function uploadCsv(file: File) {
    if (file.size > 2_000_000) {
      setNotice("That CSV is larger than 2 MB. Split it into smaller files.");
      return;
    }
    await withBusy("Reading the CSV…", async () => {
      const csvText = await file.text();
      const data = await runCloudCampaignAction(campaignId, "verify_csv", {
        csvText,
        fileName: file.name,
      });
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
      const missing = Array.isArray(data.missingExpected) ? (data.missingExpected as string[]) : [];
      setNotice(
        `CSV ready: ${String(data.rowCount ?? 0)} people · columns ${
          Array.isArray(data.headers) ? (data.headers as string[]).join(", ") : ""
        }${missing.length ? `. Missing recommended: ${missing.join(", ")}` : ""}.`,
      );
      setOpenStep("sheet");
    });
  }

  async function saveSignature(continueNext: boolean) {
    await withBusy("Saving signature…", async () => {
      const cleaned = cleanSignatureHtml(signatureHtml);
      const next = await patchCloudCampaign(campaignId, {
        signatureHtml: cleaned,
        signatureReady: true,
      });
      setCampaign(next);
      setSignatureHtml(next.signatureHtml || cleaned);
      setNotice(
        cleaned
          ? "Signature saved. It will be appended under each email."
          : "No signature saved. Emails will use the sheet content only.",
      );
      if (continueNext) setOpenStep("sheet");
    });
  }



  async function verifySheet() {
    const url = sheetUrl.trim();
    if (!url) {
      setNotice("Paste a Google Sheet link first.");
      return;
    }
    await withBusy("Verifying sheet on the computer…", async () => {
      const next = await patchCloudCampaign(campaignId, { sheetUrl: url });
      setCampaign(next);
      const data = await runCloudCampaignAction(campaignId, "verify_sheet", {
        sheetUrl: url,
      });
      if (typeof data.desktopUrl === "string" && data.desktopUrl) {
        setDesktopUrl(data.desktopUrl);
      }
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
      if (needsInteractiveLogin(data)) {
        const blocked = authModeFromAction(data);
        if (blocked) setAuthMode(blocked);
        openDesktopForLogin(
          typeof data.desktopUrl === "string" ? data.desktopUrl : undefined,
        );
        setNotice(
          typeof data.report === "string" && data.report
            ? data.report
            : "Google needs a sign-in on the computer before the sheet can be read.",
        );
        return;
      }
      if (data.ok === true) {
        setNotice(
          `Sheet ready: ${String(data.rowCount ?? 0)} people · columns ${
            Array.isArray(data.headers) ? (data.headers as string[]).join(", ") : "discovered"
          }.`,
        );
        setOpenStep("sheet");
      } else {
        setNotice(
          typeof data.report === "string" && data.report
            ? data.report
            : typeof data.error === "string"
              ? data.error
              : "Could not verify the Google Sheet. Check the link and try again.",
        );
      }
    });
  }

  function startRename(profile: CloudChromeProfile) {
    setRenamingProfileId(profile.id);
    setRenameDraft(profile.label || profile.gmail || "");
  }

  function cancelRename() {
    setRenamingProfileId(null);
    setRenameDraft("");
  }

  async function commitRename(profileId: string) {
    const nextLabel = renameDraft.trim();
    if (!nextLabel) {
      setNotice("Sender name cannot be empty.");
      return;
    }
    await withBusy("Renaming sender…", async () => {
      const updated = await renameCloudProfile(profileId, nextLabel);
      setProfiles((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      cancelRename();
      setNotice(`Sender renamed to “${updated.label}”.`);
    });
  }

  async function deleteProfile(profile: CloudChromeProfile) {
    const label =
      profile.gmail ||
      `${formatCloudSenderProvider(profile.provider)}${profile.label ? ` · ${profile.label}` : ""}`;
    const ok = await confirm(
      `Campaigns using “${label}” will need a new sender. This can't be undone.`,
      { title: "Delete sender?", confirmLabel: "Delete", danger: true },
    );
    if (!ok) return;
    await withBusy("Deleting sender…", async () => {
      await deleteCloudProfile(profile.id);
      const refreshed = await fetchCloudProfiles();
      setProfiles(refreshed);
      if (campaign?.profileId === profile.id) {
        const next = await refresh();
        setAwaitingLoginConfirm(false);
        setAuthMode(null);
        setNotice("Sender deleted. Pick or create another profile.");
        setOpenStep("sender");
        setCampaign(next);
      } else {
        setNotice("Sender deleted.");
      }
    });
  }

  async function saveGap() {
    await withBusy("Saving gap…", async () => {
      const clamped = Math.max(0, Math.min(120, Math.round(Number(gapMinutes)) || 0));
      const next = await patchCloudCampaign(campaignId, { gapMinutes: clamped });
      setCampaign(next);
      setGapMinutes(next.gapMinutes);
      setNotice(
        next.gapMinutes === 0
          ? "Gap saved: no wait between emails (short pause only)."
          : `Gap saved: ${next.gapMinutes} minute${next.gapMinutes === 1 ? "" : "s"} between emails.`,
      );
    });
  }

  async function startSending() {
    await withBusy("Starting send…", async () => {
      const data = await runCloudCampaignAction(campaignId, "start");
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
      setNotice("Sending started on the server — one email at a time. You can close this page.");
    });
  }

  async function stopSending() {
    await withBusy("Stopping…", async () => {
      const data = await runCloudCampaignAction(campaignId, "stop");
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
      setNotice("Stopped. Progress is kept — Resume continues from the next row.");
    });
  }

  async function resumeSending() {
    await withBusy("Resuming…", async () => {
      const data = await runCloudCampaignAction(campaignId, "resume");
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
      setNotice("Resumed from the next people row.");
    });
  }

  async function restartSending() {
    const ok = await confirm("Sent/failed counts and the send log will be cleared, and sending starts again from row 1.", {
      title: "Restart from row 1?",
      confirmLabel: "Restart",
    });
    if (!ok) return;
    await withBusy("Restarting send…", async () => {
      const data = await runCloudCampaignAction(campaignId, "restart");
      if (data.campaign) {
        const next = data.campaign as CloudCampaign;
        setCampaign(next);
        if (typeof next.gapMinutes === "number" && Number.isFinite(next.gapMinutes)) {
          setGapMinutes(Math.max(0, Math.min(120, Math.round(next.gapMinutes))));
        }
      }
      setNotice("Restarted from row 1. Sending…");
    });
  }

  async function duplicateThisCampaign() {
    await withBusy("Duplicating…", async () => {
      const copy = await duplicateCloudCampaign(campaignId);
      setNotice(`Created “${copy.name}”. Opening…`);
      router.push(`${PORTAL_ROUTES.cloud}/${encodeURIComponent(copy.id)}`);
    });
  }

  async function clearSendLog() {
    const ok = await confirm("Send progress (next row) is kept.", {
      title: "Clear recent sends?",
      confirmLabel: "Clear",
    });
    if (!ok) return;
    await withBusy("Clearing send history…", async () => {
      const data = await runCloudCampaignAction(campaignId, "clear_send_log");
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
      setNotice("Recent sends cleared.");
    });
  }

  if (loadError) {
    return (
      <div className="drip-detail-page">
        <p className="crm-error">{loadError}</p>
        <Link href={PORTAL_ROUTES.cloud}>Back to Cloud campaigns</Link>
      </div>
    );
  }

  if (!campaign) {
    return <div className="portal-loading-screen">Loading campaign…</div>;
  }

  const requiredDone = [
    stepsDone.computer,
    stepsDone.senderVerified,
    stepsDone.signature,
    stepsDone.sheet,
  ].filter(Boolean).length;
  const blockedReason = !stepsDone.computer
    ? "start the computer (step 1)."
    : !stepsDone.senderVerified
      ? "sign in the sender and click Check sign-in (step 2)."
      : !stepsDone.signature
        ? "save the signature step — it can be empty (step 3)."
        : !stepsDone.sheet
          ? campaign.sheetVerifiedAt
            ? "check the column mapping — email, subject and body must be mapped (step 4)."
            : "add people with a CSV or Google Sheet (step 4)."
          : undefined;
  const signaturePreview = cleanSignatureHtml(signatureHtml);
  const sheetHeaders = campaign.sheetHeaders ?? [];

  return (
    <div
      className={`drip-detail-page cloud-detail-page${
        desktopLayout === "maximized" ? " is-desktop-maximized" : ""
      }`}
    >
      <div className="cloud-detail-main">
        <div className="drip-detail-head">
          <div className="drip-detail-title-wrap">
            <Link href={PORTAL_ROUTES.cloud} className="drip-back" aria-label="Back to campaigns">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Link>
            <h2>{campaign.name}</h2>
            <div className="drip-detail-badges">
              <span className="drip-status-pill">{formatCloudStatus(campaign.status)}</span>
            </div>
          </div>
          <div className="drip-detail-actions">
            <CloudBoatUsageCard />
            <CloudSendersCard refreshKey={profiles.length + (campaign.profileId ? 1 : 0)} />
            <button
              type="button"
              className="btn-soft"
              disabled={Boolean(busy)}
              onClick={() => void duplicateThisCampaign()}
            >
              Duplicate
            </button>
          </div>
        </div>

        {notice ? <div className="cloud-notice">{notice}</div> : null}
        {busy ? <div className="cloud-busy">{busy}</div> : null}

        <div className="cloud-view-tabs" role="tablist" aria-label="Campaign view">
          <button
            type="button"
            role="tab"
            aria-selected={view === "setup"}
            className={view === "setup" ? "is-active" : ""}
            onClick={() => setView("setup")}
          >
            Setup
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "report"}
            className={view === "report" ? "is-active" : ""}
            onClick={() => setView("report")}
          >
            Report
            {campaign.sentCount > 0 ? <span>{campaign.sentCount}</span> : null}
          </button>
        </div>

        <CloudCampaignRunPanel
          campaign={campaign}
          busy={Boolean(busy)}
          ready={stepsDone.review}
          blockedReason={blockedReason}
          senderLabel={
            stepsDone.senderVerified
              ? `${formatCloudSenderProvider(selectedProfile?.provider || campaign.profileProvider)} · ${selectedProfileEmail}`
              : "Sender not signed in"
          }
          peopleLabel={
            stepsDone.sheet
              ? `${campaign.sheetSource === "csv" ? campaign.sheetFileName || "CSV" : "Google Sheet"} · ${campaign.sheetRowCount ?? 0} people`
              : "No people yet"
          }
          gapMinutes={gapMinutes}
          onGapChange={setGapMinutes}
          onSaveGap={() => void saveGap()}
          onStart={() => void startSending()}
          onStop={() => void stopSending()}
          onResume={() => void resumeSending()}
          onRestart={() => void restartSending()}
          onClearLog={() => void clearSendLog()}
          onSendTest={(to) => void sendTestToSelf(to)}
          canTest={stepsDone.senderVerified && stepsDone.sheet}
          canSchedule={Boolean(
            campaign.schedule?.startAt && new Date(campaign.schedule.startAt).getTime() > Date.now() + 60_000,
          )}
          onSchedule={() => void scheduleSending()}
          onCancelSchedule={() => void cancelSchedule()}
          scheduleSlot={
            <CloudSchedulePanel
              key={`${campaign.status}-${campaign.schedule?.timezone || ""}-${campaign.schedule?.startAt || ""}`}
              schedule={campaign.schedule}
              nextSendAt={campaign.nextSendAt}
              status={campaign.status}
              busy={Boolean(busy)}
              onSave={saveSchedule}
            />
          }
        />

        {view === "report" ? (
          <CloudCampaignReport
            campaignId={campaignId}
            campaignName={campaign.name}
            sending={campaign.status === "sending"}
            onCheckInbox={checkInboxNow}
            onTrackingChange={saveTracking}
          />
        ) : (
        <div className="drip-setup-card drip-setup-card-active">
          <div className="drip-setup-intro">
            <div className="drip-setup-intro-copy">
              <strong>Set up this cloud campaign</strong>
              <span>
                Five quick steps, then start from the panel above. Recommended people columns:{" "}
                {CLOUD_SHEET_COLUMNS.join(", ")}.
              </span>
            </div>
            <div className="drip-setup-intro-meter" aria-hidden="true">
              {[0, 1, 2, 3].map((index) => (
                <span key={index} className={index < requiredDone ? "done" : ""} />
              ))}
            </div>
          </div>

          <div className="cloud-step-list">
            <section className={`cloud-step${openStep === "computer" ? " open" : ""}${stepsDone.computer ? " done" : ""}`}>
              <button type="button" className="cloud-step-head" onClick={() => setOpenStep("computer")}>
                <span className="cloud-step-title"><i className="cloud-step-num" aria-hidden="true">{stepsDone.computer ? "✓" : "1"}</i>Computer</span>
                <em>{stepsDone.computer ? "Ready" : "Start"}</em>
              </button>
              {openStep === "computer" ? (
                <div className="cloud-step-body">
                  <p>
                    Starts or resumes this project&apos;s own Boat desktop (not shared with other
                    projects). Machine billing runs only while the computer is on; it stops when
                    you pause/finish a campaign or after ~30 minutes idle. While a campaign is
                    sending, chat cannot drive the same computer.
                  </p>
                  <button
                    type="button"
                    className="btn-dark"
                    disabled={Boolean(busy)}
                    onClick={() => void startComputer()}
                  >
                    {stepsDone.computer ? "Refresh computer" : "Start computer"}
                  </button>
                </div>
              ) : null}
            </section>

            <section
              className={`cloud-step${openStep === "sender" ? " open" : ""}${
                stepsDone.senderVerified ? " done" : ""
              }`}
            >
              <button type="button" className="cloud-step-head" onClick={() => setOpenStep("sender")}>
                <span className="cloud-step-title"><i className="cloud-step-num" aria-hidden="true">{stepsDone.senderVerified ? "✓" : "2"}</i>Email sender</span>
                <em>
                  {!campaign.profileId
                    ? "Pick profile"
                    : stepsDone.senderVerified
                      ? `${formatCloudSenderProvider(campaign.profileProvider)} · ${
                          selectedProfile?.label || campaign.profileGmail
                        }`
                      : "Selected — confirm inbox"}
                </em>
              </button>
              {openStep === "sender" ? (
                <div className="cloud-step-body">
                  <p>
                    Each sender has its own Chrome on the computer. Sign in once (Take control →
                    sign in to Gmail or Outlook), then every email is sent by a script — no AI.
                  </p>
                  <span className="cloud-toggle-label">New sender type</span>
                  <div className="cloud-provider-toggle" role="group" aria-label="New sender type">
                    <button
                      type="button"
                      className={newSenderProvider === "gmail" ? "is-active" : ""}
                      onClick={() => setNewSenderProvider("gmail")}
                    >
                      Gmail
                    </button>
                    <button
                      type="button"
                      className={newSenderProvider === "outlook" ? "is-active" : ""}
                      onClick={() => setNewSenderProvider("outlook")}
                    >
                      Outlook
                    </button>
                  </div>
                  <div className="cloud-profile-list">
                    {profiles.length === 0 ? (
                      <p className="cloud-muted">No profiles yet.</p>
                    ) : (
                      profiles.map((profile) => (
                        <div key={profile.id} className="cloud-profile-row">
                          {renamingProfileId === profile.id ? (
                            <div className="cloud-profile-rename">
                              <input
                                type="text"
                                value={renameDraft}
                                maxLength={80}
                                autoFocus
                                disabled={Boolean(busy)}
                                aria-label="Sender name"
                                onChange={(event) => setRenameDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void commitRename(profile.id);
                                  }
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelRename();
                                  }
                                }}
                              />
                              <button
                                type="button"
                                className="btn-dark"
                                disabled={Boolean(busy)}
                                onClick={() => void commitRename(profile.id)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="btn-soft"
                                disabled={Boolean(busy)}
                                onClick={cancelRename}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <>
                              <label className="cloud-profile-select">
                                <input
                                  type="radio"
                                  name="cloud-profile"
                                  checked={campaign.profileId === profile.id}
                                  onChange={() => void selectProfile(profile.id)}
                                />
                                <span>
                                  <button
                                    type="button"
                                    className="cloud-profile-name"
                                    disabled={Boolean(busy)}
                                    title="Click to rename"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      startRename(profile);
                                    }}
                                  >
                                    {profile.label ||
                                      formatCloudSenderProvider(profile.provider)}
                                  </button>
                                  <small>
                                    {formatCloudSenderProvider(profile.provider)}
                                    {" · "}
                                    {profile.gmail || "Not verified"}
                                  </small>
                                </span>
                              </label>
                              <button
                                type="button"
                                className="cloud-profile-rename-btn"
                                disabled={Boolean(busy)}
                                aria-label={`Rename sender ${profile.label || profile.gmail || profile.id}`}
                                title="Rename sender"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  startRename(profile);
                                }}
                              >
                                <Pencil size={15} strokeWidth={2} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="cloud-profile-delete"
                                disabled={Boolean(busy)}
                                aria-label={`Delete sender ${profile.gmail || profile.label || profile.id}`}
                                title="Delete sender"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void deleteProfile(profile);
                                }}
                              >
                                <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                              </button>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  {scriptSenderSelected ? (
                    <>
                      <p className={`cloud-sender-status${stepsDone.senderVerified ? " is-ok" : ""}`}>
                        {selectedProfile?.scriptEmail
                          ? `Sender Chrome signed in as ${selectedProfile.scriptEmail}${
                              selectedProfile.scriptCheckedAt
                                ? ` · checked ${new Date(selectedProfile.scriptCheckedAt).toLocaleString()}`
                                : ""
                            }`
                          : "Sender Chrome not signed in yet."}
                      </p>
                      {selectedProfile?.provider === "outlook" ? (
                        <label className="crm-field cloud-sensitivity">
                          <span>
                            Sensitivity label{" "}
                            <small>
                              (only if your organisation requires one — applied to every email)
                            </small>
                          </span>
                          {selectedProfile.sensitivityLabels?.length ? (
                            <select
                              value={selectedProfile.sensitivityLabel || ""}
                              disabled={Boolean(busy)}
                              onChange={(event) => void saveSensitivityLabel(event.target.value)}
                            >
                              <option value="">None</option>
                              {selectedProfile.sensitivityLabels.map((label) => (
                                <option key={label} value={label}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              defaultValue={selectedProfile.sensitivityLabel || ""}
                              placeholder="e.g. General — or send a test to load the list"
                              disabled={Boolean(busy)}
                              onBlur={(event) => {
                                const value = event.target.value.trim();
                                if (value !== (selectedProfile.sensitivityLabel || "")) {
                                  void saveSensitivityLabel(value);
                                }
                              }}
                            />
                          )}
                        </label>
                      ) : null}
                      <div className="cloud-step-actions">
                        <button
                          type="button"
                          className="btn-soft"
                          disabled={Boolean(busy)}
                          onClick={() => void addProfile()}
                        >
                          Add another sender
                        </button>
                        <button
                          type="button"
                          className={stepsDone.senderVerified ? "btn-soft" : "btn-dark"}
                          disabled={Boolean(busy)}
                          onClick={() => void checkScriptSender(true)}
                        >
                          Open sender Chrome to sign in
                        </button>
                        <button
                          type="button"
                          className={stepsDone.senderVerified ? "btn-soft" : "btn-dark"}
                          disabled={Boolean(busy)}
                          onClick={() => void checkScriptSender(false)}
                        >
                          Check sign-in
                        </button>
                      </div>
                    </>
                  ) : (
                  <div className="cloud-step-actions">
                    <button type="button" className="btn-soft" disabled={Boolean(busy)} onClick={() => void addProfile()}>
                      Sign in as someone else
                    </button>
                    <button
                      type="button"
                      className="btn-dark"
                      disabled={Boolean(busy) || !campaign.profileId}
                      onClick={() => {
                        void (async () => {
                          setAwaitingLoginConfirm(true);
                          if (!desktopUrl) {
                            await withBusy("Opening computer…", async () => {
                              const data = await runCloudCampaignAction(
                                campaignId,
                                "start_computer",
                              );
                              if (data.campaign) {
                                setCampaign(data.campaign as CloudCampaign);
                              }
                              if (typeof data.desktopUrl === "string") {
                                setDesktopUrl(data.desktopUrl);
                              }
                            });
                          }
                          setDesktopLayout("maximized");
                        })();
                      }}
                    >
                      Open full screen to sign in
                    </button>
                    <button
                      type="button"
                      className="btn-soft"
                      disabled={Boolean(busy) || !campaign.profileId}
                      onClick={() => void verifySender()}
                    >
                      I’ve signed in — check inbox
                    </button>
                    {campaign.profileId ? (
                      <button
                        type="button"
                        className="btn-soft"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          const selected = profiles.find((item) => item.id === campaign.profileId);
                          setAuthEmailHint(selected?.gmail || campaign.profileGmail || "");
                          setAuthMode((current) => current || "credentials");
                          setShowPasswordAssist((current) => !current);
                        }}
                      >
                        {showPasswordAssist ? "Hide password assist" : "Password assist (optional)"}
                      </button>
                    ) : null}
                  </div>
                  )}
                  {awaitingLoginConfirm ? (
                    <p className="cloud-auth-hint">
                      Waiting for your confirmation after you finish sign-in on the computer.
                    </p>
                  ) : null}
                  {showPasswordAssist && campaign.profileId && !scriptSenderSelected ? (
                    <CloudSenderSignInPanel
                      key={`${campaign.profileId}-${authMode || "credentials"}-${authEmailHint}`}
                      provider={
                        profiles.find((item) => item.id === campaign.profileId)?.provider ||
                        campaign.profileProvider ||
                        newSenderProvider
                      }
                      mode={authMode || "credentials"}
                      busy={Boolean(busy)}
                      desktopUrl={desktopUrl || undefined}
                      initialEmail={authEmailHint || campaign.profileGmail || ""}
                      onSignIn={signInSender}
                      onSubmitCode={submitAuthCode}
                      onSwitchToCredentials={() => setAuthMode("credentials")}
                    />
                  ) : null}
                </div>
              ) : null}
            </section>

            <section
              className={`cloud-step${openStep === "signature" ? " open" : ""}${stepsDone.signature ? " done" : ""}`}
            >
              <button
                type="button"
                className="cloud-step-head"
                onClick={() => {
                  if (!stepsDone.sender) {
                    setNotice("Pick a sender first, then add a signature.");
                    setOpenStep("sender");
                    return;
                  }
                  setOpenStep("signature");
                }}
              >
                <span className="cloud-step-title"><i className="cloud-step-num" aria-hidden="true">{stepsDone.signature ? "✓" : "3"}</i>Signature &amp; attachments</span>
                <em>
                  {!stepsDone.sender
                    ? "Locked until sender selected"
                    : stepsDone.signature
                      ? signaturePreview
                        ? "Saved"
                        : "None"
                      : "HTML code"}
                </em>
              </button>
              {openStep === "signature" && stepsDone.sender ? (
                <div className="cloud-step-body">
                  <p>
                    Paste signature HTML for this campaign. It is appended under each pitch when
                    the computer sends. Leave empty and continue if you do not want a signature.
                  </p>
                  <div className="pz-signature-tabs" role="tablist" aria-label="Signature editor">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={signatureTab === "code"}
                      className={signatureTab === "code" ? "active" : ""}
                      onClick={() => setSignatureTab("code")}
                    >
                      Code
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={signatureTab === "preview"}
                      className={signatureTab === "preview" ? "active" : ""}
                      onClick={() => setSignatureTab("preview")}
                    >
                      Preview
                    </button>
                  </div>
                  {signatureTab === "code" ? (
                    <textarea
                      className="pz-signature-input cloud-signature-input"
                      value={signatureHtml}
                      onChange={(event) => setSignatureHtml(event.target.value)}
                      placeholder={"<div>Best regards,<br>Your Name</div>"}
                      rows={10}
                      spellCheck={false}
                    />
                  ) : signaturePreview ? (
                    <div className="pz-signature-preview">
                      <div
                        className="pz-signature-scroll"
                        dangerouslySetInnerHTML={{ __html: signaturePreview }}
                      />
                    </div>
                  ) : (
                    <p className="pz-signature-empty">Paste signature HTML in Code first.</p>
                  )}
                  <div className="cloud-step-actions">
                    <button
                      type="button"
                      className="btn-soft"
                      disabled={Boolean(busy)}
                      onClick={() => void saveSignature(false)}
                    >
                      Save signature
                    </button>
                    <button
                      type="button"
                      className="btn-dark"
                      disabled={Boolean(busy)}
                      onClick={() => void saveSignature(true)}
                    >
                      Save &amp; continue
                    </button>
                  </div>
                  <CloudAttachmentsPanel
                    campaign={campaign}
                    disabled={Boolean(busy)}
                    onChange={setCampaign}
                    onError={setNotice}
                  />
                </div>
              ) : null}
            </section>

            <section className={`cloud-step${openStep === "sheet" ? " open" : ""}${stepsDone.sheet ? " done" : ""}`}>
              <button
                type="button"
                className="cloud-step-head"
                onClick={() => {
                  if (!stepsDone.sender) {
                    setNotice("Pick a sender first, then continue.");
                    setOpenStep("sender");
                    return;
                  }
                  if (!stepsDone.signature) {
                    setNotice("Save the signature step first (you can leave it empty).");
                    setOpenStep("signature");
                    return;
                  }
                  setOpenStep("sheet");
                }}
              >
                <span className="cloud-step-title"><i className="cloud-step-num" aria-hidden="true">{stepsDone.sheet ? "✓" : "4"}</i>People</span>
                <em>
                  {!stepsDone.sender || !stepsDone.signature
                    ? "Locked until earlier steps done"
                    : stepsDone.sheet
                      ? campaign.columnStats
                        ? `${campaign.columnStats.ready}/${campaign.columnStats.total} ready`
                        : `${campaign.sheetRowCount} rows`
                      : campaign.sheetVerifiedAt
                        ? "Map columns"
                        : "Add people"}
                </em>
              </button>
              {openStep === "sheet" && stepsDone.sender && stepsDone.signature ? (
                <div className="cloud-step-body">
                  <p>
                    Upload a CSV, or paste a Google Sheet. A sheet shared as “anyone with the link
                    can view” is read instantly with no AI; a private sheet is read on the computer.
                    Hide unused columns so only people fields stay visible (email, subject, pitch,
                    etc.).
                  </p>
                  <label className="crm-field">
                    <span>
                      Upload CSV
                      {campaign.sheetSource === "csv" && campaign.sheetFileName
                        ? ` · current: ${campaign.sheetFileName} (${campaign.sheetRowCount ?? 0} rows)`
                        : ""}
                    </span>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      disabled={Boolean(busy)}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void uploadCsv(file);
                      }}
                    />
                  </label>
                  <label className="crm-field">
                    <span>Or a Google Sheet link</span>
                    <input
                      type="url"
                      value={sheetUrl}
                      disabled={Boolean(busy)}
                      placeholder="https://docs.google.com/spreadsheets/…"
                      onChange={(event) => setSheetUrl(event.target.value)}
                    />
                  </label>
                  <div className="cloud-step-actions">
                    <button
                      type="button"
                      className="btn-dark"
                      disabled={Boolean(busy) || !sheetUrl.trim()}
                      onClick={() => void verifySheet()}
                    >
                      Verify sheet
                    </button>
                  </div>
                  {campaign.sheetVerifiedAt && sheetHeaders.length ? (
                    <CloudColumnMapPanel
                      headers={sheetHeaders}
                      columnMap={campaign.columnMap || {}}
                      stats={campaign.columnStats}
                      busy={Boolean(busy)}
                      onSave={(map) => void saveColumnMap(map)}
                      onPreview={previewRow}
                    />
                  ) : (
                    <p className="cloud-muted">
                      Recommended columns: {CLOUD_SHEET_COLUMNS.join(", ")}. Other names are
                      detected too, and you can confirm the mapping after loading.
                    </p>
                  )}
                </div>
              ) : null}
            </section>
            <section className={`cloud-step${openStep === "review" ? " open" : ""}${stepsDone.review ? " done" : ""}`}>
              <button type="button" className="cloud-step-head" onClick={() => setOpenStep("review")}>
                <span className="cloud-step-title"><i className="cloud-step-num" aria-hidden="true">{stepsDone.review ? "✓" : "5"}</i>Review &amp; start</span>
                <em>
                  {stepsDone.review
                    ? "Ready"
                    : stepsDone.sender && !stepsDone.senderVerified
                      ? "Confirm inbox to start"
                      : "Finish setup"}
                </em>
              </button>
              {openStep === "review" ? (
                <div className="cloud-step-body">
                  {stepsDone.sender && !stepsDone.senderVerified ? (
                    <p className="cloud-auth-hint">
                      Sender is selected but the inbox is not confirmed yet. Finish sign-in on the
                      computer, then click <strong>I’ve signed in — check inbox</strong> in step 2
                      before starting.
                    </p>
                  ) : null}
                  <ul className="cloud-review-list">
                    <li>
                      <strong>Sender</strong>
                      <span>
                        {stepsDone.senderVerified
                          ? `${formatCloudSenderProvider(campaign.profileProvider)} · ${
                              selectedProfile?.label
                                ? `${selectedProfile.label} · ${campaign.profileGmail}`
                                : campaign.profileGmail
                            }`
                          : campaign.profileId
                            ? "Selected — inbox not confirmed"
                            : "—"}
                      </span>
                    </li>
                    <li>
                      <strong>Signature</strong>
                      <span>
                        {campaign.signatureReady
                          ? campaign.signatureHtml?.trim()
                            ? "Custom HTML"
                            : "None"
                          : "—"}
                      </span>
                    </li>
                    <li>
                      <strong>People</strong>
                      <span>
                        {stepsDone.sheet
                          ? `${campaign.sheetSource === "csv" ? `CSV ${campaign.sheetFileName || ""} · ` : "Sheet · "}${campaign.sheetRowCount ?? 0} rows${
                              sheetHeaders.length ? ` · ${sheetHeaders.join(", ")}` : ""
                            }`
                          : "—"}
                      </span>
                    </li>
                    <li>
                      <strong>Next row</strong>
                      <span>{campaign.nextRow}</span>
                    </li>
                  </ul>
                  <p className="cloud-muted">
                    Start, stop, test sends and progress live in the panel at the top of the page.
                  </p>
                </div>
              ) : null}
            </section>
          </div>
        </div>
        )}
      </div>

      {confirmDialog}
      {desktopUrl ? (
        <CloudDesktopViewer
          desktopUrl={desktopUrl}
          layout={desktopLayout}
          busy={Boolean(busy)}
          awaitingLoginConfirm={awaitingLoginConfirm}
          onLayoutChange={setDesktopLayout}
          onClose={() => {
            setDesktopUrl("");
            setDesktopLayout("floating");
            setAwaitingLoginConfirm(false);
          }}
          onConfirmLogin={() => void confirmLoginFromDesktop()}
        />
      ) : null}
    </div>
  );
}
