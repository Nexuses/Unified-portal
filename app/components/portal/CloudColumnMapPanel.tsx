"use client";

import { useState } from "react";
import {
  CLOUD_FIELD_LABELS,
  CLOUD_FIELDS,
  CLOUD_REQUIRED_FIELDS,
  type CloudColumnMap,
  type CloudColumnStats,
  type CloudField,
} from "@/lib/cloud-sheet-csv";

export type CloudRowPreview = {
  row: number;
  total: number;
  to: string;
  subject: string;
  html: string;
  issue: string;
};

type Props = {
  headers: string[];
  columnMap: CloudColumnMap;
  stats?: CloudColumnStats;
  busy: boolean;
  onSave: (map: CloudColumnMap) => void;
  onPreview: (row?: number) => Promise<CloudRowPreview | null>;
};

function issueLines(stats: CloudColumnStats) {
  const lines: string[] = [];
  if (stats.missingEmail) lines.push(`${stats.missingEmail} with no email`);
  if (stats.invalidEmail) lines.push(`${stats.invalidEmail} with an invalid email`);
  if (stats.missingSubject) lines.push(`${stats.missingSubject} with no subject`);
  if (stats.missingPitch) lines.push(`${stats.missingPitch} with an empty body`);
  if (stats.unresolvedTags) {
    lines.push(
      `${stats.unresolvedTags} using ${stats.exampleTag || "a merge tag"} with nothing to fill it`,
    );
  }
  return lines;
}

/** Shows which column feeds each email field, lets the user change it, and previews a row. */
export default function CloudColumnMapPanel({
  headers,
  columnMap,
  stats,
  busy,
  onSave,
  onPreview,
}: Props) {
  const [preview, setPreview] = useState<CloudRowPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const missingRequired = CLOUD_REQUIRED_FIELDS.filter((field) => !columnMap[field]);
  const problems = stats ? issueLines(stats) : [];
  const allReady = stats && stats.total > 0 && stats.ready === stats.total && !missingRequired.length;

  function change(field: CloudField, header: string) {
    const next: CloudColumnMap = { ...columnMap };
    if (header) next[field] = header;
    else delete next[field];
    // A column feeds one field only.
    for (const other of CLOUD_FIELDS) {
      if (other !== field && header && next[other] === header) delete next[other];
    }
    onSave(next);
    setPreview(null);
  }

  async function showPreview(row?: number) {
    setLoadingPreview(true);
    try {
      setPreview(await onPreview(row));
    } finally {
      setLoadingPreview(false);
    }
  }

  return (
    <div className="cloud-map">
      <div className="cloud-map-head">
        <strong>Columns</strong>
        {stats ? (
          <span className={`cloud-map-ready${allReady ? " is-ok" : problems.length || missingRequired.length ? " is-warn" : ""}`}>
            {missingRequired.length
              ? `Pick the ${missingRequired.map((f) => CLOUD_FIELD_LABELS[f].toLowerCase()).join(", ")} column`
              : `${stats.ready} of ${stats.total} rows ready`}
          </span>
        ) : null}
      </div>
      <p className="cloud-muted">
        Detected from your column names and contents. Change anything that looks wrong. Any
        column can also be used in the subject or body as <code>{"{{Column Name}}"}</code>.
      </p>

      <div className="cloud-map-grid">
        {CLOUD_FIELDS.map((field) => {
          const required = CLOUD_REQUIRED_FIELDS.includes(field);
          const value = columnMap[field] || "";
          return (
            <label key={field} className={`cloud-map-field${required && !value ? " is-missing" : ""}`}>
              <span>
                {CLOUD_FIELD_LABELS[field]}
                {required ? <em>Required</em> : null}
              </span>
              <select
                value={value}
                disabled={busy}
                onChange={(event) => change(field, event.target.value)}
              >
                <option value="">{required ? "Choose a column…" : "Not used"}</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>

      {problems.length && !missingRequired.length ? (
        <p className="cloud-map-problems">
          These rows will be skipped: {problems.join(" · ")}. Fix them in your list and load it
          again, or map a different column.
        </p>
      ) : null}

      <div className="cloud-map-preview-actions">
        <button
          type="button"
          className="btn-soft btn-sm"
          disabled={busy || loadingPreview || missingRequired.length > 0}
          onClick={() => void showPreview(preview ? preview.row : undefined)}
        >
          {loadingPreview ? "Loading…" : preview ? "Refresh preview" : "Preview an email"}
        </button>
        {preview ? (
          <>
            <button
              type="button"
              className="cloud-link-btn"
              disabled={loadingPreview || preview.row <= 0}
              onClick={() => void showPreview(preview.row - 1)}
            >
              ← Previous
            </button>
            <span className="cloud-muted">
              Row {preview.row + 1} of {preview.total}
            </span>
            <button
              type="button"
              className="cloud-link-btn"
              disabled={loadingPreview || preview.row >= preview.total - 1}
              onClick={() => void showPreview(preview.row + 1)}
            >
              Next →
            </button>
          </>
        ) : null}
      </div>

      {preview ? (
        <div className="cloud-map-preview">
          {preview.issue ? <p className="cloud-map-problems">Skipped when sending: {preview.issue}</p> : null}
          <dl>
            <div>
              <dt>To</dt>
              <dd>{preview.to || "—"}</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>{preview.subject || "—"}</dd>
            </div>
          </dl>
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:12px;font-family:Arial,sans-serif">${preview.html}</body>`}
          />
        </div>
      ) : null}
    </div>
  );
}
