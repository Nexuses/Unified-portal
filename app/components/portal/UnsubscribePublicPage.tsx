"use client";

import { useState, type FormEvent } from "react";

export default function UnsubscribePage({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [doneEmail, setDoneEmail] = useState("");

  async function handleUnsubscribe(event: FormEvent) {
    event.preventDefault();
    const typed = email.trim().toLowerCase();
    if (!typed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) {
      setStatus("error");
      setError("Enter a valid email address.");
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const response = await fetch(`/api/unsubscribe/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: typed }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to unsubscribe");
      }
      setDoneEmail(String(data.email || typed));
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to unsubscribe");
    }
  }

  return (
    <div className="unsub-public-page">
      <div className="unsub-public-card">
        <h1>Unsubscribe</h1>
        {status === "done" ? (
          <p>
            <strong>{doneEmail}</strong> has been unsubscribed from marketing emails.
          </p>
        ) : (
          <form onSubmit={(event) => void handleUnsubscribe(event)}>
            <p>
              Enter your email address and use the Unsubscribe button to stop
              receiving marketing emails from us.
            </p>
            <label className="unsub-public-label" htmlFor="unsubscribe-email">
              Email address
            </label>
            <input
              id="unsubscribe-email"
              className="unsub-public-input"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="Enter your email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={status === "saving"}
              required
            />
            {error ? <p className="unsub-public-error">{error}</p> : null}
            <button
              type="submit"
              className="unsub-public-btn"
              disabled={status === "saving"}
            >
              {status === "saving" ? "Unsubscribing..." : "Unsubscribe"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
