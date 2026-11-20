"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import CloudDesktopViewer, {
  type CloudDesktopLayout,
} from "@/app/components/portal/CloudDesktopViewer";
import {
  captureLinkedinAccountPhoto,
  confirmLinkedinSession,
  countLinkedinMessages,
  disconnectLinkedinSession,
  deleteLinkedinCampaigns,
  fetchLinkedinCampaigns,
  fetchLinkedinComputer,
  fetchLinkedinSession,
  fetchLinkedinVpn,
  openLinkedinSession,
  parseLinkedinCsv,
  setLinkedinCampaignPaused,
  setLinkedinVpn,
  startLinkedinCampaign,
  type LinkedinCampaign,
  type LinkedinComputerInfo,
  type LinkedinCsvPreview,
  type LinkedinSession,
  type LinkedinVpnInfo,
} from "@/lib/linkedin-campaigns";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

const SAMPLE_CSV = [
  "First name,Last name,Company,LinkedIn account,Connected,Like recent post,Message 1,Message 2",
  'Ada,Lovelace,Analytical Engines,https://www.linkedin.com/in/ada,no,yes,"Hi Ada, I would like to connect.","Thanks for connecting."',
  'Grace,Hopper,US Navy,https://www.linkedin.com/in/grace,yes,no,"Hi Grace, good to be connected.","A short follow-up."',
].join("\n");

const STATUS_OPTIONS = ["all", "running", "paused", "complete"] as const;

function statusLabel(option: (typeof STATUS_OPTIONS)[number]) {
  if (option === "all") return "All statuses";
  if (option === "running") return "Running";
  if (option === "paused") return "Paused";
  return "Complete";
}

const WEEK_DAYS = [
  { id: 1, letter: "M", name: "Monday" },
  { id: 2, letter: "T", name: "Tuesday" },
  { id: 3, letter: "W", name: "Wednesday" },
  { id: 4, letter: "T", name: "Thursday" },
  { id: 5, letter: "F", name: "Friday" },
  { id: 6, letter: "S", name: "Saturday" },
  { id: 0, letter: "S", name: "Sunday" },
];

function RowStatusSpinner() {
  return (
    <span className="drip-row-spinner" aria-hidden="true">
      <span className="drip-row-spinner-ring" />
    </span>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6.5" y="5" width="3.5" height="14" rx="1" />
      <rect x="14" y="5" width="3.5" height="14" rx="1" />
    </svg>
  );
}

function ResumeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7 7.4 19a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function accountInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "in";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function MetricColumn({ label, value, pct }: { label: string; value: number; pct?: string }) {
  return (
    <div className="drip-metric">
      <div className="k">{label}</div>
      <div className="drip-metric-main">
        <span className="v">{value}</span>
        {pct ? <span className="p">{pct}</span> : null}
      </div>
    </div>
  );
}

function shareOf(part: number, total: number) {
  if (!total) return undefined;
  return `${Math.round((part / total) * 100)}%`;
}

export default function PortalLinkedinPage() {
  const [campaigns, setCampaigns] = useState<LinkedinCampaign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [session, setSession] = useState<LinkedinSession | null>(null);
  const [vpn, setVpn] = useState<LinkedinVpnInfo | null>(null);
  const [computer, setComputer] = useState<LinkedinComputerInfo | null>(null);
  const [desktopUrl, setDesktopUrl] = useState("");
  const [desktopLayout, setDesktopLayout] = useState<CloudDesktopLayout>("floating");
  const [accountName, setAccountName] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [listName, setListName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [delayAfterAccept, setDelayAfterAccept] = useState("");
  const [delayAfterMessage, setDelayAfterMessage] = useState("");
  const [sendDays, setSendDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("18:00");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const preview = useMemo<LinkedinCsvPreview | null>(
    () => (csvText.trim() ? parseLinkedinCsv(csvText) : null),
    [csvText],
  );
  const messageTotal = preview ? countLinkedinMessages(preview.people) : 0;
  const alreadyConnected = preview?.people.filter((person) => person.alreadyConnected).length || 0;
  const needsSecondDelay = (preview?.messageLabels.length || 0) > 1;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      const matchesSearch = !query || campaign.name.toLowerCase().includes(query);
      const matchesStatus = statusFilter === "all" || campaign.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [campaigns, search, statusFilter]);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const rangeStart = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, filtered.length);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextSession, nextCampaigns, nextVpn, nextComputer] = await Promise.all([
          fetchLinkedinSession(),
          fetchLinkedinCampaigns(),
          fetchLinkedinVpn().catch(() => null),
          fetchLinkedinComputer(false).catch(() => null),
        ]);
        if (cancelled) return;
        setSession(nextSession);
        setAccountName(nextSession.accountName);
        setCampaigns(nextCampaigns);
        if (nextVpn) setVpn(nextVpn);
        if (nextComputer) setComputer(nextComputer);
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

  useEffect(() => {
    if (!session?.connected || session.accountPhoto) return;
    let cancelled = false;
    void captureLinkedinAccountPhoto()
      .then((next) => {
        if (!cancelled && next.accountPhoto) setSession(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session?.connected, session?.accountPhoto]);

  useEffect(() => {
    if (!showCreate) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await fetchLinkedinComputer(false);
        if (!stopped) setComputer(next);
        const waitMs =
          next.phase === "starting" || next.phase === "stopping" ? 6000 : 30000;
        if (!stopped) timer = setTimeout(() => void tick(), waitMs);
      } catch {
        if (!stopped) timer = setTimeout(() => void tick(), 30000);
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [showCreate]);

  useEffect(() => {
    if (!openMenuId) return;
    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMenuId(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenuId]);

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const campaign of pageItems) {
        if (checked) next.add(campaign.id);
        else next.delete(campaign.id);
      }
      return next;
    });
  }

  async function removeCampaigns(ids: string[]) {
    if (!ids.length) return;
    setDeletingId(ids.length === 1 ? ids[0] : "bulk");
    setOpenMenuId(null);
    setError("");
    try {
      await deleteLinkedinCampaigns(ids);
      const removed = new Set(ids);
      setCampaigns((current) => current.filter((item) => !removed.has(item.id)));
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete campaigns");
    } finally {
      setDeletingId(null);
    }
  }

  async function handlePauseToggle(campaign: LinkedinCampaign) {
    const pausing = campaign.status !== "paused";
    setOpenMenuId(null);
    setError("");
    setPausingId(campaign.id);
    try {
      const next = await setLinkedinCampaignPaused(campaign.id, pausing);
      setCampaigns((current) => current.map((item) => (item.id === next.id ? { ...item, status: next.status } : item)));
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : "Could not update the campaign");
    } finally {
      setPausingId(null);
    }
  }

  async function handleDelete(campaign: LinkedinCampaign) {
    if (!window.confirm(`Delete campaign "${campaign.name}"?`)) {
      setOpenMenuId(null);
      return;
    }
    await removeCampaigns([campaign.id]);
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const confirmText =
      ids.length === 1
        ? `Delete campaign "${campaigns.find((item) => item.id === ids[0])?.name ?? "this campaign"}"?`
        : `Delete ${ids.length} campaigns?`;
    if (!window.confirm(confirmText)) return;
    await removeCampaigns(ids);
  }

  function openFloatingDesktop(url: string) {
    if (!url) return;
    setDesktopUrl(url);
    setDesktopLayout("floating");
  }

  async function refreshComputer(withDesktop = false) {
    const next = await fetchLinkedinComputer(withDesktop);
    setComputer(next);
    if (withDesktop && next.desktopUrl) {
      openFloatingDesktop(next.desktopUrl);
    }
    return next;
  }

  async function openComputer() {
    setError("");
    setBusy(
      vpn?.enabled
        ? `Checking VPN (${vpn.country || "India"}) and opening LinkedIn…`
        : "Opening LinkedIn…",
    );
    try {
      const opened = await openLinkedinSession();
      openFloatingDesktop(opened.desktopUrl);
      setSession(opened.session);
      const [latestVpn, latestComputer] = await Promise.all([
        fetchLinkedinVpn().catch(() => null),
        fetchLinkedinComputer(false).catch(() => null),
      ]);
      if (latestVpn) setVpn(latestVpn);
      if (latestComputer) setComputer(latestComputer);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Could not open LinkedIn");
      const latestVpn = await fetchLinkedinVpn().catch(() => null);
      if (latestVpn) setVpn(latestVpn);
      await refreshComputer(false).catch(() => null);
    } finally {
      setBusy("");
    }
  }

  async function toggleVpn(enabled: boolean) {
    setError("");
    setBusy(enabled ? `Connecting VPN (${vpn?.country || "India"})…` : "Turning VPN off…");
    try {
      const next = await setLinkedinVpn(enabled);
      if (next.vpn) setVpn(next.vpn);
      if (next.computer) setComputer(next.computer);
    } catch (vpnError) {
      setError(vpnError instanceof Error ? vpnError.message : "Could not update VPN");
      const latest = await fetchLinkedinVpn().catch(() => null);
      if (latest) setVpn(latest);
      await refreshComputer(false).catch(() => null);
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
      setDesktopUrl("");
      const withPhoto = await captureLinkedinAccountPhoto().catch(() => null);
      if (withPhoto?.accountPhoto) setSession(withPhoto);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the login");
    } finally {
      setBusy("");
    }
  }

  async function disconnectLinkedin() {
    setError("");
    setBusy("Disconnecting LinkedIn…");
    try {
      const next = await disconnectLinkedinSession();
      setSession(next);
      setDesktopUrl("");
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Could not disconnect LinkedIn");
    } finally {
      setBusy("");
    }
  }

  function toggleSendDay(day: number) {
    setSendDays((current) =>
      current.includes(day) ? current.filter((item) => item !== day) : [...current, day],
    );
  }

  async function onFile(file: File | null) {
    setError("");
    if (!file) return;
    const text = await file.text();
    const parsed = parseLinkedinCsv(text);
    if (!parsed.people.length || !parsed.messageLabels.length) {
      setCsvText("");
      setFileName("");
      setError("Use a CSV with First name, Last name, Company, LinkedIn account, Message 1, and Message 2.");
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
        listName,
        fileName,
        csv: csvText,
        delayAfterAcceptDays: Number(delayAfterAccept),
        delayAfterMessageDays: needsSecondDelay ? Number(delayAfterMessage) : 0,
        sendDays,
        windowStart,
        windowEnd,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
      });
      setCampaigns((current) => [started.campaign, ...current]);
      setShowCreate(false);
      setDesktopUrl("");
      setCampaignName("");
      setListName("");
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
      listName.trim() &&
      acceptReady &&
      messageReady &&
      sendDays.length > 0 &&
      windowStart < windowEnd &&
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
                  <span className={`li-account-photo${session.accountPhoto ? " has-photo" : ""}`} aria-hidden="true">
                    {session.accountPhoto ? (
                      <img src={session.accountPhoto} alt="" />
                    ) : (
                      accountInitials(session.accountName)
                    )}
                  </span>
                  <span className="li-account-copy">
                    <span className="li-account-top">
                      <strong>{session.accountName || "LinkedIn account"}</strong>
                      <button
                        type="button"
                        className="li-disconnect"
                        onClick={() => void disconnectLinkedin()}
                        disabled={Boolean(busy)}
                      >
                        Disconnect
                      </button>
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
                  <p>Log in once on the virtual machine. That LinkedIn stays connected for this project.</p>
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
                <button
                  type="button"
                  className="btn-dark"
                  onClick={() => void openComputer()}
                  disabled={Boolean(busy) || computer?.phase === "stopping"}
                >
                  {session?.connected ? "Open LinkedIn" : "Log in on the virtual machine"}
                </button>
                {desktopUrl && !session?.connected ? (
                  <button type="button" className="btn-soft" onClick={() => void keepLogin()} disabled={Boolean(busy)}>
                    Keep this LinkedIn connected
                  </button>
                ) : null}
              </div>
              <div className="cloud-vpn-row li-auto-vpn-below-login">
                <label className="cloud-vpn-toggle">
                  <input
                    type="checkbox"
                    checked={vpn?.enabled === true}
                    disabled={Boolean(busy) || !vpn || (!vpn.configured && !vpn.enabled)}
                    onChange={(event) => void toggleVpn(event.target.checked)}
                  />
                  <span>Connect through NordVPN ({vpn?.country || "India"})</span>
                </label>
                <p className="li-auto-hint">
                  {!vpn
                    ? "Checking VPN…"
                    : !vpn.configured && !vpn.enabled
                      ? "NordVPN is not set up on the server yet (an admin needs to add NORDVPN_TOKEN)."
                      : !vpn.enabled
                        ? "Off. Applies to every LinkedIn campaign in this project."
                        : vpn.status?.connected
                          ? `Connected · ${[vpn.status.city, vpn.status.country].filter(Boolean).join(", ")}${
                              vpn.status.ip ? ` · ${vpn.status.ip}` : ""
                            }.`
                          : vpn.status?.error
                            ? `Not connected: ${vpn.status.error}`
                            : "On. Connects when the LinkedIn session starts."}
                </p>
              </div>
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
              <label htmlFor="li-list-name">List name</label>
              <input
                id="li-list-name"
                value={listName}
                onChange={(event) => setListName(event.target.value)}
                placeholder="April prospects"
              />
            </div>
            <p className="li-auto-hint">
              This name is saved as a CRM list. If first name, last name, and company already match a contact, that contact is used. A new contact is created only when those three do not match.
            </p>
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
              Columns: First name, Last name, Company, LinkedIn account, Message 1, Message 2.
              {fileName ? ` ${fileName}` : ""} A Connected column with yes skips the request and sends message 1. Like recent post with yes likes their latest post once they are connected.{" "}
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
            <div className="li-send-window">
              <span className="li-send-label">Send on</span>
              <div className="li-week" role="group" aria-label="Days to send">
                {WEEK_DAYS.map((day) => (
                  <button
                    key={day.name}
                    type="button"
                    className={sendDays.includes(day.id) ? "is-on" : ""}
                    aria-pressed={sendDays.includes(day.id)}
                    aria-label={day.name}
                    title={day.name}
                    onClick={() => toggleSendDay(day.id)}
                  >
                    {day.letter}
                  </button>
                ))}
              </div>
              <div className="li-send-times">
                <label className="li-auto-field">
                  From
                  <input type="time" value={windowStart} onChange={(event) => setWindowStart(event.target.value)} />
                </label>
                <label className="li-auto-field">
                  To
                  <input type="time" value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)} />
                </label>
              </div>
              <p className="li-auto-hint">Requests and messages go out only on the selected days, between these times.</p>
            </div>
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
          <div className="drip-tabs">
            <button type="button" className="drip-tab active">
              LinkedIn
            </button>
          </div>
          <div className="drip-toolbar">
            <input
              type="checkbox"
              className="drip-check"
              checked={pageItems.length > 0 && pageItems.every((item) => selectedIds.has(item.id))}
              disabled={!loaded || pageItems.length === 0 || deletingId !== null}
              onChange={(event) => toggleAll(event.target.checked)}
              aria-label="Select all campaigns on this page"
            />
            {selectedIds.size > 0 ? (
              <button
                type="button"
                className="drip-bulk-delete"
                disabled={deletingId !== null}
                onClick={() => void handleBulkDelete()}
              >
                {deletingId === "bulk" ? "Deleting..." : `Delete (${selectedIds.size})`}
              </button>
            ) : null}
            <label className="drip-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                placeholder="Search for a campaign"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <select
              className="drip-select"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as (typeof STATUS_OPTIONS)[number]);
                setPage(1);
              }}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {statusLabel(option)}
                </option>
              ))}
            </select>
          </div>
          <div className="drip-pagination">
            <span className="drip-page-range">
              {rangeStart}-{rangeEnd} of {filtered.length}
            </span>
            <div className="drip-page-controls">
              <select value={currentPage} onChange={(event) => setPage(Number(event.target.value))}>
                {Array.from({ length: totalPages }, (_, index) => (
                  <option key={index + 1} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </select>
              <span>of {totalPages} pages</span>
              <button
                type="button"
                className="drip-page-arrow"
                disabled={currentPage <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                aria-label="Previous page"
              >
                ‹
              </button>
              <button
                type="button"
                className="drip-page-arrow"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          </div>
          <div className="drip-list">
            {!loaded ? (
              <div className="drip-empty">Loading campaigns...</div>
            ) : pageItems.length === 0 ? (
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
              pageItems.map((campaign) => (
                <div className="drip-card" key={campaign.id}>
                  <input
                    type="checkbox"
                    className="drip-check"
                    checked={selectedIds.has(campaign.id)}
                    disabled={deletingId !== null}
                    onChange={(event) => toggleOne(campaign.id, event.target.checked)}
                    aria-label={`Select ${campaign.name}`}
                  />
                  <div className="drip-card-inner">
                    <Link href={`${PORTAL_ROUTES.linkedin}/${campaign.id}`} className="drip-main">
                      <div className="drip-title">{campaign.name}</div>
                      <div className="drip-status">
                        <span
                          className={
                            campaign.status === "complete"
                              ? "dot complete"
                              : campaign.status === "paused"
                                ? "dot paused"
                                : "dot sending"
                          }
                        />
                        <strong>{statusLabel(campaign.status)}</strong>
                        <span>
                          {[
                            campaign.listName,
                            campaign.status === "running"
                              ? `${campaign.delayAfterAcceptDays} day${campaign.delayAfterAcceptDays === 1 ? "" : "s"} after they accept`
                              : campaign.status === "paused"
                                ? "Paused"
                                : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                    </Link>
                    <div className="drip-metrics">
                      <MetricColumn label="People" value={campaign.peopleCount} />
                      <MetricColumn
                        label="Requests"
                        value={campaign.requestsSent}
                        pct={shareOf(campaign.requestsSent, campaign.peopleCount)}
                      />
                      <MetricColumn label="Messages" value={campaign.messagesSent} />
                      <MetricColumn
                        label="Replies"
                        value={campaign.replyCount}
                        pct={shareOf(campaign.replyCount, campaign.peopleCount)}
                      />
                    </div>
                    <div className="drip-row-actions">
                      <div className="drip-row-badges">
                        {campaign.status === "complete" ? (
                          <span className="drip-row-status drip-row-status-complete">Complete</span>
                        ) : campaign.status === "paused" ? (
                          <span className="drip-row-status drip-row-status-paused" aria-label="Campaign is paused">
                            Paused
                          </span>
                        ) : (
                          <span className="drip-row-status drip-row-status-running" aria-label="Campaign is running">
                            <RowStatusSpinner />
                            Running
                          </span>
                        )}
                      </div>
                      <div className="drip-more-wrap" ref={openMenuId === campaign.id ? menuRef : undefined}>
                        <button
                          type="button"
                          className={`drip-more${openMenuId === campaign.id ? " active" : ""}`}
                          aria-label="More actions"
                          aria-expanded={openMenuId === campaign.id}
                          disabled={deletingId !== null}
                          onClick={() => setOpenMenuId((current) => (current === campaign.id ? null : campaign.id))}
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="1.6" />
                            <circle cx="12" cy="12" r="1.6" />
                            <circle cx="12" cy="19" r="1.6" />
                          </svg>
                        </button>
                        {openMenuId === campaign.id ? (
                          <div className="drip-more-menu" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              disabled={deletingId !== null || pausingId === campaign.id}
                              onClick={() => void handlePauseToggle(campaign)}
                            >
                              {campaign.status === "paused" ? <ResumeIcon /> : <PauseIcon />}
                              {pausingId === campaign.id
                                ? campaign.status === "paused"
                                  ? "Resuming..."
                                  : "Pausing..."
                                : campaign.status === "paused"
                                  ? "Resume campaign"
                                  : "Pause campaign"}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="danger"
                              disabled={deletingId !== null}
                              onClick={() => void handleDelete(campaign)}
                            >
                              <TrashIcon />
                              {deletingId === campaign.id ? "Deleting..." : "Delete campaign"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {desktopUrl ? (
        <CloudDesktopViewer
          desktopUrl={desktopUrl}
          layout={desktopLayout}
          busy={Boolean(busy)}
          awaitingLoginConfirm={Boolean(desktopUrl && !session?.connected)}
          confirmLabel="Keep this LinkedIn connected"
          onLayoutChange={setDesktopLayout}
          onClose={() => {
            setDesktopUrl("");
            setDesktopLayout("floating");
          }}
          onConfirmLogin={
            desktopUrl && !session?.connected ? () => void keepLogin() : undefined
          }
        />
      ) : null}
    </>
  );
}
