"use client";

import { useState } from "react";

export default function UnsubscribePage({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function handleUnsubscribe() {
    setStatus("saving");
    setError("");
    try {
      const response = await fetch(`/api/unsubscribe/${token}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to unsubscribe");
      }
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
          <>
            <p>
              <strong>{email}</strong> has been unsubscribed from marketing emails.
            </p>
          </>
        ) : (
          <>
            <p>
              Use the Unsubscribe button to stop receiving marketing emails from us at{" "}
              <strong>{email}</strong>
            </p>
            {error ? <p className="unsub-public-error">{error}</p> : null}
            <button
              type="button"
              className="unsub-public-btn"
              onClick={() => void handleUnsubscribe()}
              disabled={status === "saving"}
            >
              {status === "saving" ? "Unsubscribing..." : "Unsubscribe"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
