"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  confirmLinkedinSession,
  countLinkedinMessages,
  fetchLinkedinCampaigns,
  fetchLinkedinSession,
  openLinkedinSession,
  parseLinkedinCsv,
  startLinkedinCampaign,
  type LinkedinCampaign,
  type LinkedinCsvPreview,
  type LinkedinSession,
} from "@/lib/linkedin-campaigns";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

const SAMPLE_CSV = [
  "Name,LinkedIn account,Connected,Message 1,Message 2",
  'Ada Lovelace,https://www.linkedin.com/in/ada,no,"Hi Ada, I would like to connect.","Thanks for connecting."',
  'Grace Hopper,https://www.linkedin.com/in/grace,yes,"Hi Grace, good to be connected.","A short follow-up."',
].join("\n");

function accountInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "in";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function MetricColumn({ label, value }: { label: string; value: number }) {
  return (
    <div className="drip-metric">
      <div className="k">{label}</div>
      <div className="drip-metric-main">
        <span className="v">{value}</span>
      </div>
    </div>
  );
}

export default function PortalLinkedinPage() {
  const [campaigns, setCampaigns] = useState<LinkedinCampaign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [session, setSession] = useState<LinkedinSession | null>(null);
  const [desktopUrl, setDesktopUrl] = useState("");
  const [accountName, setAccountName] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [delayAfterAccept, setDelayAfterAccept] = useState("");
  const [delayAfterMessage, setDelayAfterMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const preview = useMemo<LinkedinCsvPreview | null>(
    () => (csvText.trim() ? parseLinkedinCsv(csvText) : null),
    [csvText],
  );
  const messageTotal = preview ? countLinkedinMessages(preview.people) : 0;
  const alreadyConnected = preview?.people.filter((person) => person.alreadyConnected).length || 0;
  const needsSecondDelay = (preview?.messageLabels.length || 0) > 1;
  const filtered = campaigns.filter((campaign) =>
    campaign.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextSession, nextCampaigns] = await Promise.all([
          fetchLinkedinSession(),
          fetchLinkedinCampaigns(),
        ]);
        if (cancelled) return;
        setSession(nextSession);
        setAccountName(nextSession.accountName);
        setCampaigns(nextCampaigns);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load campaigns");
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openComputer() {
    setError("");
    setBusy("Opening the virtual machine…");
    try {
      const opened = await openLinkedinSession();
      setDesktopUrl(opened.desktopUrl);
      setSession(opened.session);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Could not open the virtual machine");
    } finally {
      setBusy("");
    }
  }

  async function keepLogin() {
    setError("");
    setBusy("Saving the LinkedIn login…");
    try {
      const next = await confirmLinkedinSession(accountName);
      setSession(next);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the login");
    } finally {
      setBusy("");
    }
  }

  async function onFile(file: File | null) {
    setError("");
    if (!file) return;
    const text = await file.text();
    const parsed = parseLinkedinCsv(text);
    if (!parsed.people.length || !parsed.messageLabels.length) {
      setCsvText("");
      setFileName("");
      setError("Use a CSV with Name, LinkedIn account, Message 1, and Message 2.");
      return;
    }
    setCsvText(text);
    setFileName(file.name);
    setDelayAfterAccept("");
    setDelayAfterMessage("");
  }

  async function launchCampaign() {
    if (!preview) return;
    setError("");
    setBusy("Launching…");
    try {
      const started = await startLinkedinCampaign({
        name: campaignName,
        csv: csvText,
        delayAfterAcceptDays: Number(delayAfterAccept),
        delayAfterMessageDays: needsSecondDelay ? Number(delayAfterMessage) : 0,
      });
      setCampaigns((current) => [started.campaign, ...current]);
      setShowCreate(false);
      setDesktopUrl("");
      setCampaignName("");
      setCsvText("");
      setFileName("");
      setDelayAfterAccept("");
      setDelayAfterMessage("");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not launch the campaign");
    } finally {
      setBusy("");
    }
  }

  const acceptReady = delayAfterAccept.trim() !== "" && Number.isInteger(Number(delayAfterAccept));
  const messageReady =
    !needsSecondDelay ||
    (delayAfterMessage.trim() !== "" && Number.isInteger(Number(delayAfterMessage)));
  const canLaunch = Boolean(
    session?.connected &&
      preview &&
      preview.people.length &&
      campaignName.trim() &&
      acceptReady &&
      messageReady &&
      !busy,
  );

  return (
    <>
      <div className="crm-page-head drip-page-head">
        <div>
          <h2>LinkedIn Automation</h2>
        </div>
        <div className="crm-actions">
          {showCreate ? (
            <button type="button" className="btn-soft" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          ) : (
            <button type="button" className="btn-dark" onClick={() => setShowCreate(true)}>
              Create campaign
            </button>
          )}
        </div>
      </div>

      {showCreate ? (
        <div className="drip-create-wrap">
          <div className="drip-create-panel">
            <h3>Create a LinkedIn campaign</h3>
            <p className="drip-create-copy">
              Sign in once on the virtual machine. That LinkedIn stays connected. Upload the CSV, set the waits, then launch.
            </p>
            {error ? <p className="crm-error">{error}</p> : null}
            <div className="li-auto-card li-auto-card-flat">
              {session?.connected ? (
                <div className="li-account">
                  <span className="li-account-photo" aria-hidden="true">
                    {accountInitials(session.accountName)}
                  </span>
                  <span className="li-account-copy">
                    <span className="li-account-top">
                      <strong>{session.accountName || "LinkedIn account"}</strong>
                      <span className="li-auto-pill is-on">Connected</span>
                    </span>
                    <span>Signed in on the virtual machine</span>
                  </span>
                </div>
              ) : (
                <>
                  <div className="li-auto-card-head">
                    <h3>LinkedIn</h3>
                    <span className="li-auto-pill">Not connected</span>
                  </div>
                  <p>Open the virtual machine and log in. The same computer keeps that session.</p>
                  <label className="li-auto-field">
                    Account name
                    <input
                      value={accountName}
                      onChange={(event) => setAccountName(event.target.value)}
                      placeholder="The LinkedIn account you sign in with"
                    />
                  </label>
                </>
              )}
              <div className="li-auto-actions">
                <button type="button" className="btn-dark" onClick={() => void openComputer()} disabled={Boolean(busy)}>
                  {session?.connected ? "Open LinkedIn" : "Log in on the virtual machine"}
                </button>
                {desktopUrl && !session?.connected ? (
                  <button type="button" className="btn-soft" onClick={() => void keepLogin()} disabled={Boolean(busy)}>
                    Keep this LinkedIn connected
                  </button>
                ) : null}
              </div>
              {desktopUrl ? (
                <iframe className="li-auto-frame" title="LinkedIn virtual machine" src={desktopUrl} />
              ) : null}
            </div>

            <div className="crm-field">
              <label htmlFor="li-campaign-name">Campaign name</label>
              <input
                id="li-campaign-name"
                value={campaignName}
                onChange={(event) => setCampaignName(event.target.value)}
                placeholder="April outreach"
              />
            </div>
            <div className="crm-field">
              <label htmlFor="li-campaign-csv">CSV</label>
              <input
                id="li-campaign-csv"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <p className="li-auto-hint">
              Columns: Name, LinkedIn account, Message 1, Message 2.
              {fileName ? ` ${fileName}` : ""} A Connected column with yes skips the request and sends message 1.{" "}
              <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`} download="linkedin-campaign-sample.csv">
                Sample CSV
              </a>
            </p>
            {preview ? (
              <div className="li-auto-detect">
                <strong>
                  {preview.people.length} people · {preview.messageLabels.length} message
                  {preview.messageLabels.length === 1 ? "" : "s"} · {messageTotal} messages will be sent
                </strong>
                <span>
                  {preview.messageLabels.join(", ")}
                  {alreadyConnected ? ` · ${alreadyConnected} already connected` : ""}
                  {preview.skipped ? ` · ${preview.skipped} rows skipped` : ""}
                </span>
              </div>
            ) : null}
            {preview && preview.messageLabels.length ? (
              <div className="li-auto-delays">
                <label className="li-auto-field">
                  After they accept, wait how many days before {preview.messageLabels[0]}?
                  <input
                    inputMode="numeric"
                    value={delayAfterAccept}
                    onChange={(event) => setDelayAfterAccept(event.target.value.replace(/[^\d]/g, ""))}
                    placeholder="Days"
                  />
                </label>
                {needsSecondDelay ? (
                  <label className="li-auto-field">
                    After {preview.messageLabels[0]}, wait how many days before the next message?
                    <input
                      inputMode="numeric"
                      value={delayAfterMessage}
                      onChange={(event) => setDelayAfterMessage(event.target.value.replace(/[^\d]/g, ""))}
                      placeholder="Days"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {!session?.connected ? (
              <p className="li-auto-hint">Connect LinkedIn before launching. That login is reused for every campaign.</p>
            ) : null}
            <div className="drip-create-actions">
              <button type="button" className="btn-link-purple" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button type="button" className="btn-dark" disabled={!canLaunch} onClick={() => void launchCampaign()}>
                {busy === "Launching…" ? "Launching…" : "Launch campaign"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="drip-shell">
          {error ? <p className="crm-error">{error}</p> : null}
          <div className="drip-toolbar">
            <label className="drip-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                placeholder="Search for a campaign"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          <div className="drip-list">
            {!loaded ? (
              <div className="drip-empty">Loading campaigns...</div>
            ) : filtered.length === 0 ? (
              <div className="drip-empty">
                {campaigns.length === 0 ? (
                  <>
                    No campaigns yet. Click <strong>Create campaign</strong> to get started.
                  </>
                ) : (
                  "No campaigns found."
                )}
              </div>
            ) : (
              filtered.map((campaign) => (
                <div className="drip-card" key={campaign.id}>
                  <span />
                  <div className="drip-card-inner">
                    <Link href={`${PORTAL_ROUTES.linkedin}/${campaign.id}`} className="drip-main">
                      <div className="drip-title">{campaign.name}</div>
                      <div className="drip-status">
                        <span className={campaign.status === "complete" ? "dot complete" : "dot sending"} />
                        <strong>{campaign.status === "complete" ? "Complete" : "Running"}</strong>
                        <span>
                          {campaign.status === "complete"
                            ? "Messages sent. Still checking for replies"
                            : `${campaign.delayAfterAcceptDays} day${campaign.delayAfterAcceptDays === 1 ? "" : "s"} after they accept`}
                        </span>
                      </div>
                    </Link>
                    <div className="drip-metrics">
                      <MetricColumn label="People" value={campaign.peopleCount} />
                      <MetricColumn label="Requests" value={campaign.requestCount} />
                      <MetricColumn label="Connected" value={campaign.connectedCount} />
                      <MetricColumn label="Messages" value={campaign.messageCount} />
                    </div>
                    <div className="drip-row-actions">
                      <span
                        className={
                          campaign.status === "complete"
                            ? "drip-row-status drip-row-status-complete"
                            : "drip-row-status drip-row-status-running"
                        }
                      >
                        {campaign.status === "complete" ? "Complete" : "Running"}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
