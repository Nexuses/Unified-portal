"use client";

import { FormEvent, useEffect, useState } from "react";

type ApiKeyRow = {
  id: string;
  name: string;
  hint: string;
  scopes: Array<"read" | "write">;
  lastUsedAt?: string;
  createdAt: string;
};

function formatWhen(value?: string) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const SENDER_SAMPLE = `curl -X POST https://unified.nexuses.xyz/api/smtp/senders \\
  -H "Authorization: Bearer up_live_…" \\
  -H "X-Project-Id: PROJECT_ID" \\
  -H "Content-Type: application/json" \\
  -d '{
    "provider": "aws_ses",
    "fromEmail": "you@company.com",
    "smtpHost": "email-smtp.us-east-1.amazonaws.com",
    "smtpUser": "SMTP_USER",
    "smtpPassword": "SMTP_PASSWORD",
    "smtpPort": 587
  }'`;

export default function AdminIntegrationsPanel() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState("");
  const [rawKey, setRawKey] = useState("");
  const [copied, setCopied] = useState(false);

  async function loadKeys() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/integrations/keys", {
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to load API keys",
        );
      }
      setKeys(Array.isArray(data?.keys) ? data.keys : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadKeys();
  }, []);

  async function createKey(event: FormEvent) {
    event.preventDefault();
    if (creating) {
      return;
    }
    setCreating(true);
    setError("");
    setCopied(false);
    try {
      const response = await fetch("/api/admin/integrations/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to create API key",
        );
      }
      setRawKey(typeof data?.rawKey === "string" ? data.rawKey : "");
      setName("");
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: string) {
    if (revokingId) {
      return;
    }
    const confirmed = window.confirm(
      "Revoke this API key? Apps using it will lose access immediately.",
    );
    if (!confirmed) {
      return;
    }
    setRevokingId(id);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/integrations/keys/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to revoke API key",
        );
      }
      setRawKey("");
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke API key");
    } finally {
      setRevokingId("");
    }
  }

  async function copyRawKey() {
    if (!rawKey) {
      return;
    }
    try {
      await navigator.clipboard.writeText(rawKey);
      setCopied(true);
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-integrations">
        <section className="admin-card admin-create-card">
          <h1 className="admin-card-title">Create API key</h1>
          <p className="admin-card-subtitle">
            Each key has full read and write access. Send{" "}
            <code>X-Project-Id</code> to work in any project, including adding,
            updating, and deleting senders.
          </p>
          <form className="admin-form" onSubmit={(event) => void createKey(event)}>
            <label className="admin-field">
              <span className="admin-field-label">Name</span>
              <input
                className="admin-input"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Partner sync, internal tool"
                maxLength={80}
                required
              />
            </label>
            {error ? <p className="admin-error">{error}</p> : null}
            <div className="admin-form-actions">
              <button
                type="submit"
                className="admin-primary-btn"
                disabled={creating || !name.trim()}
              >
                {creating ? "Creating…" : "Create API key"}
              </button>
            </div>
          </form>
        </section>

        {rawKey ? (
          <section className="admin-card admin-secret-banner" role="status">
            <div>
              <h2 className="admin-list-card-title">Copy your API key now</h2>
              <p className="admin-card-subtitle">
                This is the only time the full key is shown. Access is read and
                write on every project.
              </p>
            </div>
            <code className="admin-secret-value">{rawKey}</code>
            <div className="admin-form-actions">
              <button
                type="button"
                className="admin-primary-btn"
                onClick={() => void copyRawKey()}
              >
                {copied ? "Copied" : "Copy key"}
              </button>
              <button
                type="button"
                className="admin-secondary-btn"
                onClick={() => {
                  setRawKey("");
                  setCopied(false);
                }}
              >
                Dismiss
              </button>
            </div>
          </section>
        ) : null}

        <section className="admin-card admin-create-card">
          <h2 className="admin-list-card-title">Sender CRUD</h2>
          <p className="admin-card-subtitle">
            Authenticate with <code>Authorization: Bearer &lt;key&gt;</code> and
            set <code>X-Project-Id</code> to the project id from{" "}
            <code>GET /api/projects</code>.
          </p>
          <ul className="admin-api-list">
            <li>
              <code>GET /api/smtp/senders</code> — list senders
            </li>
            <li>
              <code>POST /api/smtp/senders</code> — add a sender
            </li>
            <li>
              <code>PATCH /api/smtp/senders/:id</code> — update a sender
            </li>
            <li>
              <code>DELETE /api/smtp/senders/:id</code> — delete a sender
            </li>
          </ul>
          <pre className="admin-code-sample">{SENDER_SAMPLE}</pre>
        </section>

        <section className="admin-card admin-list-card">
          <div className="admin-list-card-header">
            <h2 className="admin-list-card-title">API keys</h2>
            <span className="admin-list-card-count">{keys.length}</span>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Access</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="admin-empty">
                      Loading API keys…
                    </td>
                  </tr>
                ) : keys.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="admin-empty">
                      No API keys yet. Create one above.
                    </td>
                  </tr>
                ) : (
                  keys.map((key) => (
                    <tr key={key.id}>
                      <td>{key.name}</td>
                      <td>
                        <code>{key.hint}</code>
                      </td>
                      <td>Read &amp; write · any project</td>
                      <td>{formatWhen(key.createdAt)}</td>
                      <td>{formatWhen(key.lastUsedAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="admin-secondary-btn"
                          disabled={revokingId === key.id}
                          onClick={() => void revokeKey(key.id)}
                        >
                          {revokingId === key.id ? "Revoking…" : "Revoke"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
