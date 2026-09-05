"use client";

import { useEffect, useState, type FormEvent } from "react";

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

export default function PortalIntegrationsPage() {
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
      const response = await fetch("/api/integrations/keys", {
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
      const response = await fetch("/api/integrations/keys", {
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
      const response = await fetch(`/api/integrations/keys/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to revoke API key",
        );
      }
      if (rawKey) {
        setRawKey("");
      }
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
    <>
      <div className="crm-page-head api-page-head">
        <div>
          <h2>Integrations</h2>
          <p className="desc">
            Create API keys for external apps. Each key has full read and write access to
            this project’s portal APIs.
          </p>
        </div>
      </div>

      {error ? <div className="crm-error">{error}</div> : null}

      {rawKey ? (
        <div className="api-secret-banner" role="status">
          <div className="api-secret-banner-copy">
            <strong>Copy your API key now</strong>
            <p>This is the only time the full key is shown.</p>
          </div>
          <code className="api-secret-value">{rawKey}</code>
          <div className="api-secret-actions">
            <button type="button" className="btn-dark" onClick={() => void copyRawKey()}>
              {copied ? "Copied" : "Copy key"}
            </button>
            <button
              type="button"
              className="btn-soft"
              onClick={() => {
                setRawKey("");
                setCopied(false);
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <section className="api-create-card">
        <h3>Create API</h3>
        <p>
          Keys authenticate with{" "}
          <code>Authorization: Bearer &lt;key&gt;</code> and can call the same portal
          endpoints as your logged-in session (CRM, campaigns, SMTP, reports, and more).
        </p>
        <form className="api-create-form" onSubmit={(event) => void createKey(event)}>
          <label className="api-field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Zapier, internal sync, partner app"
              maxLength={80}
              required
            />
          </label>
          <button type="submit" className="btn-dark" disabled={creating || !name.trim()}>
            {creating ? "Creating…" : "Create API key"}
          </button>
        </form>
      </section>

      <section className="api-docs-card">
        <h3>How to use</h3>
        <pre className="api-code-sample">{`curl -H "Authorization: Bearer up_live_…" \\
  https://unified.nexuses.xyz/api/crm/contacts`}</pre>
        <p className="api-docs-note">
          Scope: <strong>read + write</strong> for this workspace. Revoke a key anytime to
          cut off access.
        </p>
      </section>

      <h3 className="api-list-title">Your API keys</h3>
      <div className="data-table-wrap">
        <table className="data-table">
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
                <td colSpan={6} className="crm-empty-cell">
                  Loading API keys…
                </td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="crm-empty-cell">
                  No API keys yet. Create one above.
                </td>
              </tr>
            ) : (
              keys.map((key) => (
                <tr key={key.id}>
                  <td>{key.name}</td>
                  <td>
                    <code className="api-key-hint">{key.hint}</code>
                  </td>
                  <td>Read &amp; write</td>
                  <td>{formatWhen(key.createdAt)}</td>
                  <td>{formatWhen(key.lastUsedAt)}</td>
                  <td className="api-revoke-cell">
                    <button
                      type="button"
                      className="btn-soft api-revoke-btn"
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
    </>
  );
}
