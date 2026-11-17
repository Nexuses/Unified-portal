"use client";

import { useMemo, useState } from "react";
import {
  CLOUD_FONT_OPTIONS,
  CLOUD_STANDARD_STYLE,
  type CloudCampaign,
  type CloudEmailStyle,
} from "@/lib/cloud-campaigns";
import { buildCloudPitchHtml, resolveCloudRowFields } from "@/lib/cloud-sheet-csv";

type Props = {
  campaign: CloudCampaign;
  signatureHtml: string;
  busy: boolean;
  onSave: (style: CloudEmailStyle) => Promise<void>;
};

const SIZES = [12, 13, 14, 15, 16, 17, 18];
const SPACING = [
  { label: "Compact", value: 1.3 },
  { label: "Normal", value: 1.5 },
  { label: "Relaxed", value: 1.7 },
];
const TEXT_COLORS = [
  { label: "Black", value: "#222222" },
  { label: "Dark grey", value: "#444444" },
  { label: "Navy", value: "#1f2a44" },
];
const LINK_COLORS = [
  { label: "Blue", value: "#1a5fd0" },
  { label: "Gmail blue", value: "#1155cc" },
  { label: "Same as text", value: "#222222" },
];
const BOLD = [
  { value: "markdown", label: "Only what I wrote", hint: "Bold only text wrapped in **double stars** in the sheet." },
  { value: "auto", label: "Highlight company & key phrases", hint: "Also bolds the company name and short highlights." },
  { value: "none", label: "No bold", hint: "Everything in regular weight." },
] as const;

function same(a: CloudEmailStyle, b: CloudEmailStyle) {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.color.toLowerCase() === b.color.toLowerCase() &&
    a.lineHeight === b.lineHeight &&
    a.linkColor.toLowerCase() === b.linkColor.toLowerCase() &&
    a.bold === b.bold &&
    a.signatureFont === b.signatureFont
  );
}

function strip(style: CloudEmailStyle): CloudEmailStyle {
  const { savedAt, ...rest } = style;
  void savedAt;
  return rest;
}

/** Email style step: font, size, colours, spacing and bold for every email, with a live preview. */
export default function CloudEmailStylePanel({ campaign, signatureHtml, busy, onSave }: Props) {
  const saved = campaign.emailStyle ? strip(campaign.emailStyle) : null;
  const [style, setStyle] = useState<CloudEmailStyle>(saved || CLOUD_STANDARD_STYLE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const locked = busy || saving;
  const isStandard = same(style, CLOUD_STANDARD_STYLE);
  const dirty = !saved || !same(style, saved);

  const sample = campaign.sheetSamples?.[0]?.cells;
  const preview = useMemo(() => {
    if (!sample) return null;
    const fields = resolveCloudRowFields(sample, campaign.columnMap || {});
    return {
      to: fields.email,
      subject: fields.subject,
      html: buildCloudPitchHtml(sample, signatureHtml, campaign.columnMap || {}, style),
    };
  }, [sample, signatureHtml, campaign.columnMap, style]);

  function set<K extends keyof CloudEmailStyle>(key: K, value: CloudEmailStyle[K]) {
    setStyle((current) => ({ ...current, [key]: value }));
  }

  async function save(next: CloudEmailStyle) {
    setSaving(true);
    setError("");
    try {
      await onSave(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the style");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cloud-style">
      <div className="cloud-style-standard">
        <div>
          <strong>Standard look</strong>
          <small>Arial 14 px, near-black text, normal spacing, bold only where you wrote it. Signature in the same font.</small>
        </div>
        <button
          type="button"
          className={isStandard && !dirty ? "btn-soft" : "btn-dark"}
          disabled={locked || (isStandard && !dirty)}
          onClick={() => {
            setStyle(CLOUD_STANDARD_STYLE);
            void save(CLOUD_STANDARD_STYLE);
          }}
        >
          {isStandard && !dirty ? "Using standard" : "Use standard"}
        </button>
      </div>

      <div className="cloud-style-grid">
        <label>
          <span>Font</span>
          <select value={style.fontFamily} disabled={locked} onChange={(e) => set("fontFamily", e.target.value)}>
            {CLOUD_FONT_OPTIONS.map((font) => (
              <option key={font.value} value={font.value} style={{ fontFamily: font.value }}>
                {font.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Size</span>
          <select value={style.fontSize} disabled={locked} onChange={(e) => set("fontSize", Number(e.target.value))}>
            {SIZES.map((size) => (
              <option key={size} value={size}>
                {size} px{size === 14 ? " (standard)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Line spacing</span>
          <select value={style.lineHeight} disabled={locked} onChange={(e) => set("lineHeight", Number(e.target.value))}>
            {SPACING.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="cloud-style-color">
          <span>Text colour</span>
          <div>
            {TEXT_COLORS.map((item) => (
              <button
                key={item.value}
                type="button"
                title={item.label}
                aria-label={item.label}
                className={style.color.toLowerCase() === item.value ? "is-on" : ""}
                style={{ background: item.value }}
                disabled={locked}
                onClick={() => set("color", item.value)}
              />
            ))}
            <input
              type="color"
              value={style.color.length === 7 ? style.color : "#222222"}
              disabled={locked}
              aria-label="Custom text colour"
              onChange={(e) => set("color", e.target.value)}
            />
          </div>
        </div>
        <div className="cloud-style-color">
          <span>Link colour</span>
          <div>
            {LINK_COLORS.map((item) => (
              <button
                key={item.value}
                type="button"
                title={item.label}
                aria-label={item.label}
                className={style.linkColor.toLowerCase() === item.value ? "is-on" : ""}
                style={{ background: item.value }}
                disabled={locked}
                onClick={() => set("linkColor", item.value)}
              />
            ))}
            <input
              type="color"
              value={style.linkColor.length === 7 ? style.linkColor : "#1a5fd0"}
              disabled={locked}
              aria-label="Custom link colour"
              onChange={(e) => set("linkColor", e.target.value)}
            />
          </div>
        </div>
        <label className="cloud-style-check">
          <input
            type="checkbox"
            checked={style.signatureFont}
            disabled={locked}
            onChange={(e) => set("signatureFont", e.target.checked)}
          />
          Use this font in the signature too
        </label>
      </div>

      <div className="cloud-style-bold" role="radiogroup" aria-label="Bold text">
        <span>Bold text</span>
        <div>
          {BOLD.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={style.bold === item.value}
              className={style.bold === item.value ? "is-on" : ""}
              title={item.hint}
              disabled={locked}
              onClick={() => set("bold", item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <small>{BOLD.find((item) => item.value === style.bold)?.hint}</small>
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
              <dd>{preview.subject || "—"}</dd>
            </div>
          </dl>
          <iframe
            title="Email style preview"
            sandbox=""
            srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:12px">${preview.html}</body>`}
          />
        </div>
      ) : (
        <p className="cloud-muted">Add people (step 4) to preview the first email here.</p>
      )}

      {error ? <p className="cloud-map-problems">{error}</p> : null}
      <div className="cloud-step-actions">
        <button type="button" className="btn-dark" disabled={locked || !dirty} onClick={() => void save(style)}>
          {saving ? "Saving…" : "Save style"}
        </button>
        {!dirty ? <small className="cloud-muted">Saved · applies to the pitch and follow-ups</small> : null}
      </div>
    </div>
  );
}
