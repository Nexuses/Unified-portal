"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  extractBulkSuppressionValues,
  type SuppressionKind,
} from "@/lib/unsubscribe-client";
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

type UploadKind = SuppressionKind;

type CombinedEntry = {
  id: string;
  kind: UploadKind;
  value: string;
  name: string;
  addedAt: string;
};

const PAGE_SIZE = 50;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const UPLOAD_CHUNK_SIZE = 2500;

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

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TablePager({
  total,
  page,
  pageSize,
  onPage,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (next: number) => void;
}) {
  if (total <= pageSize) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

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
  const [emailTotal, setEmailTotal] = useState(0);
  const [domainTotal, setDomainTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadKind, setUploadKind] = useState<UploadKind | null>(null);
  const [uploadText, setUploadText] = useState("");
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadFileBytes, setUploadFileBytes] = useState(0);
  const [uploadValues, setUploadValues] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [removingId, setRemovingId] = useState("");
  const [listPage, setListPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/crm/suppression?page=${page}&pageSize=${PAGE_SIZE}`,
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load suppression list");
      }
      setEntries(data.entries ?? []);
      setDomains(data.domains ?? []);
      setEmailTotal(Number(data.emailTotal ?? data.entries?.length ?? 0));
      setDomainTotal(Number(data.domainTotal ?? data.domains?.length ?? 0));
      setListPage(Number(data.page ?? page));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load suppression list");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  const combined = useMemo<CombinedEntry[]>(() => {
    // Domains stay visible on every page (usually small); emails are paginated.
    const domainRows: CombinedEntry[] = domains.map((entry) => ({
      id: entry.id,
      kind: "domain",
      value: entry.domain,
      name: "",
      addedAt: entry.addedAt,
    }));
    const emailRows: CombinedEntry[] = entries.map((entry) => ({
      id: entry.id,
      kind: "email",
      value: entry.email,
      name: entry.fullName,
      addedAt: entry.addedAt,
    }));
    return [...domainRows, ...emailRows];
  }, [entries, domains]);

  const listTotal = emailTotal + domainTotal;
  const pendingCount = uploadValues.length;

  function openUpload(kind: UploadKind) {
    setUploadKind(kind);
    setUploadText("");
    setUploadFileName("");
    setUploadFileBytes(0);
    setUploadValues([]);
    setUploadMessage("");
    setUploadProgress("");
  }

  function closeUpload() {
    if (uploading) {
      return;
    }
    setUploadKind(null);
    setUploadText("");
    setUploadFileName("");
    setUploadFileBytes(0);
    setUploadValues([]);
    setUploadMessage("");
    setUploadProgress("");
  }

  async function handleFile(file: File | undefined) {
    if (!file || !uploadKind) {
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadMessage(
        `File is too large (${formatBytes(file.size)}). Max size is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      );
      return;
    }

    setUploadMessage("");
    setUploadProgress("Reading file…");
    try {
      const text = await file.text();
      const values = extractBulkSuppressionValues(text, uploadKind);
      if (values.length === 0) {
        setUploadFileName("");
        setUploadFileBytes(0);
        setUploadValues([]);
        setUploadProgress("");
        setUploadMessage(
          uploadKind === "email"
            ? "No valid emails found in that file."
            : "No valid domains found in that file.",
        );
        return;
      }
      setUploadFileName(file.name);
      setUploadFileBytes(file.size);
      setUploadValues(values);
      setUploadProgress("");
      setUploadMessage("");
    } catch (err) {
      setUploadProgress("");
      setUploadMessage(
        err instanceof Error ? err.message : "Failed to read that file.",
      );
    }
  }

  function valuesToUpload(): string[] {
    if (uploadValues.length > 0) {
      return uploadValues;
    }
    if (!uploadKind || !uploadText.trim()) {
      return [];
    }
    return extractBulkSuppressionValues(uploadText, uploadKind);
  }

  async function submitUpload() {
    if (!uploadKind) {
      return;
    }
    const values = valuesToUpload();
    if (values.length === 0) {
      setUploadMessage(
        uploadKind === "email"
          ? "No valid emails found. Add one email per line or a CSV of addresses."
          : "No valid domains found. Add one domain per line, for example competitor.com.",
      );
      return;
    }

    setUploading(true);
    setUploadMessage("");
    let added = 0;
    let skipped = 0;
    const totalChunks = Math.ceil(values.length / UPLOAD_CHUNK_SIZE);

    try {
      for (let index = 0; index < values.length; index += UPLOAD_CHUNK_SIZE) {
        const chunk = values.slice(index, index + UPLOAD_CHUNK_SIZE);
        const chunkNumber = Math.floor(index / UPLOAD_CHUNK_SIZE) + 1;
        setUploadProgress(
          `Uploading chunk ${chunkNumber} of ${totalChunks} (${Math.min(index + chunk.length, values.length).toLocaleString()} / ${values.length.toLocaleString()})…`,
        );

        const response = await fetch("/api/crm/suppression", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: uploadKind, values: chunk }),
        });
        const data = (await response.json()) as {
          error?: string;
          added?: number;
          skipped?: number;
        };
        if (!response.ok) {
          throw new Error(data.error || "Failed to import");
        }
        added += data.added ?? 0;
        skipped += data.skipped ?? 0;
      }

      setUploadProgress("");
      setUploadMessage(
        `Added ${added.toLocaleString()}${skipped ? `, ${skipped.toLocaleString()} already listed` : ""} of ${values.length.toLocaleString()}.`,
      );
      setUploadText("");
      setUploadFileName("");
      setUploadFileBytes(0);
      setUploadValues([]);
      await load(1);
    } catch (err) {
      setUploadProgress("");
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
      await load(listPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setRemovingId("");
    }
  }

  async function exportUnsubscribeCsv() {
    setExporting(true);
    setError("");
    try {
      const rows: string[][] = [];
      for (const domain of domains) {
        rows.push([
          "Domain",
          domain.domain,
          "",
          formatListDate(domain.addedAt),
        ]);
      }

      let page = 1;
      let total = emailTotal;
      do {
        const response = await fetch(
          `/api/crm/suppression?page=${page}&pageSize=200`,
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to export");
        }
        total = Number(data.emailTotal ?? 0);
        for (const entry of (data.entries ?? []) as SuppressionEntry[]) {
          rows.push([
            "Email",
            entry.email,
            entry.fullName,
            formatListDate(entry.addedAt),
          ]);
        }
        page += 1;
      } while ((page - 1) * 200 < total);

      downloadCsv("unsubscribe-list.csv", ["Type", "Value", "Name", "Added"], rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export");
    } finally {
      setExporting(false);
    }
  }

  const canSubmit =
    !uploading && (uploadValues.length > 0 || Boolean(uploadText.trim()));

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
        <h3 className="drip-report-audience-title">
          Unsubscribe list
          {!loading ? (
            <span className="unsub-count-meta">
              {" "}
              · {emailTotal.toLocaleString()} emails · {domainTotal.toLocaleString()}{" "}
              domains
            </span>
          ) : null}
        </h3>
        <button
          type="button"
          className="btn-outline"
          disabled={loading || exporting || listTotal === 0}
          onClick={() => void exportUnsubscribeCsv()}
        >
          {exporting ? "Exporting…" : "Export CSV"}
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
              combined.map((row) => (
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
      <TablePager
        total={emailTotal}
        page={listPage}
        pageSize={PAGE_SIZE}
        onPage={(next) => void load(next)}
      />

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
                    ? "Paste emails or upload a CSV/TXT (up to 20 MB). Large files are imported in chunks so every address is saved."
                    : "Paste domains or upload a CSV/TXT (up to 20 MB). Large files are imported in chunks."}
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                onClick={closeUpload}
                aria-label="Close"
                disabled={uploading}
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body">
              <textarea
                className="unsub-upload-textarea"
                value={uploadText}
                onChange={(event) => {
                  setUploadText(event.target.value);
                  if (uploadValues.length > 0) {
                    setUploadValues([]);
                    setUploadFileName("");
                    setUploadFileBytes(0);
                  }
                }}
                placeholder={
                  uploadKind === "email"
                    ? "alex@company.com\ncasey@agency.com"
                    : "competitor.com\nexample.org"
                }
                rows={8}
                disabled={uploading}
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
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  Choose CSV or TXT
                </button>
                {uploadFileName ? (
                  <span className="unsub-upload-file-meta">
                    {uploadFileName} · {formatBytes(uploadFileBytes)} ·{" "}
                    {pendingCount.toLocaleString()}{" "}
                    {uploadKind === "email" ? "emails" : "domains"} ready
                  </span>
                ) : (
                  <span className="unsub-upload-file-meta">
                    Max {formatBytes(MAX_UPLOAD_BYTES)}
                  </span>
                )}
              </div>
              {uploadProgress ? (
                <div className="unsub-upload-ok">{uploadProgress}</div>
              ) : null}
              {uploadMessage ? (
                <div
                  className={
                    uploadMessage.startsWith("Added")
                      ? "unsub-upload-ok"
                      : "crm-error"
                  }
                >
                  {uploadMessage}
                </div>
              ) : null}
            </div>
            <div className="crm-modal-foot">
              <button
                type="button"
                className="btn-outline"
                onClick={closeUpload}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                onClick={() => void submitUpload()}
                disabled={!canSubmit}
              >
                {uploading
                  ? "Uploading…"
                  : pendingCount > 0
                    ? `Add ${pendingCount.toLocaleString()} to list`
                    : "Add to list"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
