"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_TRACKING_HOST,
  trackingDnsRecords,
  trackingOrigin,
  type TrackingDnsRecord,
} from "@/lib/campaign-tracking";
import {
  formatSenderDisplayName,
} from "@/lib/mxtoolbox";
import {
  getSmtpProvider,
  GMAIL_DAILY_LIMIT_DEFAULT,
  GMAIL_DAILY_LIMIT_MAX,
  GMAIL_DAILY_LIMIT_MIN,
  normalizeGmailDailyLimit,
  SMTP_PROVIDERS,
  type SenderCredentials,
  type SmtpProviderDefinition,
  type SmtpSender,
} from "@/lib/smtp-senders";
import { SmtpProviderBadge, SmtpProviderLogo } from "@/app/components/portal/SmtpProviderBadge";

type ModalStep = "provider" | "form";

const EMPTY_FORM: SenderCredentials = {
  smtpHost: "",
  smtpUser: "",
  smtpPassword: "",
  smtpPort: undefined,
  apiKey: "",
  cloudflareAccountId: "",
  cloudflareEmailApiToken: "",
  fromEmail: "",
  trackingDomain: "",
};

function buildInitialForm(provider: SmtpProviderDefinition): SenderCredentials {
  return {
    ...EMPTY_FORM,
    ...provider.defaults,
  };
}

function buildEditForm(
  sender: SmtpSender,
  provider: SmtpProviderDefinition,
): SenderCredentials {
  return {
    ...EMPTY_FORM,
    ...provider.defaults,
    fromEmail: sender.fromEmail,
    smtpHost: sender.smtpHost ?? provider.defaults?.smtpHost ?? "",
    smtpUser: sender.smtpUser ?? "",
    smtpPort: sender.smtpPort ?? provider.defaults?.smtpPort,
    cloudflareAccountId: sender.cloudflareAccountId ?? "",
    smtpPassword: "",
    apiKey: "",
    cloudflareEmailApiToken: "",
    trackingDomain: sender.trackingDomain ?? "",
  };
}

function VerificationMark({ ok }: { ok: boolean }) {
  if (ok) {
    return (
      <span className="vs-ok" aria-label="Verified">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    );
  }

  return (
    <span className="vs-fail" aria-label="Not verified">
      !
    </span>
  );
}

function TrackingDomainField({ sender }: { sender: SmtpSender }) {
  return (
    <div className="vs-field">
      <div className="lbl">Tracking domain</div>
      <div className="val">
        {sender.trackingVerification?.verified
          ? trackingOrigin(sender.trackingDomain).replace(/^https?:\/\//, "")
          : DEFAULT_TRACKING_HOST}
        {sender.trackingVerification?.verified ? (
          <VerificationMark ok />
        ) : sender.pendingTrackingDomain || sender.trackingDomain ? (
          <VerificationMark ok={false} />
        ) : null}
      </div>
      <div className="vs-field-note">
        {sender.pendingTrackingDomain && !sender.trackingVerification?.verified
          ? `Waiting for DNS/HTTPS on ${sender.pendingTrackingDomain}.`
          : sender.trackingDomain && sender.trackingVerification?.verified
            ? "Verified custom tracking domain."
            : sender.trackingDomain
              ? `Custom domain set but not usable yet — emails use ${DEFAULT_TRACKING_HOST}.`
              : `Using default ${DEFAULT_TRACKING_HOST}.`}
      </div>
    </div>
  );
}

function GmailDailyLimitField({
  sender,
  saving,
  onSave,
}: {
  sender: SmtpSender;
  saving: boolean;
  onSave: (dailyLimit: number) => void | Promise<void>;
}) {
  const current = normalizeGmailDailyLimit(
    sender.dailyLimit ?? GMAIL_DAILY_LIMIT_DEFAULT,
  );
  const [value, setValue] = useState(String(current));
  const dirty = normalizeGmailDailyLimit(value) !== current;

  useEffect(() => {
    setValue(String(current));
  }, [current, sender.id]);

  return (
    <div className="vs-field vs-daily-limit-field">
      <div className="lbl">Daily limit</div>
      <div className="vs-daily-limit-edit">
        <input
          type="number"
          min={GMAIL_DAILY_LIMIT_MIN}
          max={GMAIL_DAILY_LIMIT_MAX}
          step={1}
          value={value}
          disabled={saving}
          aria-label="Gmail daily send limit"
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            const next = normalizeGmailDailyLimit(value);
            setValue(String(next));
          }}
        />
        <button
          type="button"
          className="vs-edit"
          disabled={saving || !dirty}
          onClick={() => void onSave(normalizeGmailDailyLimit(value))}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function SenderExpandedDetails({
  sender,
  verifying,
  dailyLimitSaving,
  onDailyLimitSave,
}: {
  sender: SmtpSender;
  verifying: boolean;
  dailyLimitSaving?: boolean;
  onDailyLimitSave?: (dailyLimit: number) => void | Promise<void>;
}) {
  const verification = sender.verification;
  const showDailyLimit =
    sender.provider === "gmail" && typeof onDailyLimitSave === "function";

  if (verifying) {
    return (
      <div className="vs-details vs-details-loading">
        Checking SPF, DKIM, and DMARC with MX Toolbox...
      </div>
    );
  }

  if (sender.noInbox) {
    return (
      <div className="vs-details">
        <div className="vs-field">
          <div className="lbl">Inbox checks</div>
          <div className="val">
            No inbox — SPF, DKIM, and DMARC skipped
            <VerificationMark ok />
          </div>
          <div className="vs-field-note">
            This sender is marked as outbound-only. DNS auth checks are not required.
          </div>
        </div>
        {showDailyLimit ? (
          <GmailDailyLimitField
            sender={sender}
            saving={Boolean(dailyLimitSaving)}
            onSave={onDailyLimitSave}
          />
        ) : null}
        <TrackingDomainField sender={sender} />
      </div>
    );
  }

  if (!verification) {
    return (
      <div className="vs-details vs-details-loading">
        Verification has not run yet.
      </div>
    );
  }

  return (
    <div className="vs-details">
      <div className="vs-field">
        <div className="lbl">DKIM signature</div>
        <div className="val">
          {verification.dkimLabel}
          <VerificationMark ok={verification.dkimOk} />
        </div>
        {!verification.dkimOk && verification.dkimDetail ? (
          <div className="vs-field-note">{verification.dkimDetail}</div>
        ) : null}
      </div>
      <div className="vs-field">
        <div className="lbl">DMARC</div>
        <div className="val">
          {verification.dmarcLabel}
          <VerificationMark ok={verification.dmarcOk} />
        </div>
        {!verification.dmarcOk && verification.dmarcDetail ? (
          <div className="vs-field-note">{verification.dmarcDetail}</div>
        ) : null}
      </div>
      <div className="vs-field">
        <div className="lbl">SPF</div>
        <div className="val">
          {verification.spfLabel ?? "SPF is not configured"}
          <VerificationMark ok={Boolean(verification.spfOk)} />
        </div>
        {!verification.spfOk && verification.spfDetail ? (
          <div className="vs-field-note">{verification.spfDetail}</div>
        ) : null}
      </div>
      <TrackingDomainField sender={sender} />
      {showDailyLimit ? (
        <GmailDailyLimitField
          sender={sender}
          saving={Boolean(dailyLimitSaving)}
          onSave={onDailyLimitSave}
        />
      ) : null}
    </div>
  );
}

function isSenderVerified(sender: Pick<SmtpSender, "noInbox" | "verification">) {
  if (sender.noInbox) {
    return true;
  }
  const verification = sender.verification;
  return Boolean(
    verification?.spfOk && verification?.dkimOk && verification?.dmarcOk,
  );
}

export default function PortalSmtpPage() {
  const [senders, setSenders] = useState<SmtpSender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<ModalStep>("provider");
  const [selectedProvider, setSelectedProvider] =
    useState<SmtpProviderDefinition | null>(null);
  const [form, setForm] = useState<SenderCredentials>(EMPTY_FORM);
  const [noInbox, setNoInbox] = useState(false);
  const [dailyLimit, setDailyLimit] = useState(GMAIL_DAILY_LIMIT_DEFAULT);
  const [saving, setSaving] = useState(false);
  const [editingSenderId, setEditingSenderId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [dailyLimitSavingId, setDailyLimitSavingId] = useState<string | null>(null);
  const [trackingSender, setTrackingSender] = useState<SmtpSender | null>(null);
  const [trackingDomainDraft, setTrackingDomainDraft] = useState("");
  const [trackingRecords, setTrackingRecords] = useState<TrackingDnsRecord[]>([]);
  const [trackingSaving, setTrackingSaving] = useState(false);
  const [trackingVerifying, setTrackingVerifying] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  const autoVerifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!menuOpenId) {
      return;
    }

    function closeMenu() {
      setMenuOpenId(null);
    }

    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [menuOpenId]);

  async function loadSenders() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/smtp/senders");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load senders");
      }
      setSenders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load senders");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSenders();
  }, []);

  useEffect(() => {
    senders.forEach((sender) => {
      if (
        sender.noInbox ||
        sender.verification ||
        autoVerifiedRef.current.has(sender.id)
      ) {
        return;
      }

      autoVerifiedRef.current.add(sender.id);
      void recheckSender(sender.id);
    });
  }, [senders]);

  function openModal() {
    setEditingSenderId(null);
    setModalOpen(true);
    setModalStep("provider");
    setSelectedProvider(null);
    setForm(EMPTY_FORM);
    setNoInbox(false);
    setError("");
    setSuccess("");
  }

  function openEditSender(sender: SmtpSender) {
    const provider = getSmtpProvider(sender.provider);
    if (!provider) {
      return;
    }

    setEditingSenderId(sender.id);
    setModalOpen(true);
    setModalStep("form");
    setSelectedProvider(provider);
    setForm(buildEditForm(sender, provider));
    setNoInbox(Boolean(sender.noInbox));
    setDailyLimit(
      sender.provider === "gmail"
        ? normalizeGmailDailyLimit(sender.dailyLimit ?? GMAIL_DAILY_LIMIT_DEFAULT)
        : GMAIL_DAILY_LIMIT_DEFAULT,
    );
    setError("");
    setSuccess("");
    setMenuOpenId(null);
  }

  function closeModal(force = false) {
    if (saving && !force) {
      return;
    }
    setModalOpen(false);
    setEditingSenderId(null);
    setModalStep("provider");
    setSelectedProvider(null);
    setForm(EMPTY_FORM);
    setNoInbox(false);
    setDailyLimit(GMAIL_DAILY_LIMIT_DEFAULT);
    setError("");
  }

  function handleBackdropInteraction(
    event: React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>,
  ) {
    if (event.target !== event.currentTarget) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function selectProvider(provider: SmtpProviderDefinition) {
    setSelectedProvider(provider);
    setForm(buildInitialForm(provider));
    setNoInbox(false);
    setDailyLimit(GMAIL_DAILY_LIMIT_DEFAULT);
    setModalStep("form");
  }

  function backToProviders() {
    setModalStep("provider");
    setSelectedProvider(null);
    setForm(EMPTY_FORM);
    setNoInbox(false);
    setDailyLimit(GMAIL_DAILY_LIMIT_DEFAULT);
  }

  function updateField(key: keyof SenderCredentials, value: string) {
    setForm((current) => ({
      ...current,
      [key]: key === "smtpPort" ? (value === "" ? undefined : Number(value)) : value,
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProvider) {
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const isEditing = Boolean(editingSenderId);
      const response = await fetch(
        isEditing ? `/api/smtp/senders/${editingSenderId}` : "/api/smtp/senders",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: selectedProvider.id,
            ...form,
            noInbox,
            ...(selectedProvider.id === "gmail" ? { dailyLimit } : {}),
          }),
        },
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error ||
            (isEditing ? "Failed to update sender" : "Failed to add sender"),
        );
      }

      if (isEditing) {
        setSenders((current) =>
          current.map((entry) => (entry.id === data.id ? data : entry)),
        );
        setSuccess(
          data.noInbox
            ? "Sender updated. SPF, DKIM, and DMARC checks were skipped (no inbox)."
            : isSenderVerified(data)
              ? "Sender updated and verified successfully."
              : "Sender updated. Review SPF, DKIM, and DMARC status in the sender details.",
        );
      } else {
        setSenders((current) => [data, ...current]);
        setSuccess(
          data.noInbox
            ? "Sender added. SPF, DKIM, and DMARC checks were skipped (no inbox)."
            : isSenderVerified(data)
              ? "Sender added and verified successfully."
              : "Sender added. Review SPF, DKIM, and DMARC status in the sender details.",
        );
      }
      closeModal(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : editingSenderId
            ? "Failed to update sender"
            : "Failed to add sender",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDailyLimitSave(sender: SmtpSender, nextLimit: number) {
    if (sender.provider !== "gmail") {
      return;
    }
    const dailyLimitValue = normalizeGmailDailyLimit(nextLimit);
    setDailyLimitSavingId(sender.id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/smtp/senders/${sender.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyLimit: dailyLimitValue }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to update daily limit");
      }
      setSenders((current) =>
        current.map((entry) => (entry.id === data.id ? data : entry)),
      );
      setSuccess(`Daily limit updated to ${data.dailyLimit ?? dailyLimitValue}.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update daily limit",
      );
    } finally {
      setDailyLimitSavingId(null);
    }
  }

  async function handleDelete(sender: SmtpSender) {
    if (!window.confirm(`Delete sender ${sender.fromEmail}?`)) {
      return;
    }

    setDeletingId(sender.id);
    setError("");
    try {
      const response = await fetch(`/api/smtp/senders/${sender.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete sender");
      }
      setSenders((current) => current.filter((entry) => entry.id !== sender.id));
      setExpandedIds((current) => {
        const next = new Set(current);
        next.delete(sender.id);
        return next;
      });
      autoVerifiedRef.current.delete(sender.id);
      setMenuOpenId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete sender");
    } finally {
      setDeletingId(null);
    }
  }

  function toggleExpanded(senderId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(senderId)) {
        next.delete(senderId);
      } else {
        next.add(senderId);
      }
      return next;
    });
    setMenuOpenId(null);
  }

  function isExpanded(senderId: string) {
    return expandedIds.has(senderId);
  }

  async function recheckSender(senderId: string) {
    setVerifyingId(senderId);
    setError("");
    setMenuOpenId(null);

    try {
      const response = await fetch(`/api/smtp/senders/${senderId}/verify`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to verify sender");
      }
      setSenders((current) =>
        current.map((entry) => (entry.id === data.id ? data : entry)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify sender");
    } finally {
      setVerifyingId(null);
    }
  }

  function openTrackingModal(sender: SmtpSender) {
    const domain = sender.pendingTrackingDomain || sender.trackingDomain || "";
    setTrackingSender(sender);
    setTrackingDomainDraft(domain);
    setTrackingRecords(domain ? trackingDnsRecords(domain) : []);
    setTrackingError("");
    setMenuOpenId(null);
  }

  function closeTrackingModal() {
    if (trackingSaving || trackingVerifying) {
      return;
    }
    setTrackingSender(null);
    setTrackingDomainDraft("");
    setTrackingRecords([]);
    setTrackingError("");
  }

  async function saveTrackingDomain() {
    if (!trackingSender) {
      return;
    }
    setTrackingSaving(true);
    setTrackingError("");
    try {
      const response = await fetch(`/api/smtp/senders/${trackingSender.id}/tracking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingDomain: trackingDomainDraft }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to save tracking domain");
      }
      setSenders((current) =>
        current.map((entry) => (entry.id === data.sender.id ? data.sender : entry)),
      );
      setTrackingSender(data.sender);
      setTrackingRecords(data.records ?? trackingDnsRecords(trackingDomainDraft));
      setSuccess("Add the DNS record below, then click Verify.");
    } catch (err) {
      setTrackingError(err instanceof Error ? err.message : "Failed to save tracking domain");
    } finally {
      setTrackingSaving(false);
    }
  }

  async function verifyTrackingDomainNow() {
    if (!trackingSender) {
      return;
    }
    setTrackingVerifying(true);
    setTrackingError("");
    try {
      const response = await fetch(
        `/api/smtp/senders/${trackingSender.id}/tracking/verify`,
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to verify tracking domain");
      }
      setSenders((current) =>
        current.map((entry) => (entry.id === data.sender.id ? data.sender : entry)),
      );
      setTrackingSender(data.sender);
      setTrackingRecords(data.records ?? []);
      if (data.sender.trackingVerification?.verified) {
        setSuccess(`Tracking domain ${data.sender.trackingDomain} is verified.`);
      } else {
        setTrackingError(
          data.sender.trackingVerification?.detail ||
            "DNS is not ready yet. Wait a few minutes and verify again.",
        );
      }
    } catch (err) {
      setTrackingError(err instanceof Error ? err.message : "Failed to verify tracking domain");
    } finally {
      setTrackingVerifying(false);
    }
  }

  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setTrackingError("Could not copy to clipboard.");
    }
  }

  return (
    <>
      <div className="crm-page-head">
        <div>
          <h2>SMTP &amp; Senders</h2>
          <p className="desc">
            Add verified senders through AWS SES, Gmail, Outlook, SendGrid,
            Cloudflare, or Resend.
          </p>
        </div>
        <div className="crm-actions">
          <button type="button" className="btn-dark" onClick={openModal}>
            Add sender
          </button>
        </div>
      </div>

      {error && !modalOpen ? <div className="crm-error">{error}</div> : null}
      {success ? <div className="crm-summary">{success}</div> : null}

      <div className="vs-section">
        <h3>Configured senders ({loading ? "…" : senders.length})</h3>

        {loading ? (
          <div className="crm-empty">Loading senders...</div>
        ) : senders.length === 0 ? (
          <div className="crm-empty">
            No senders yet. Click <strong>Add sender</strong> to connect your first
            provider.
          </div>
        ) : (
          <div className="vs-list">
            {senders.map((sender) => {
              const expanded = isExpanded(sender.id);
              const menuOpen = menuOpenId === sender.id;
              const verified = isSenderVerified(sender);
              const verifying = verifyingId === sender.id;

              return (
                <div className="vs-card" key={sender.id}>
                  <div
                    className={`vs-card-top${expanded ? " is-expanded" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={expanded}
                    onClick={() => toggleExpanded(sender.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleExpanded(sender.id);
                      }
                    }}
                  >
                    <div className="vs-sender">
                      <div className="vs-email-row">
                        <SmtpProviderBadge providerId={sender.provider} />
                        <div className="vs-email">
                          {formatSenderDisplayName(sender.fromEmail)}
                        </div>
                      </div>
                      <span
                        className={`vs-verified ${verified ? "" : "pending"}`}
                      >
                        <span className="dot" />
                        {sender.noInbox
                          ? "No inbox"
                          : verified
                            ? "Verified"
                            : "Needs setup"}
                      </span>
                    </div>
                    <div
                      className="vs-actions"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="vs-edit"
                        onClick={() => openEditSender(sender)}
                      >
                        Edit
                      </button>
                      <div className="vs-menu-wrap">
                        <button
                          type="button"
                          className={`vs-more ${menuOpen ? "is-open" : ""}`}
                          aria-label="More actions"
                          aria-expanded={menuOpen}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuOpenId(menuOpen ? null : sender.id);
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="1.6" />
                            <circle cx="12" cy="12" r="1.6" />
                            <circle cx="12" cy="19" r="1.6" />
                          </svg>
                        </button>
                        {menuOpen ? (
                          <div
                            className="vs-menu"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="vs-menu-item"
                              onClick={() => openTrackingModal(sender)}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                aria-hidden="true"
                              >
                                <circle cx="12" cy="12" r="3" />
                                <path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
                              </svg>
                              Set custom tracking domain
                            </button>
                            <button
                              type="button"
                              className="vs-menu-delete"
                              disabled={deletingId === sender.id}
                              onClick={() => void handleDelete(sender)}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                aria-hidden="true"
                              >
                                <path d="M3 6h18" />
                                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                              </svg>
                              {deletingId === sender.id
                                ? "Deleting..."
                                : "Delete sender"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="vs-retest"
                        aria-label="Retest DNS records"
                        disabled={verifying || Boolean(sender.noInbox)}
                        title={
                          sender.noInbox
                            ? "DNS checks are skipped for no-inbox senders"
                            : "Retest DNS records"
                        }
                        onClick={() => void recheckSender(sender.id)}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M1 4v6h6" />
                          <path d="M23 20v-6h-6" />
                          <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="vs-toggle"
                        aria-label={expanded ? "Collapse details" : "Expand details"}
                        aria-expanded={expanded}
                        onClick={() => toggleExpanded(sender.id)}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          {expanded ? (
                            <path d="m18 15-6-6-6 6" />
                          ) : (
                            <path d="m6 9 6 6 6-6" />
                          )}
                        </svg>
                      </button>
                    </div>
                  </div>
                  {expanded ? (
                    <SenderExpandedDetails
                      sender={sender}
                      verifying={verifying}
                      dailyLimitSaving={dailyLimitSavingId === sender.id}
                      onDailyLimitSave={(nextLimit) =>
                        handleDailyLimitSave(sender, nextLimit)
                      }
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalOpen ? (
        <div
          className="crm-modal-backdrop"
          onPointerDown={handleBackdropInteraction}
          onClick={handleBackdropInteraction}
        >
          <div
            className={`crm-modal smtp-modal ${modalStep === "form" ? "smtp-modal-form" : ""}`}
            role="dialog"
            aria-modal="true"
          >
            <div className="crm-modal-head smtp-modal-head">
              <div className="smtp-modal-title">
                {modalStep === "form" && selectedProvider ? (
                  <SmtpProviderLogo provider={selectedProvider} size="head" />
                ) : null}
                <div>
                  <h3>
                    {modalStep === "provider"
                      ? "Add sender"
                      : editingSenderId
                        ? "Edit sender"
                        : selectedProvider?.name ?? "Connect sender"}
                  </h3>
                  <p>
                    {modalStep === "provider"
                      ? "Select your email provider."
                      : editingSenderId
                        ? "Update your sender credentials."
                        : "Enter your sender credentials."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                onClick={() => closeModal()}
              >
                ×
              </button>
            </div>

            <div className="crm-modal-body smtp-modal-body">
              {error ? <div className="crm-error">{error}</div> : null}

              {modalStep === "provider" ? (
                <div className="smtp-provider-grid">
                  {SMTP_PROVIDERS.map((provider) => (
                    <button
                      type="button"
                      key={provider.id}
                      className="smtp-provider-card"
                      onClick={() => selectProvider(provider)}
                    >
                      <SmtpProviderLogo provider={provider} size="lg" />
                      <span className="smtp-provider-card-name">{provider.name}</span>
                      <span className="smtp-provider-card-hint">Connect</span>
                    </button>
                  ))}
                </div>
              ) : selectedProvider ? (
                <form id="smtp-sender-form" onSubmit={handleSubmit}>
                  <div className="smtp-form-stack">
                    {selectedProvider.fields.map((field) => (
                      <div className="crm-field" key={field.key}>
                        <label htmlFor={field.key}>{field.label}</label>
                        <input
                          id={field.key}
                          type={field.type}
                          placeholder={
                            editingSenderId && field.type === "password"
                              ? "Leave blank to keep current"
                              : field.placeholder
                          }
                          required={
                            field.required &&
                            !(editingSenderId && field.type === "password")
                          }
                          value={
                            field.key === "smtpPort"
                              ? form.smtpPort ?? ""
                              : String(form[field.key] ?? "")
                          }
                          onChange={(event) =>
                            updateField(field.key, event.target.value)
                          }
                        />
                      </div>
                    ))}
                    {selectedProvider.id === "gmail" ? (
                      <div className="crm-field">
                        <label htmlFor="smtp-daily-limit">Daily limit</label>
                        <input
                          id="smtp-daily-limit"
                          type="number"
                          min={GMAIL_DAILY_LIMIT_MIN}
                          max={GMAIL_DAILY_LIMIT_MAX}
                          step={1}
                          value={dailyLimit}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            if (!Number.isFinite(next)) {
                              setDailyLimit(GMAIL_DAILY_LIMIT_DEFAULT);
                              return;
                            }
                            setDailyLimit(
                              Math.min(
                                GMAIL_DAILY_LIMIT_MAX,
                                Math.max(GMAIL_DAILY_LIMIT_MIN, Math.floor(next)),
                              ),
                            );
                          }}
                        />
                      </div>
                    ) : null}
                    <div className="smtp-no-inbox-row">
                      <div className="smtp-no-inbox-copy">
                        <div className="smtp-no-inbox-label">No inbox</div>
                        <p className="smtp-no-inbox-hint">
                          Skip SPF, DKIM, and DMARC checks for outbound-only
                          senders.
                        </p>
                      </div>
                      <button
                        type="button"
                        className={`drip-toggle${noInbox ? " on" : ""}`}
                        role="switch"
                        aria-checked={noInbox}
                        aria-label="No inbox"
                        onClick={() => setNoInbox((current) => !current)}
                      >
                        {noInbox ? (
                          <svg
                            className="drip-toggle-check"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          >
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        ) : null}
                        <span className="drip-toggle-knob" />
                      </button>
                    </div>
                  </div>
                </form>
              ) : null}
            </div>

            <div className="crm-modal-foot smtp-modal-foot">
              {modalStep === "form" && !editingSenderId ? (
                <button
                  type="button"
                  className="btn-soft"
                  disabled={saving}
                  onClick={backToProviders}
                >
                  Back
                </button>
              ) : (
                <button type="button" className="btn-soft" onClick={() => closeModal()}>
                  Cancel
                </button>
              )}
              {modalStep === "form" ? (
                <button
                  type="submit"
                  form="smtp-sender-form"
                  className="btn-dark"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : editingSenderId
                      ? "Save changes"
                      : "Add sender"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {trackingSender ? (
        <div
          className="crm-modal-backdrop"
          onPointerDown={handleBackdropInteraction}
          onClick={handleBackdropInteraction}
        >
          <div className="crm-modal smtp-modal smtp-modal-form" role="dialog" aria-modal="true">
            <div className="crm-modal-head smtp-modal-head">
              <div>
                <h3>Set custom tracking domain</h3>
                <p>
                  Point a CNAME at {DEFAULT_TRACKING_HOST}, then verify. We also
                  check HTTPS — if Cloudflare returns Error 1014 (CNAME
                  Cross-User Banned), keep using {DEFAULT_TRACKING_HOST} for
                  opens, clicks, and unsubscribe.
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                onClick={closeTrackingModal}
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body smtp-modal-body">
              {trackingError ? <div className="crm-error">{trackingError}</div> : null}
              <div className="crm-field">
                <label htmlFor="custom-tracking-domain">Tracking domain</label>
                <input
                  id="custom-tracking-domain"
                  type="text"
                  placeholder="track.yourdomain.com"
                  value={trackingDomainDraft}
                  onChange={(event) => setTrackingDomainDraft(event.target.value)}
                />
              </div>
              {trackingRecords.length > 0 ? (
                <div className="smtp-dns-box">
                  <div className="smtp-dns-title">Add this DNS record</div>
                  <table className="smtp-dns-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Host</th>
                        <th>Value</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {trackingRecords.map((record) => (
                        <tr key={`${record.host}-${record.value}`}>
                          <td>{record.type}</td>
                          <td>{record.host}</td>
                          <td>{record.value}</td>
                          <td>
                            <button
                              type="button"
                              className="smtp-dns-copy"
                              onClick={() => void copyValue(record.value)}
                            >
                              Copy
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="smtp-field-hint">{trackingRecords[0]?.purpose}</p>
                  {trackingSender.trackingVerification ? (
                    <p className={`smtp-dns-status${trackingSender.trackingVerification.verified ? " ok" : ""}`}>
                      {trackingSender.trackingVerification.verified
                        ? "Verified"
                        : "Not verified yet"}
                      {trackingSender.trackingVerification.detail
                        ? ` — ${trackingSender.trackingVerification.detail}`
                        : ""}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="crm-modal-foot smtp-modal-foot">
              <button type="button" className="btn-soft" onClick={closeTrackingModal}>
                Close
              </button>
              <button
                type="button"
                className="btn-soft"
                disabled={trackingSaving || !trackingDomainDraft.trim()}
                onClick={() => void saveTrackingDomain()}
              >
                {trackingSaving ? "Saving..." : "Show DNS records"}
              </button>
              <button
                type="button"
                className="btn-dark"
                disabled={trackingVerifying || trackingRecords.length === 0}
                onClick={() => void verifyTrackingDomainNow()}
              >
                {trackingVerifying ? "Verifying..." : "Verify"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
