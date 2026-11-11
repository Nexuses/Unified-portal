"use client";

import { useState, type FormEvent } from "react";
import {
  formatCloudSenderProvider,
  type CloudSenderProvider,
} from "@/lib/cloud-campaigns";

export type CloudAuthMode = "credentials" | "otp" | "user_input";

export default function CloudSenderSignInPanel({
  provider,
  mode,
  busy,
  desktopUrl,
  initialEmail = "",
  onSignIn,
  onSubmitCode,
  onSwitchToCredentials,
}: {
  provider: CloudSenderProvider;
  mode: CloudAuthMode;
  busy: boolean;
  desktopUrl?: string;
  initialEmail?: string;
  onSignIn: (input: { email: string; password: string }) => Promise<void>;
  onSubmitCode: (code: string) => Promise<void>;
  onSwitchToCredentials?: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const product = formatCloudSenderProvider(provider);

  async function handleSignIn(event: FormEvent) {
    event.preventDefault();
    const nextEmail = email.trim();
    const nextPassword = password;
    setPassword("");
    await onSignIn({ email: nextEmail, password: nextPassword });
  }

  async function handleCode(event: FormEvent) {
    event.preventDefault();
    const nextCode = code.trim();
    setCode("");
    await onSubmitCode(nextCode);
  }

  return (
    <div className="cloud-auth-panel">
      <strong className="cloud-auth-title">Sign in on the computer</strong>
      {mode === "credentials" ? (
        <form className="cloud-auth-form" onSubmit={(event) => void handleSignIn(event)}>
          <p className="cloud-auth-hint">
            Enter the {product} account once. We send it to the computer to type into the
            browser and do not save the password in Nexuses.
          </p>
          <label className="crm-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={`you@${provider === "outlook" ? "company.com" : "gmail.com"}`}
              disabled={busy}
              required
            />
          </label>
          <label className="crm-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              required
            />
          </label>
          {provider === "gmail" ? (
            <p className="cloud-auth-hint">
              If this Google account uses 2-step verification, use an{" "}
              <a
                href="https://support.google.com/accounts/answer/185833"
                target="_blank"
                rel="noopener noreferrer"
              >
                App Password
              </a>{" "}
              instead of your normal password when Google allows it.
            </p>
          ) : null}
          <div className="cloud-step-actions">
            <button type="submit" className="btn-dark" disabled={busy}>
              Sign in on computer
            </button>
            {desktopUrl ? (
              <a
                className="btn-soft"
                href={desktopUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open desktop in new tab
              </a>
            ) : null}
          </div>
        </form>
      ) : null}

      {mode === "otp" ? (
        <form className="cloud-auth-form cloud-auth-otp" onSubmit={(event) => void handleCode(event)}>
          <p className="cloud-auth-hint">
            {product} is asking for a verification code. Paste it here and we will type it on
            the computer.
          </p>
          <label className="crm-field">
            <span>Verification code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              disabled={busy}
              required
            />
          </label>
          <div className="cloud-step-actions">
            <button type="submit" className="btn-dark" disabled={busy}>
              Submit code
            </button>
            {onSwitchToCredentials ? (
              <button
                type="button"
                className="btn-soft"
                disabled={busy}
                onClick={onSwitchToCredentials}
              >
                Try password again
              </button>
            ) : null}
            {desktopUrl ? (
              <a
                className="btn-soft"
                href={desktopUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open desktop in new tab
              </a>
            ) : null}
          </div>
        </form>
      ) : null}

      {mode === "user_input" ? (
        <div className="cloud-auth-form">
          <p className="cloud-auth-hint">
            Finish the remaining step on the desktop (phone confirmation, captcha, or
            &ldquo;Verify it&apos;s you&rdquo;), then click Check inbox.
          </p>
          <div className="cloud-step-actions">
            {desktopUrl ? (
              <a
                className="btn-dark"
                href={desktopUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open desktop in new tab
              </a>
            ) : null}
            {onSwitchToCredentials ? (
              <button
                type="button"
                className="btn-soft"
                disabled={busy}
                onClick={onSwitchToCredentials}
              >
                Use email and password
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
