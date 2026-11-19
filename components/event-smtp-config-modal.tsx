"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  emptySmtpConfigForProvider,
  getSmtpProviderPreset,
  SMTP_PROVIDER_PRESETS,
  smtpProviderLabel,
  type EventSmtpConfig,
  type SmtpProviderId,
} from "@/lib/event-smtp";

type EventSmtpConfigModalProps = {
  open: boolean;
  onClose: () => void;
  value: EventSmtpConfig | null;
  senderEmail?: string;
  onSave: (result: { smtpConfig: EventSmtpConfig | null; senderEmail?: string }) => void;
};

const inputClass =
  "mt-2 h-11 w-full rounded-xl border border-black/10 bg-[#fafaf8] px-3 text-sm text-black outline-none transition focus:border-black/30 focus:bg-white";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SmtpStandardFields({
  draft,
  setDraft,
  fromEmail,
  setFromEmail,
  hostPlaceholder,
}: {
  draft: EventSmtpConfig;
  setDraft: Dispatch<SetStateAction<EventSmtpConfig>>;
  fromEmail: string;
  setFromEmail: (value: string) => void;
  hostPlaceholder: string;
}) {
  return (
    <>
      <label className="block">
        <span className="text-sm text-black/70">SMTP host</span>
        <input
          type="text"
          className={inputClass}
          value={draft.host}
          onChange={(event) => setDraft((prev) => ({ ...prev, host: event.target.value }))}
          placeholder={hostPlaceholder}
          autoComplete="off"
        />
      </label>
      <label className="block">
        <span className="text-sm text-black/70">SMTP user</span>
        <input
          type="text"
          className={inputClass}
          value={draft.user}
          onChange={(event) => setDraft((prev) => ({ ...prev, user: event.target.value }))}
          placeholder="SMTP username / email"
          autoComplete="off"
        />
      </label>
      <label className="block">
        <span className="text-sm text-black/70">SMTP password</span>
        <input
          type="password"
          className={inputClass}
          value={draft.pass}
          onChange={(event) => setDraft((prev) => ({ ...prev, pass: event.target.value }))}
          placeholder="SMTP password"
          autoComplete="new-password"
        />
      </label>
      <label className="block">
        <span className="text-sm text-black/70">SMTP port</span>
        <input
          type="number"
          min={1}
          className={inputClass}
          value={draft.port}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, port: Number(event.target.value) || 587 }))
          }
        />
      </label>
      <label className="block">
        <span className="text-sm text-black/70">From email</span>
        <input
          type="email"
          className={inputClass}
          value={fromEmail}
          onChange={(event) => setFromEmail(event.target.value)}
          placeholder="events@yourdomain.com"
          autoComplete="off"
        />
      </label>
    </>
  );
}

export function EventSmtpConfigModal({
  open,
  onClose,
  value,
  senderEmail = "",
  onSave,
}: EventSmtpConfigModalProps) {
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [draft, setDraft] = useState<EventSmtpConfig>(emptySmtpConfigForProvider("gmail"));
  const [fromEmail, setFromEmail] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    if (value) {
      setDraft(value);
      setStep("form");
    } else {
      setDraft(emptySmtpConfigForProvider("gmail"));
      setStep("pick");
    }
    setFromEmail(senderEmail.trim());
    setError("");
  }, [open, value, senderEmail]);

  if (!open) {
    return null;
  }

  const preset = getSmtpProviderPreset(draft.provider);
  const provider = draft.provider;

  function selectProvider(next: SmtpProviderId) {
    setDraft(emptySmtpConfigForProvider(next));
    setStep("form");
    setError("");
  }

  function requireFromEmail() {
    const from = fromEmail.trim();
    if (!from || !EMAIL_RE.test(from)) {
      setError("Enter a valid From email.");
      return null;
    }
    return from;
  }

  function handleSave() {
    if (provider === "resend") {
      const from = requireFromEmail();
      if (!from) {
        return;
      }
      const apiKey = draft.pass.trim();
      if (!apiKey) {
        setError("Resend API key is required.");
        return;
      }
      onSave({
        smtpConfig: { ...emptySmtpConfigForProvider("resend"), pass: apiKey },
        senderEmail: from,
      });
      onClose();
      return;
    }

    if (provider === "cloudflare") {
      const from = requireFromEmail();
      if (!from) {
        return;
      }
      const accountId = (draft.accountId ?? "").trim();
      const token = draft.pass.trim();
      if (!accountId) {
        setError("CLOUDFLARE_ACCOUNT_ID is required.");
        return;
      }
      if (!token) {
        setError("CLOUDFLARE_EMAIL_API_TOKEN is required.");
        return;
      }
      onSave({
        smtpConfig: {
          ...emptySmtpConfigForProvider("cloudflare"),
          accountId,
          pass: token,
        },
        senderEmail: from,
      });
      onClose();
      return;
    }

    // Gmail, Outlook, AWS SES, Custom — full SMTP fields
    const from = requireFromEmail();
    if (!from) {
      return;
    }
    const host = draft.host.trim();
    const user = draft.user.trim();
    const pass = draft.pass.trim();
    const port = Number(draft.port);
    if (!host) {
      setError("SMTP host is required.");
      return;
    }
    if (!user) {
      setError("SMTP user is required.");
      return;
    }
    if (!pass) {
      setError("SMTP password is required.");
      return;
    }
    if (!Number.isFinite(port) || port <= 0) {
      setError("Enter a valid SMTP port.");
      return;
    }
    onSave({
      smtpConfig: {
        provider,
        host,
        user,
        pass,
        port: Math.floor(port),
        secure: draft.secure || port === 465,
      },
      senderEmail: from,
    });
    onClose();
  }

  function handleUseDefault() {
    onSave({ smtpConfig: null });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-black/10 bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-black">Email SMTP settings</h3>
            <p className="mt-1 text-sm text-black/55">
              Pick a provider, then fill only the fields that provider needs.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-black/65 hover:bg-black/5 hover:text-black"
            aria-label="Close SMTP settings"
          >
            ×
          </button>
        </div>

        {step === "pick" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {SMTP_PROVIDER_PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectProvider(item.id)}
                className="rounded-xl border border-black/10 bg-[#fafaf8] p-4 text-left transition hover:border-black/25 hover:bg-white"
              >
                <p className="text-sm font-semibold text-black">{item.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-black/55">{item.description}</p>
              </button>
            ))}
          </div>
        ) : (
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-black">{smtpProviderLabel(provider)}</p>
              <button
                type="button"
                onClick={() => setStep("pick")}
                className="text-xs font-medium text-black/60 underline-offset-2 hover:text-black hover:underline"
              >
                Change provider
              </button>
            </div>

            <p className="mb-4 rounded-xl border border-black/8 bg-[#fafaf8] px-3 py-2 text-xs leading-relaxed text-black/60">
              {preset.description}
            </p>

            <div className="grid gap-4">
              {provider === "resend" ? (
                <>
                  <label className="block">
                    <span className="text-sm text-black/70">From email</span>
                    <input
                      type="email"
                      className={inputClass}
                      value={fromEmail}
                      onChange={(event) => setFromEmail(event.target.value)}
                      placeholder="events@yourdomain.com"
                      autoComplete="off"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-black/70">API key</span>
                    <input
                      type="password"
                      className={inputClass}
                      value={draft.pass}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, pass: event.target.value }))
                      }
                      placeholder="re_xxxxxxxx"
                      autoComplete="new-password"
                    />
                  </label>
                </>
              ) : null}

              {provider === "cloudflare" ? (
                <>
                  <label className="block">
                    <span className="text-sm text-black/70">CLOUDFLARE_ACCOUNT_ID</span>
                    <input
                      type="text"
                      className={inputClass}
                      value={draft.accountId ?? ""}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, accountId: event.target.value }))
                      }
                      placeholder="Your Cloudflare account ID"
                      autoComplete="off"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-black/70">CLOUDFLARE_EMAIL_API_TOKEN</span>
                    <input
                      type="password"
                      className={inputClass}
                      value={draft.pass}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, pass: event.target.value }))
                      }
                      placeholder="API token with Email Sending permission"
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-black/70">From email</span>
                    <input
                      type="email"
                      className={inputClass}
                      value={fromEmail}
                      onChange={(event) => setFromEmail(event.target.value)}
                      placeholder="events@yourdomain.com"
                      autoComplete="off"
                    />
                  </label>
                </>
              ) : null}

              {provider === "gmail" ||
              provider === "outlook" ||
              provider === "aws_ses" ||
              provider === "custom" ? (
                <SmtpStandardFields
                  draft={draft}
                  setDraft={setDraft}
                  fromEmail={fromEmail}
                  setFromEmail={setFromEmail}
                  hostPlaceholder={preset.host || "smtp.example.com"}
                />
              ) : null}
            </div>

            {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleUseDefault}
                className="text-xs font-medium text-black/55 underline-offset-2 hover:text-black hover:underline"
              >
                Use server default SMTP
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-10 items-center rounded-full border border-black/10 px-4 text-sm font-medium text-black/70 hover:bg-black/5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="inline-flex h-10 items-center rounded-full bg-[#171717] px-5 text-sm font-medium text-white hover:bg-black"
                >
                  Save SMTP
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
