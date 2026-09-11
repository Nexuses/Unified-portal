"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatListDate } from "@/lib/crm";

type SuppressionEntry = {
  id: string;
  email: string;
  fullName: string;
  addedAt: string;
};

type SuppressionDomainEntry = {
  id: string;
  domain: string;
  addedAt: string;
};

type UploadKind = "email" | "domain";

type CombinedEntry = {
  id: string;
  kind: UploadKind;
  value: string;
  name: string;
  addedAt: string;
};

const PAGE_SIZE = 10;

function csvCell(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  const blob = new Blob([`\uFEFF${lines.join("\n")}\n`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function TablePager({
  total,
  page,
  onPage,
}: {
  total: number;
  page: number;
  onPage: (next: number) => void;
}) {
  if (total <= PAGE_SIZE) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="drip-pagination unsub-pagination">
      <span className="drip-page-range">
        {start}-{end} of {total}
      </span>
      <div className="drip-page-controls">
        <select
          value={page}
          onChange={(event) => onPage(Number(event.target.value))}
          aria-label="Page"
        >
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
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          ‹
        </button>
        <button
          type="button"
          className="drip-page-arrow"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          ›
        </button>
      </div>
    </div>
  );
}

export default function PortalUnsubPage() {
  const [entries, setEntries] = useState<SuppressionEntry[]>([]);
  const [domains, setDomains] = useState<SuppressionDomainEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadKind, setUploadKind] = useState<UploadKind | null>(null);
  const [uploadText, setUploadText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [removingId, setRemovingId] = useState("");
  const [listPage, setListPage] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/crm/suppression");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load suppression list");
      }
      setEntries(data.entries ?? []);
      setDomains(data.domains ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load suppression list");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const combined = useMemo<CombinedEntry[]>(() => {
    const emailRows: CombinedEntry[] = entries.map((entry) => ({
      id: entry.id,
      kind: "email",
      value: entry.email,
      name: entry.fullName,
      addedAt: entry.addedAt,
    }));
    const domainRows: CombinedEntry[] = domains.map((entry) => ({
      id: entry.id,
      kind: "domain",
      value: entry.domain,
      name: "",
      addedAt: entry.addedAt,
    }));
    return [...emailRows, ...domainRows].sort(
      (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
    );
  }, [entries, domains]);

  const listPages = Math.max(1, Math.ceil(combined.length / PAGE_SIZE));

  useEffect(() => {
    if (listPage > listPages) {
      setListPage(listPages);
    }
  }, [listPage, listPages]);

  const pagedRows = useMemo(
    () => combined.slice((listPage - 1) * PAGE_SIZE, listPage * PAGE_SIZE),
    [combined, listPage],
  );

  function openUpload(kind: UploadKind) {
    setUploadKind(kind);
    setUploadText("");
    setUploadMessage("");
  }

  function closeUpload() {
    if (uploading) {
      return;
    }
    setUploadKind(null);
    setUploadText("");
    setUploadMessage("");
  }

  async function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }
    const text = await file.text();
    setUploadText((current) =>
      current.trim() ? `${current.trim()}\n${text}` : text,
    );
  }

  async function submitUpload() {
    if (!uploadKind) {
      return;
    }
    setUploading(true);
    setUploadMessage("");
    try {
      const response = await fetch("/api/crm/suppression", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: uploadKind, text: uploadText }),
      });
      const data = (await response.json()) as {
        error?: string;
        added?: number;
        skipped?: number;
        total?: number;
      };
      if (!response.ok) {
        throw new Error(data.error || "Failed to import");
      }
      setUploadMessage(
        `Added ${data.added ?? 0}${data.skipped ? `, ${data.skipped} already listed` : ""}.`,
      );
      await load();
      setUploadText("");
    } catch (err) {
      setUploadMessage(err instanceof Error ? err.message : "Failed to import");
    } finally {
      setUploading(false);
    }
  }

  async function removeItem(kind: UploadKind, id: string) {
    setRemovingId(id);
    setError("");
    try {
      const response = await fetch("/api/crm/suppression", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to remove");
      }
      if (kind === "email") {
        setEntries((current) => current.filter((entry) => entry.id !== id));
      } else {
        setDomains((current) => current.filter((entry) => entry.id !== id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setRemovingId("");
    }
  }

  function exportUnsubscribeCsv() {
    downloadCsv(
      "unsubscribe-list.csv",
      ["Type", "Value", "Name", "Added"],
      combined.map((row) => [
        row.kind === "email" ? "Email" : "Domain",
        row.value,
        row.name,
        formatListDate(row.addedAt),
      ]),
    );
  }

  return (
    <>
      <div className="crm-page-head">
        <div>
          <h2>Suppression List</h2>
          <p className="desc">
            Emails and domains here are skipped when sending campaigns, even if they
            are on the recipient list.
          </p>
        </div>
        <div className="crm-actions">
          <button
            type="button"
            className="btn-outline"
            onClick={() => openUpload("domain")}
          >
            Upload domains
          </button>
          <button
            type="button"
            className="btn-dark"
            onClick={() => openUpload("email")}
          >
            Upload emails
          </button>
        </div>
      </div>

      {error ? <div className="crm-error">{error}</div> : null}

      <div className="unsub-section-head">
        <h3 className="drip-report-audience-title">Unsubscribe list</h3>
        <button
          type="button"
          className="btn-outline"
          disabled={loading || combined.length === 0}
          onClick={exportUnsubscribeCsv}
        >
          Export CSV
        </button>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Email / Domain</th>
              <th>Name</th>
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="crm-empty-cell">
                  Loading unsubscribe list...
                </td>
              </tr>
            ) : combined.length === 0 ? (
              <tr>
                <td colSpan={5} className="crm-empty-cell">
                  No emails or domains on the unsubscribe list yet.
                </td>
              </tr>
            ) : (
              pagedRows.map((row) => (
                <tr key={`${row.kind}-${row.id}`}>
                  <td>{row.kind === "email" ? "Email" : "Domain"}</td>
                  <td>{row.value}</td>
                  <td>{row.name || "—"}</td>
                  <td>{formatListDate(row.addedAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="unsub-remove"
                      disabled={removingId === row.id}
                      onClick={() => void removeItem(row.kind, row.id)}
                    >
                      {removingId === row.id ? "Removing..." : "Remove"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <TablePager total={combined.length} page={listPage} onPage={setListPage} />

      {uploadKind ? (
        <div className="crm-modal-backdrop" onClick={closeUpload}>
          <div
            className="crm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsub-upload-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="unsub-upload-title">
                  {uploadKind === "email" ? "Upload emails" : "Upload domains"}
                </h3>
                <p>
                  {uploadKind === "email"
                    ? "Paste emails or upload a CSV/TXT. Anyone on this list is skipped on future sends."
                    : "Paste domains or upload a CSV/TXT. Every address at those domains is skipped on future sends."}
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                onClick={closeUpload}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body">
              <textarea
                className="unsub-upload-textarea"
                value={uploadText}
                onChange={(event) => setUploadText(event.target.value)}
                placeholder={
                  uploadKind === "email"
                    ? "alex@company.com\ncasey@agency.com"
                    : "competitor.com\nexample.org"
                }
                rows={8}
              />
              <div className="unsub-upload-file">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  hidden
                  onChange={(event) => {
                    void handleFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => fileRef.current?.click()}
                >
                  Choose CSV or TXT
                </button>
              </div>
              {uploadMessage ? (
                <div
                  className={
                    uploadMessage.startsWith("Added") ? "unsub-upload-ok" : "crm-error"
                  }
                >
                  {uploadMessage}
                </div>
              ) : null}
            </div>
            <div className="crm-modal-foot">
              <button type="button" className="btn-outline" onClick={closeUpload}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                onClick={() => void submitUpload()}
                disabled={uploading || !uploadText.trim()}
              >
                {uploading ? "Uploading..." : "Add to list"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
