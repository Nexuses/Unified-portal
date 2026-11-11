"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CloudBoatUsageCard from "@/app/components/portal/CloudBoatUsageCard";
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
  fetchCloudCampaign,
  fetchCloudProfiles,
  formatCloudSenderProvider,
  formatCloudStatus,
  patchCloudCampaign,
  renameCloudProfile,
  runCloudCampaignAction,
  type CloudCampaign,
  type CloudChromeProfile,
  type CloudSenderProvider,
} from "@/lib/cloud-campaigns";
import { cleanSignatureHtml } from "@/lib/personalise-types";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

type StepId = "computer" | "sender" | "signature" | "prompt" | "sheet" | "review";

const MAX_CUSTOM_PROMPT = 4000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const [campaign, setCampaign] = useState<CloudCampaign | null>(null);
  const [profiles, setProfiles] = useState<CloudChromeProfile[]>([]);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [desktopUrl, setDesktopUrl] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [signatureHtml, setSignatureHtml] = useState("");
  const [signatureTab, setSignatureTab] = useState<"code" | "preview">("code");
  const [customPrompt, setCustomPrompt] = useState("");
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
  const tickBusy = useRef(false);

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
    setCustomPrompt(nextCampaign.customPrompt || "");
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
  }, [campaign?.profileId, campaign?.profileGmail, profiles]);

  const stepsDone = useMemo(() => {
    if (!campaign) {
      return {
        computer: false,
        sender: false,
        senderVerified: false,
        signature: false,
        sheet: false,
        prompt: false,
        review: false,
      };
    }
    const computer = campaign.computerReady === true;
    const sender = Boolean(campaign.profileId && campaign.profileDirectory);
    const senderVerified = Boolean(sender && selectedProfileEmail.includes("@"));
    const signature = campaign.signatureReady === true;
    const sheet = Boolean(campaign.sheetVerifiedAt && (campaign.sheetRowCount ?? 0) > 0);
    const prompt = campaign.customPromptReady === true;
    return {
      computer,
      sender,
      senderVerified,
      signature,
      sheet,
      prompt,
      review: computer && senderVerified && signature && sheet && prompt,
    };
  }, [campaign, selectedProfileEmail]);

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

  useEffect(() => {
    if (!campaign || campaign.status !== "sending") return;
    let cancelled = false;
    async function loop() {
      while (!cancelled) {
        if (tickBusy.current) {
          await sleep(2000);
          continue;
        }
        tickBusy.current = true;
        try {
          const data = await runCloudCampaignAction(campaignId, "tick");
          if (typeof data.desktopUrl === "string" && data.desktopUrl) {
            setDesktopUrl(data.desktopUrl);
          }
          if (data.campaign && typeof data.campaign === "object") {
            setCampaign(data.campaign as CloudCampaign);
          }
          if (needsInteractiveLogin(data)) {
            const blocked = authModeFromAction(data);
            if (blocked) setAuthMode(blocked);
            openDesktopForLogin(
              typeof data.desktopUrl === "string" ? data.desktopUrl : undefined,
            );
            setNotice(
              "Sign in on the full-screen computer, then click “I’ve signed in — check inbox”. Resume sending after the inbox is confirmed.",
            );
            break;
          }
          if (data.done === true) {
            setNotice("All rows finished.");
            break;
          }
          const gap = Math.max(0, Number((data.campaign as CloudCampaign | undefined)?.gapMinutes ?? gapMinutes));
          await sleep(gap * 60_000 || 5_000);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Send tick failed");
          break;
        } finally {
          tickBusy.current = false;
        }
      }
    }
    void loop();
    return () => {
      cancelled = true;
    };
  }, [campaign?.status, campaignId, gapMinutes]);

  async function withBusy<T>(label: string, work: () => Promise<T>) {
    setBusy(label);
    setNotice("");
    try {
      return await work();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong");
      throw error;
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
      if (data.replacedDeletedDisk === true) {
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
      if (verified) {
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
    await verifySender();
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

  async function saveCustomPrompt(continueNext: boolean) {
    await withBusy("Saving extra prompt…", async () => {
      const cleaned = customPrompt.trim().slice(0, MAX_CUSTOM_PROMPT);
      const next = await patchCloudCampaign(campaignId, {
        customPrompt: cleaned,
        customPromptReady: true,
      });
      setCampaign(next);
      setCustomPrompt(next.customPrompt || cleaned);
      setNotice(
        cleaned
          ? "Extra prompt saved. The computer will follow it when composing."
          : "No extra prompt. Emails will use the discovered sheet columns.",
      );
      if (continueNext) setOpenStep("review");
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
    if (
      !window.confirm(
        `Delete sender "${label}"?\n\nCampaigns using this profile will need a new sender. This cannot be undone.`,
      )
    ) {
      return;
    }
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

  async function verifySheet() {
    const url = sheetUrl.trim();
    if (!url) {
      setNotice("Paste a Google Sheet link.");
      return;
    }
    await withBusy("Reading sheet…", async () => {
      await patchCloudCampaign(campaignId, { sheetUrl: url });
      const data = await runCloudCampaignAction(campaignId, "verify_sheet", { sheetUrl: url });
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
      if (typeof data.desktopUrl === "string") setDesktopUrl(data.desktopUrl);
      if (data.ok === true) {
        const missing = Array.isArray(data.missingExpected)
          ? (data.missingExpected as string[]).filter(Boolean)
          : [];
        setNotice(
          missing.length
            ? `Sheet ready: ${String(data.rowCount ?? 0)} people. Recommended but missing: ${missing.join(", ")}. You can still continue.`
            : `Sheet ready: ${String(data.rowCount ?? 0)} people found.`,
        );
        setOpenStep("prompt");
      } else if (data.needsLogin === true) {
        openDesktopForLogin(
          typeof data.desktopUrl === "string" ? data.desktopUrl : undefined,
        );
        setNotice(
          "The sheet needs a Google login on this Chrome profile. Sign in on the full-screen computer, confirm, then verify the sheet again.",
        );
      } else {
        setNotice(
          typeof data.error === "string"
            ? data.error
            : "Sheet could not be verified. Check the link and try again.",
        );
      }
    });
  }

  async function saveGap() {
    await withBusy("Saving gap…", async () => {
      const next = await patchCloudCampaign(campaignId, { gapMinutes });
      setCampaign(next);
      setNotice("Gap saved.");
    });
  }

  async function startSending() {
    await withBusy("Starting send…", async () => {
      const data = await runCloudCampaignAction(campaignId, "start");
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
      setNotice("Sending started. The computer will email one row at a time.");
    });
  }

  async function pauseSending() {
    await withBusy("Pausing…", async () => {
      const data = await runCloudCampaignAction(campaignId, "pause");
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
      setNotice("Paused. The computer is free for other work.");
    });
  }

  async function resumeSending() {
    await withBusy("Resuming…", async () => {
      const data = await runCloudCampaignAction(campaignId, "resume");
      if (data.campaign) setCampaign(data.campaign as CloudCampaign);
      setNotice("Resumed.");
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
    stepsDone.prompt,
  ].filter(Boolean).length;
  const signaturePreview = cleanSignatureHtml(signatureHtml);
  const selectedProfile = profiles.find((item) => item.id === campaign.profileId);
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
            {campaign.status === "sending" ? (
              <button type="button" className="btn-soft" disabled={Boolean(busy)} onClick={() => void pauseSending()}>
                Pause
              </button>
            ) : null}
            {campaign.status === "paused" || campaign.status === "ready" ? (
              <button
                type="button"
                className="btn-dark"
                disabled={Boolean(busy) || !stepsDone.review}
                onClick={() => void (campaign.status === "paused" ? resumeSending() : startSending())}
              >
                {campaign.status === "paused" ? "Resume" : "Start sending"}
              </button>
            ) : null}
          </div>
        </div>

        {notice ? <div className="cloud-notice">{notice}</div> : null}
        {busy ? <div className="cloud-busy">{busy}</div> : null}

        <div className="drip-setup-card drip-setup-card-active">
          <div className="drip-setup-intro">
            <div className="drip-setup-intro-copy">
              <strong>Set up this cloud campaign</strong>
              <span>
                Computer → sender → signature → Google Sheet → extra prompt → Start. Recommended
                sheet columns (optional): {CLOUD_SHEET_COLUMNS.join(", ")}.
              </span>
            </div>
            <div className="drip-setup-intro-meter" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((index) => (
                <span key={index} className={index < requiredDone ? "done" : ""} />
              ))}
            </div>
          </div>

          <div className="cloud-step-list">
            <section className={`cloud-step${openStep === "computer" ? " open" : ""}${stepsDone.computer ? " done" : ""}`}>
              <button type="button" className="cloud-step-head" onClick={() => setOpenStep("computer")}>
                <span>1. Computer</span>
                <em>{stepsDone.computer ? "Ready" : "Start"}</em>
              </button>
              {openStep === "computer" ? (
                <div className="cloud-step-body">
                  <p>
                    Starts or resumes this project&apos;s Boat desktop. While a campaign is sending,
                    chat cannot drive the same computer.
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
                <span>2. Email sender</span>
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
                    Each sender is a Chrome profile on the computer. Rename profiles so you can
                    recognize them quickly. You can keep setting up the campaign after picking a
                    sender. Before sending, open the desktop full screen, sign in, then use{" "}
                    <strong>I’ve signed in — check inbox</strong>.
                  </p>
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
                  {awaitingLoginConfirm ? (
                    <p className="cloud-auth-hint">
                      Waiting for your confirmation after you finish sign-in on the computer.
                    </p>
                  ) : null}
                  {showPasswordAssist && campaign.profileId ? (
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
                <span>3. Signature</span>
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
                <span>4. Google Sheet</span>
                <em>
                  {!stepsDone.sender || !stepsDone.signature
                    ? "Locked until earlier steps done"
                    : stepsDone.sheet
                      ? `${campaign.sheetRowCount} rows`
                      : "Paste link"}
                </em>
              </button>
              {openStep === "sheet" && stepsDone.sender && stepsDone.signature ? (
                <div className="cloud-step-body">
                  <p>
                    Paste any Google Sheet the sender account can open. The computer discovers all
                    columns — there is no fixed template. Recommended fields (
                    {CLOUD_SHEET_COLUMNS.join(", ")}) help, but are optional.
                  </p>
                  <label className="crm-field">
                    <span>Sheet link</span>
                    <input
                      type="url"
                      value={sheetUrl}
                      onChange={(event) => setSheetUrl(event.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/…"
                    />
                  </label>
                  {sheetHeaders.length ? (
                    <p className="cloud-muted">
                      Discovered columns: {sheetHeaders.join(", ")}
                    </p>
                  ) : (
                    <p className="cloud-muted">
                      Recommended (optional): {CLOUD_SHEET_COLUMNS.join(", ")}
                    </p>
                  )}
                  {campaign.sheetSamples?.length ? (
                    <div className="cloud-samples">
                      {campaign.sheetSamples.map((sample, index) => (
                        <div key={index} className="cloud-sample">
                          {Object.entries(sample.cells || {}).map(([key, value]) => (
                            <span key={key}>
                              <em>{key}</em>: {value || "—"}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <button type="button" className="btn-dark" disabled={Boolean(busy)} onClick={() => void verifySheet()}>
                    Verify sheet
                  </button>
                </div>
              ) : null}
            </section>

            <section
              className={`cloud-step${openStep === "prompt" ? " open" : ""}${stepsDone.prompt ? " done" : ""}`}
            >
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
                  if (!stepsDone.sheet) {
                    setNotice("Verify the Google Sheet first so the prompt can use its columns.");
                    setOpenStep("sheet");
                    return;
                  }
                  setOpenStep("prompt");
                }}
              >
                <span>5. Extra prompt</span>
                <em>
                  {!stepsDone.sheet
                    ? "Locked until sheet verified"
                    : stepsDone.prompt
                      ? customPrompt.trim()
                        ? "Custom"
                        : "None"
                      : "Optional"}
                </em>
              </button>
              {openStep === "prompt" && stepsDone.sheet ? (
                <div className="cloud-step-body">
                  <p>
                    Optional instructions the computer follows when composing — tone, language,
                    which sheet columns to emphasize, or what never to say. Leave empty and
                    continue to use the discovered sheet columns as-is.
                  </p>
                  {sheetHeaders.length ? (
                    <div className="cloud-prompt-context">
                      <strong>Sheet context</strong>
                      <p className="cloud-muted">
                        Columns: {sheetHeaders.join(", ")} · {campaign.sheetRowCount ?? 0} people
                      </p>
                      {campaign.sheetSamples?.length ? (
                        <div className="cloud-samples">
                          {campaign.sheetSamples.map((sample, index) => (
                            <div key={index} className="cloud-sample">
                              {Object.entries(sample.cells || {}).map(([key, value]) => (
                                <span key={key}>
                                  <em>{key}</em>: {value || "—"}
                                </span>
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <textarea
                    className="cloud-prompt-input"
                    value={customPrompt}
                    maxLength={MAX_CUSTOM_PROMPT}
                    onChange={(event) => setCustomPrompt(event.target.value)}
                    placeholder="Example: Keep a warm, short tone. Mention the company column. Never promise pricing."
                    rows={8}
                  />
                  <p className="cloud-muted">
                    {customPrompt.trim().length}/{MAX_CUSTOM_PROMPT}
                  </p>
                  <div className="cloud-step-actions">
                    <button
                      type="button"
                      className="btn-soft"
                      disabled={Boolean(busy)}
                      onClick={() => void saveCustomPrompt(false)}
                    >
                      Save prompt
                    </button>
                    <button
                      type="button"
                      className="btn-dark"
                      disabled={Boolean(busy)}
                      onClick={() => void saveCustomPrompt(true)}
                    >
                      Save &amp; continue
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className={`cloud-step${openStep === "review" ? " open" : ""}${stepsDone.review ? " done" : ""}`}>
              <button type="button" className="cloud-step-head" onClick={() => setOpenStep("review")}>
                <span>6. Review &amp; start</span>
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
                      <strong>Sheet</strong>
                      <span>
                        {campaign.sheetUrl
                          ? `${campaign.sheetRowCount ?? 0} rows${
                              sheetHeaders.length ? ` · ${sheetHeaders.join(", ")}` : ""
                            }`
                          : "—"}
                      </span>
                    </li>
                    <li>
                      <strong>Extra prompt</strong>
                      <span>
                        {campaign.customPromptReady
                          ? campaign.customPrompt?.trim()
                            ? "Custom"
                            : "None"
                          : "—"}
                      </span>
                    </li>
                    <li>
                      <strong>People</strong>
                      <span>{campaign.sheetRowCount ?? "—"}</span>
                    </li>
                    <li>
                      <strong>Next row</strong>
                      <span>{campaign.nextRow}</span>
                    </li>
                  </ul>
                  <label className="crm-field cloud-gap-field">
                    <span>Minutes between emails</span>
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={gapMinutes}
                      onChange={(event) => setGapMinutes(Number(event.target.value) || 0)}
                    />
                  </label>
                  <div className="cloud-step-actions">
                    <button type="button" className="btn-soft" disabled={Boolean(busy)} onClick={() => void saveGap()}>
                      Save gap
                    </button>
                    {campaign.status === "sending" ? (
                      <button type="button" className="btn-soft" disabled={Boolean(busy)} onClick={() => void pauseSending()}>
                        Pause
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-dark"
                        disabled={Boolean(busy) || !stepsDone.review}
                        onClick={() => void (campaign.status === "paused" ? resumeSending() : startSending())}
                      >
                        {campaign.status === "paused" ? "Resume sending" : "Start sending"}
                      </button>
                    )}
                  </div>
                  {campaign.sendLog.length > 0 ? (
                    <div className="cloud-log">
                      <strong>Recent sends</strong>
                      <ul>
                        {campaign.sendLog.slice(-12).reverse().map((entry, index) => (
                          <li key={`${entry.at}-${index}`}>
                            <span className={`cloud-log-status ${entry.status}`}>{entry.status}</span>
                            <span>
                              Row {entry.row}: {entry.email || "—"}
                            </span>
                            {entry.message ? <small>{entry.message}</small> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>

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
