"use client";

import { useMemo, useState } from "react";
import {
  CLOUD_FOLLOWUP_MAX_STEPS,
  type CloudCampaign,
  type CloudFollowupSettings,
  type CloudFollowupStep,
} from "@/lib/cloud-campaigns";

export type CloudFollowupPreview = {
  row: number;
  step: number;
  to: string;
  subject: string;
  html: string;
  source?: "sheet" | "ai";
};

export type CloudFollowupSummary = {
  scheduled: number;
  sent: number;
  skipped: number;
  failed: number;
  nextDueAt?: string;
};

type Props = {
  campaign: CloudCampaign;
  headers: string[];
  busy: boolean;
  summary: CloudFollowupSummary | null;
  onSave: (settings: CloudFollowupSettings) => Promise<void>;
  onPreview: (row: number, step: number) => Promise<CloudFollowupPreview>;
};

const DEFAULT_DELAYS = [3, 4, 7, 10];

/** A sheet column that looks like it holds follow-up `n` ("Follow-up 1", "FU2", "Followup email 3"). */
function guessColumn(headers: string[], n: number) {
  const re = new RegExp(`^(follow\\s*-?\\s*up|fu|f/u)(\\s*(email|mail|message|text))?\\s*#?\\s*${n}$`, "i");
  return headers.find((h) => re.test(h.trim())) || undefined;
}

function newStep(index: number, headers: string[]): CloudFollowupStep {
  return {
    id: `fu${Date.now().toString(36)}${index}`,
    delayDays: DEFAULT_DELAYS[index] ?? 7,
    column: guessColumn(headers, index + 1),
    instructions: "",
  };
}

function when(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Step 5: automatic follow-ups, replies in the same thread, stopped by replies/bounces. */
export default function CloudFollowupsPanel({ campaign, headers, busy, summary, onSave, onPreview }: Props) {
  const saved = campaign.followups;
  const [enabled, setEnabled] = useState(saved ? saved.enabled : true);
  const [steps, setSteps] = useState<CloudFollowupStep[]>(() =>
    saved?.steps?.length ? saved.steps : [newStep(0, headers), newStep(1, headers)],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<CloudFollowupPreview | null>(null);
  const [previewStep, setPreviewStep] = useState(1);
  const [previewRow, setPreviewRow] = useState(0);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const total = campaign.sheetRowCount || 0;
  const locked = busy || saving;

  const dirty = useMemo(() => {
    if (!saved?.savedAt) return true;
    return JSON.stringify({ e: saved.enabled, s: saved.steps }) !== JSON.stringify({ e: enabled && steps.length > 0, s: steps });
  }, [saved, enabled, steps]);

  function update(index: number, patch: Partial<CloudFollowupStep>) {
    setSteps((list) => list.map((step, i) => (i === index ? { ...step, ...patch } : step)));
    setPreview(null);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave({ enabled: enabled && steps.length > 0, steps });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save follow-ups");
    } finally {
      setSaving(false);
    }
  }

  async function showPreview(row = previewRow, step = previewStep) {
    setLoadingPreview(true);
    setError("");
    try {
      setPreview(await onPreview(row, step));
      setPreviewRow(row);
      setPreviewStep(step);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build the preview");
    } finally {
      setLoadingPreview(false);
    }
  }

  return (
    <div className="cloud-fu">
      <label className="cloud-fu-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={locked}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setPreview(null);
          }}
        />
        <span>
          <strong>Send follow-ups automatically</strong>
          <small>
            Each one is a reply in the same thread. Anyone who replies, bounces or unsubscribes gets no more
            follow-ups. They go out on the sending days and hours set above.
          </small>
        </span>
      </label>

      {enabled ? (
        <>
          <ol className="cloud-fu-timeline">
            <li className="cloud-fu-origin">
              <span className="cloud-fu-dot" aria-hidden="true" />
              <div>
                <strong>Pitch</strong>
                <small>The first email from step 4</small>
              </div>
            </li>
            {steps.map((step, index) => {
              const usesSheet = Boolean(step.column);
              return (
                <li key={step.id} className="cloud-fu-step">
                  <span className="cloud-fu-dot" aria-hidden="true" />
                  <div className="cloud-fu-card">
                    <div className="cloud-fu-card-head">
                      <strong>Follow-up {index + 1}</strong>
                      <span className="cloud-fu-wait">
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={step.delayDays}
                          disabled={locked}
                          aria-label={`Days before follow-up ${index + 1}`}
                          onChange={(e) =>
                            update(index, { delayDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })
                          }
                        />
                        days after {index === 0 ? "the pitch" : `follow-up ${index}`}, if no reply
                      </span>
                      <button
                        type="button"
                        className="cloud-link-btn"
                        disabled={locked}
                        onClick={() => {
                          setSteps((list) => list.filter((_, i) => i !== index));
                          setPreview(null);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="cloud-fu-source">
                      <label>
                        <span>Text</span>
                        <select
                          value={step.column || ""}
                          disabled={locked}
                          onChange={(e) => update(index, { column: e.target.value || undefined })}
                        >
                          <option value="">AI writes it for each person</option>
                          {headers.map((header) => (
                            <option key={header} value={header}>
                              From column “{header}” (AI if empty)
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>{usesSheet ? "AI guidance for empty cells" : "AI guidance (optional)"}</span>
                        <textarea
                          rows={2}
                          maxLength={600}
                          value={step.instructions || ""}
                          disabled={locked}
                          placeholder={
                            index === steps.length - 1 && steps.length > 1
                              ? "e.g. Close the loop politely; offer to reconnect next quarter"
                              : "e.g. Mention our 2-week pilot; keep it to 3 lines"
                          }
                          onChange={(e) => update(index, { instructions: e.target.value })}
                        />
                      </label>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {steps.length < CLOUD_FOLLOWUP_MAX_STEPS ? (
            <button
              type="button"
              className="btn-soft btn-sm cloud-fu-add"
              disabled={locked}
              onClick={() => setSteps((list) => [...list, newStep(list.length, headers)])}
            >
              + Add follow-up
            </button>
          ) : null}

          <div className="cloud-fu-preview-bar">
            <span>Preview</span>
            <div className="cloud-fu-steps-pick" role="tablist" aria-label="Follow-up to preview">
              {steps.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  role="tab"
                  aria-selected={previewStep === index + 1}
                  className={previewStep === index + 1 ? "is-active" : ""}
                  disabled={loadingPreview || dirty}
                  onClick={() => void showPreview(previewRow, index + 1)}
                >
                  {index + 1}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-soft btn-sm"
              disabled={loadingPreview || dirty || total === 0}
              title={dirty ? "Save first to preview" : undefined}
              onClick={() => void showPreview()}
            >
              {loadingPreview ? "Writing…" : preview ? "Refresh" : "Preview for a person"}
            </button>
            {preview ? (
              <span className="cloud-fu-rownav">
                <button
                  type="button"
                  className="cloud-link-btn"
                  disabled={loadingPreview || previewRow <= 0}
                  onClick={() => void showPreview(previewRow - 1)}
                >
                  ← Prev
                </button>
                Row {previewRow + 1} of {total}
                <button
                  type="button"
                  className="cloud-link-btn"
                  disabled={loadingPreview || previewRow >= total - 1}
                  onClick={() => void showPreview(previewRow + 1)}
                >
                  Next →
                </button>
              </span>
            ) : dirty ? (
              <small className="cloud-muted">Save to preview</small>
            ) : null}
          </div>
          {preview ? (
            <div className="cloud-map-preview">
              <dl>
                <div>
                  <dt>To</dt>
                  <dd>{preview.to || "—"}</dd>
                </div>
                <div>
                  <dt>Subject</dt>
                  <dd>{preview.subject}</dd>
                </div>
                <div>
                  <dt>Text</dt>
                  <dd>
                    {preview.source === "sheet" ? "From the sheet" : "Written by AI"}
                    <small className="cloud-muted"> · this exact text is used when it sends</small>
                  </dd>
                </div>
              </dl>
              <iframe
                title="Follow-up preview"
                sandbox=""
                srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:12px;font-family:Arial,sans-serif">${preview.html}</body>`}
              />
            </div>
          ) : null}
        </>
      ) : (
        <p className="cloud-muted">No follow-ups: only the pitch is sent.</p>
      )}

      {summary && summary.scheduled + summary.sent + summary.skipped + summary.failed > 0 ? (
        <div className="cloud-fu-summary">
          <span className="cloud-tag">{summary.scheduled} scheduled</span>
          <span className="cloud-tag is-ok">{summary.sent} sent</span>
          <span className="cloud-tag">{summary.skipped} stopped</span>
          {summary.failed ? <span className="cloud-tag is-bad">{summary.failed} failed</span> : null}
          {summary.nextDueAt ? <small>Next: {when(summary.nextDueAt)}</small> : null}
        </div>
      ) : null}

      {error ? <p className="cloud-map-problems">{error}</p> : null}
      <div className="cloud-step-actions">
        <button type="button" className="btn-dark" disabled={locked || (!dirty && Boolean(saved?.savedAt))} onClick={() => void save()}>
          {saving ? "Saving…" : enabled && steps.length ? "Save follow-ups" : "Save — no follow-ups"}
        </button>
        {!dirty && saved?.savedAt ? <small className="cloud-muted">Saved</small> : null}
      </div>
    </div>
  );
}
