import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import {
  CONTACT_ATTRIBUTE_LABELS,
  formatCompanyDate,
  formatListDate,
  resolveContactPhotoUrl,
  type ContactDetail,
} from "@/lib/crm";
import {
  getLeadStatusLabel,
  normalizeLeadStatus,
  type LeadStatus,
} from "@/lib/lead-status";

/** Same-origin proxy so PDF capture is not blocked by CDN CORS. */
const NEXUSES_LOGO_SRC = "/api/brand/nexuses-logo";

const STAGE_BADGE: Record<
  LeadStatus,
  { bg: string; color: string; border: string }
> = {
  hot: { bg: "#fef2f2", color: "#dc2626", border: "#fecaca" },
  warm: { bg: "#fff7ed", color: "#ea580c", border: "#ffedd5" },
  meeting_scheduled: { bg: "#eff6ff", color: "#2563eb", border: "#bfdbfe" },
  meeting_rescheduled: { bg: "#fffbeb", color: "#d97706", border: "#fde68a" },
  meeting_done: { bg: "#ecfdf5", color: "#059669", border: "#a7f3d0" },
  contact_later: { bg: "#f5f3ff", color: "#7c3aed", border: "#ddd6fe" },
  client_manage: { bg: "#f0f9ff", color: "#0284c7", border: "#bae6fd" },
  client_unavailable: { bg: "#f8fafc", color: "#64748b", border: "#e2e8f0" },
  client_rejected: { bg: "#fdf2f8", color: "#db2777", border: "#fbcfe8" },
  lost: { bg: "#f3f4f6", color: "#4b5563", border: "#e5e7eb" },
};

function esc(value?: string | number | null) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dash(value?: string | number | null) {
  const text = String(value ?? "").trim();
  return text ? esc(text) : "—";
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return esc(parts[0].slice(0, 2).toUpperCase());
  return esc(`${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase());
}

function isYes(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "yes" || v === "1" || v === "y";
  }
  return false;
}

function shortenText(value: string, max = 220) {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > 100 ? cut.slice(0, at) : cut).trim()}…`;
}

function scoreParts(profile: ContactDetail["profile"]) {
  const overall = profile?.qualification?.overallScore;
  const raw =
    overall != null && Number.isFinite(Number(overall))
      ? Number(overall)
      : profile?.score != null
        ? Number(profile.score)
        : null;
  if (raw == null || !Number.isFinite(raw) || raw <= 0) {
    return { label: "—", stars: 0 };
  }
  if (raw <= 5) {
    const stars = Math.max(0, Math.min(5, Math.round(raw)));
    return { label: `${stars} / 5`, stars };
  }
  const stars = Math.max(0, Math.min(5, Math.round(raw / 20)));
  return { label: `${Math.round(raw)} / 100`, stars };
}

function yn(value: boolean) {
  return value
    ? `<span class="pill yes">Yes</span>`
    : `<span class="pill no">No</span>`;
}

function kv(label: string, value?: string | number | null) {
  return `<div class="kv"><div class="k">${esc(label)}</div><div class="v">${dash(value)}</div></div>`;
}

function section(title: string, body: string) {
  if (!body.trim()) return "";
  return `<section class="card"><h2>${esc(title)}</h2>${body}</section>`;
}

function starsHtml(count: number) {
  return `<div class="stars" aria-hidden="true">${Array.from(
    { length: 5 },
    (_, i) => `<span class="${i < count ? "on" : ""}">★</span>`,
  ).join("")}</div>`;
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const href = url.trim();
    if (!href) return null;
    if (href.startsWith("data:image/")) return href;
    const response = await fetch(href, { cache: "no-store" });
    if (!response.ok) return null;
    const blob = await response.blob();
    const type = blob.type || response.headers.get("content-type") || "";
    if (
      type &&
      !type.startsWith("image/") &&
      !type.includes("octet-stream") &&
      !type.includes("svg")
    ) {
      return null;
    }
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function buildReportHtml(
  contact: ContactDetail,
  photoDataUrl: string | null,
  nexusesLogoDataUrl: string | null,
) {
  const profile = contact.profile || {};
  const fullName =
    `${contact.firstName || ""} ${contact.lastName || ""}`.trim() ||
    contact.fullName ||
    contact.email ||
    "Contact";
  const stageKey = normalizeLeadStatus(profile.leadStage);
  const stage = getLeadStatusLabel(stageKey);
  const stageTone = STAGE_BADGE[stageKey];
  const score = scoreParts(profile);
  const generated = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const nexusesLogo = nexusesLogoDataUrl
    ? `<img class="brand-logo nexuses" src="${nexusesLogoDataUrl}" alt="Nexuses" />`
    : `<span class="brand-wordmark">Nexuses</span>`;

  const avatar = photoDataUrl
    ? `<img class="avatar" src="${photoDataUrl}" alt="" />`
    : `<div class="avatar fallback">${initialsOf(fullName)}</div>`;

  const qual = profile.qualification || {};
  const qualRows = [
    ["Decision maker", isYes(qual.decisionMaker)],
    ["Viewed solution deck", isYes(qual.viewedDeck)],
    ["Have budget", isYes(qual.haveBudget)],
    ["Need", isYes(qual.need)],
  ]
    .map(
      ([label, yes]) =>
        `<div class="qual-row"><span>${esc(String(label))}</span>${yn(Boolean(yes))}</div>`,
    )
    .join("");

  const stats = contact.campaignStats;
  const metrics = stats
    ? `
      <div class="metrics">
        <div class="metric"><span>Sent</span><strong>${esc(stats.sent)}</strong></div>
        <div class="metric"><span>Delivered</span><strong>${esc(stats.delivered)}</strong></div>
        <div class="metric"><span>Opens</span><strong>${esc(stats.opens)}</strong></div>
        <div class="metric"><span>Clicks</span><strong>${esc(stats.clicks)}</strong></div>
      </div>`
    : "";

  const notes = (profile.notes || [])
    .map(
      (note) => `
      <div class="note">
        <div class="note-meta">${dash(formatCompanyDate(note.at))}</div>
        <div class="note-body">${dash(note.body)}</div>
      </div>`,
    )
    .join("");

  const timelineNotes = (profile.timeline || [])
    .map(
      (item) => `
      <div class="note">
        <div class="note-meta">${item.at ? dash(formatListDate(item.at)) : "Note"}</div>
        <div class="note-body">${dash(item.body)}</div>
      </div>`,
    )
    .join("");

  const history = (contact.history || [])
    .slice(0, 40)
    .map((event) => {
      const when = event.at ? formatListDate(event.at) : "";
      const kind = String(event.type || "activity").replace(/_/g, " ");
      const title = String(event.title || "").trim();
      const description = String(event.description || "").trim();
      return `
        <div class="tl-item">
          <div class="tl-rail" aria-hidden="true">
            <div class="tl-dot"></div>
          </div>
          <div class="tl-card">
            <div class="tl-top">
              <span class="tl-kind">${esc(kind)}</span>
              <span class="tl-when">${dash(when)}</span>
            </div>
            ${title ? `<div class="tl-title">${esc(title)}</div>` : ""}
            ${
              description
                ? `<div class="tl-body">${esc(description)}</div>`
                : ""
            }
          </div>
        </div>`;
    })
    .join("");

  const attributes = Object.entries(contact.attributes || {})
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => kv(CONTACT_ATTRIBUTE_LABELS[key] ?? key, value))
    .join("");

  const lists = (contact.lists || [])
    .map((list) => {
      const id = list.displayId ? `#${list.displayId}` : "";
      const name = list.name || "List";
      return `<div class="list-chip"><span class="list-id">${esc(id || "List")}</span><span class="list-name">${esc(name)}</span></div>`;
    })
    .join("");

  const companyDescription = profile.company?.description?.trim()
    ? shortenText(profile.company.description, 220)
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  /* Arial + no ligatures/letter-spacing: html2canvas otherwise garbles pill text. */
  html, body {
    margin: 0;
    padding: 0;
    background: #f5f5f7;
    color: #111827;
    color-scheme: light;
    font-family: Arial, Helvetica, sans-serif;
    font-variant: normal;
    font-feature-settings: "liga" 0, "clig" 0;
    font-variant-ligatures: none;
    letter-spacing: 0.01px;
    -webkit-font-smoothing: auto;
  }
  *, *::before, *::after {
    box-sizing: border-box;
    font-family: inherit;
    font-variant: normal !important;
    font-feature-settings: "liga" 0, "clig" 0 !important;
    font-variant-ligatures: none !important;
  }
  .page {
    width: 794px;
    padding: 28px 28px 36px;
    background: #f5f5f7;
    color: #111827;
    letter-spacing: 0.01px;
  }
  .brand-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
    padding: 12px 14px;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
  }
  .brand-pair {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }
  .brand-divider {
    width: 1px;
    height: 28px;
    background: #e5e7eb;
    flex: 0 0 auto;
  }
  .brand-logo {
    height: 28px;
    width: auto;
    max-width: 160px;
    display: block;
    object-fit: contain;
  }
  .brand-logo.project {
    height: 32px;
    max-width: 140px;
  }
  .brand-wordmark {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
  }
  .brand-client-fallback {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: #eff6ff;
    color: #1d4ed8;
    display: grid;
    place-items: center;
    font-size: 14px;
    font-weight: 700;
    border: 1px solid #bfdbfe;
  }
  .brand-tag {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: #9ca3af;
  }
  .hero {
    display: flex;
    gap: 18px;
    align-items: center;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 18px;
    padding: 20px 22px;
    margin-bottom: 16px;
    box-shadow: 0 1px 2px rgba(16,24,40,.04);
  }
  .avatar {
    width: 72px;
    height: 72px;
    border-radius: 999px;
    object-fit: cover;
    border: 3px solid #0071E3;
    flex: 0 0 auto;
    background: #dbeafe;
  }
  .avatar.fallback {
    display: grid;
    place-items: center;
    color: #1d4ed8;
    font-weight: 700;
    font-size: 22px;
  }
  .hero-copy { min-width: 0; flex: 1; }
  .eyebrow {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: #0071E3;
  }
  .hero h1 {
    margin: 0;
    font-size: 26px;
    line-height: 1.2;
    font-weight: 700;
    color: #111827;
  }
  .hero .sub {
    margin: 6px 0 0;
    font-size: 14px;
    color: #6b7280;
    font-weight: 600;
  }
  .hero-side { text-align: right; flex: 0 0 auto; }
  .stage {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 28px;
    padding: 0 14px 1px;
    border-radius: 999px;
    background: ${stageTone.bg};
    color: ${stageTone.color};
    font-size: 13px;
    font-weight: 700;
    line-height: 13px;
    border: 1px solid ${stageTone.border};
    letter-spacing: 0.01px;
    white-space: nowrap;
    box-sizing: border-box;
  }
  .generated {
    margin-top: 8px;
    font-size: 11px;
    color: #9ca3af;
    font-weight: 600;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    padding: 16px 16px 14px;
    box-shadow: 0 1px 2px rgba(16,24,40,.03);
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .card.full { grid-column: 1 / -1; }
  .card h2 {
    margin: 0 0 12px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    color: #6b7280;
  }
  .kv-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 14px;
  }
  .kv .k {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: #9ca3af;
    margin-bottom: 3px;
  }
  .kv .v {
    font-size: 13.5px;
    font-weight: 600;
    color: #111827;
    line-height: 1.35;
    word-break: break-word;
  }
  .qual-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid #f3f4f6;
    font-size: 13.5px;
    font-weight: 600;
    color: #111827;
  }
  .qual-row:last-child { border-bottom: 0; padding-bottom: 0; }
  .qual-row:first-child { padding-top: 0; }
  .pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    height: 24px;
    padding: 0 12px 1px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    line-height: 12px;
    text-align: center;
    letter-spacing: 0.01px;
    white-space: nowrap;
    box-sizing: border-box;
  }
  .pill.yes { background: #dcfce7; color: #15803d; }
  .pill.no { background: #f3f4f6; color: #6b7280; }
  .score-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
    padding: 12px;
    border-radius: 12px;
    background: #f8fafc;
    border: 1px solid #eef2f7;
  }
  .score-row .label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: #6b7280;
  }
  .stars { display: flex; gap: 3px; font-size: 16px; line-height: 1; color: #d1d5db; }
  .stars .on { color: #f59e0b; }
  .score-value { font-size: 18px; font-weight: 700; color: #111827; }
  .prose {
    font-size: 13.5px;
    line-height: 1.55;
    color: #374151;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .prose + .prose { margin-top: 10px; }
  .prose-label {
    margin: 0 0 4px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: #9ca3af;
  }
  .metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .metric {
    background: #f8fafc;
    border: 1px solid #eef2f7;
    border-radius: 12px;
    padding: 12px;
  }
  .metric span {
    display: block;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: #9ca3af;
    margin-bottom: 4px;
  }
  .metric strong {
    font-size: 20px;
    font-weight: 700;
    color: #111827;
  }
  .note {
    padding: 10px 12px;
    border-radius: 12px;
    background: #f8fafc;
    border: 1px solid #eef2f7;
    margin-bottom: 8px;
  }
  .note:last-child { margin-bottom: 0; }
  .note-meta {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: #9ca3af;
    margin-bottom: 4px;
  }
  .note-body {
    font-size: 13px;
    line-height: 1.45;
    color: #374151;
    white-space: pre-wrap;
  }
  .tl {
    display: flex;
    flex-direction: column;
    gap: 0;
    position: relative;
  }
  .tl-item {
    display: flex;
    gap: 12px;
    position: relative;
    padding: 0 0 12px;
  }
  .tl-item:last-child { padding-bottom: 0; }
  .tl-rail {
    width: 16px;
    flex: 0 0 auto;
    position: relative;
    display: flex;
    justify-content: center;
  }
  .tl-rail::before {
    content: "";
    position: absolute;
    top: 10px;
    bottom: -12px;
    left: 50%;
    width: 2px;
    transform: translateX(-50%);
    background: linear-gradient(180deg, #93c5fd 0%, #e5e7eb 100%);
  }
  .tl-item:last-child .tl-rail::before { display: none; }
  .tl-dot {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    background: #0071E3;
    margin-top: 6px;
    flex: 0 0 auto;
    box-shadow: 0 0 0 3px #dbeafe;
    position: relative;
    z-index: 1;
  }
  .tl-card {
    min-width: 0;
    flex: 1;
    background: #f8fafc;
    border: 1px solid #eef2f7;
    border-radius: 12px;
    padding: 10px 12px;
  }
  .tl-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 4px;
  }
  .tl-kind {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 20px;
    padding: 0 8px 1px;
    border-radius: 999px;
    background: #eff6ff;
    color: #1d4ed8;
    font-size: 10px;
    font-weight: 700;
    line-height: 10px;
    text-transform: uppercase;
    letter-spacing: 0.01px;
    white-space: nowrap;
    box-sizing: border-box;
  }
  .tl-when {
    font-size: 10px;
    font-weight: 700;
    color: #9ca3af;
    white-space: nowrap;
  }
  .tl-title {
    font-size: 13.5px;
    font-weight: 700;
    color: #111827;
    line-height: 1.35;
    margin-bottom: 2px;
  }
  .tl-body {
    font-size: 12.5px;
    line-height: 1.45;
    color: #4b5563;
  }
  .lists {
    display: flex;
    flex-direction: column;
    flex-wrap: nowrap;
    gap: 8px;
  }
  .list-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    padding: 7px 10px;
    border-radius: 12px;
    background: #f8fafc;
    border: 1px solid #e5e7eb;
  }
  .list-id {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    box-sizing: border-box;
    font-size: 11px;
    font-weight: 700;
    color: #1d4ed8;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 999px;
    padding: 0 9px 1px;
    line-height: 11px;
    letter-spacing: 0.01px;
    white-space: nowrap;
    vertical-align: middle;
  }
  .list-name {
    font-size: 13px;
    font-weight: 600;
    color: #111827;
    line-height: 22px;
    word-break: break-word;
    display: flex;
    align-items: center;
  }
  .footer {
    margin-top: 18px;
    padding: 12px 14px;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    background: #fff;
    font-size: 11px;
    color: #6b7280;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .footer-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .footer-logo {
    height: 20px;
    width: auto;
    max-width: 120px;
    display: block;
    object-fit: contain;
  }
  .footer-logo.project {
    height: 22px;
    max-width: 100px;
  }
  .footer-divider {
    width: 1px;
    height: 18px;
    background: #e5e7eb;
    flex: 0 0 auto;
  }
  .footer-meta {
    color: #9ca3af;
    white-space: nowrap;
  }
</style>
</head>
<body>
  <div class="page">
    <div class="brand-bar">
      ${nexusesLogo}
      <span class="brand-tag">Lead report</span>
    </div>

    <header class="hero">
      ${avatar}
      <div class="hero-copy">
        <p class="eyebrow">Lead report</p>
        <h1>${esc(fullName)}</h1>
        <p class="sub">${dash(
          [profile.title, contact.companyName].filter(Boolean).join(" · "),
        )}</p>
      </div>
      <div class="hero-side">
        <div class="stage">${esc(stage)}</div>
        <div class="generated">${esc(generated)}</div>
      </div>
    </header>

    <div class="grid">
      ${section(
        "Contact details",
        `<div class="kv-grid">
          ${kv("Email", contact.email)}
          ${kv("Phone", profile.phone)}
          ${kv("LinkedIn", profile.linkedinUrl)}
          ${kv("Location", profile.location)}
          ${kv("Source", "Nexuses")}
          ${kv("Owner", contact.owner)}
        </div>`,
      )}

      ${section(
        "Lead qualification",
        `${qualRows}
         <div class="score-row">
           <div>
             <div class="label">Overall score</div>
             ${starsHtml(score.stars)}
           </div>
           <div class="score-value">${esc(score.label)}</div>
         </div>`,
      )}

      ${section(
        "Company",
        `<div class="kv-grid">
          ${kv("Company", contact.companyName)}
          ${kv("Industry", profile.company?.industry)}
          ${kv("Employees", profile.company?.employees)}
          ${kv("Location", profile.company?.location)}
          ${kv("Website", profile.company?.website)}
          ${kv("LinkedIn", profile.company?.linkedinUrl)}
        </div>
        ${
          companyDescription
            ? `<div style="margin-top:12px"><div class="prose-label">Description</div><div class="prose">${esc(companyDescription)}</div></div>`
            : ""
        }`,
      )}

      ${
        profile.about?.trim() || profile.news?.trim()
          ? section(
              "About",
              `${
                profile.about?.trim()
                  ? `<div class="prose-label">About contact</div><div class="prose">${dash(shortenText(profile.about, 320))}</div>`
                  : ""
              }${
                profile.news?.trim()
                  ? `<div class="prose-label" style="margin-top:10px">Company news</div><div class="prose">${dash(shortenText(profile.news, 280))}</div>`
                  : ""
              }`,
            )
          : ""
      }

      ${
        profile.meeting?.at || profile.meeting?.title || profile.meeting?.joinUrl
          ? section(
              "Meeting",
              `<div class="kv-grid">
                ${kv("When", profile.meeting?.at ? formatCompanyDate(profile.meeting.at) : "")}
                ${kv("Timezone", profile.meeting?.timezone)}
                ${kv("Channel", profile.meeting?.channel)}
                ${kv("Title", profile.meeting?.title)}
                ${kv("Join URL", profile.meeting?.joinUrl)}
              </div>`,
            )
          : ""
      }

      ${
        profile.brief?.problem || profile.brief?.objective || profile.brief?.stakes
          ? section(
              "Strategic brief",
              `${profile.brief?.stakes ? kv("Stakes", profile.brief.stakes) : ""}
               ${
                 profile.brief?.problem
                   ? `<div class="prose-label">Problem / pitch</div><div class="prose">${dash(shortenText(profile.brief.problem, 280))}</div>`
                   : ""
               }
               ${
                 profile.brief?.objective
                   ? `<div class="prose-label" style="margin-top:10px">Primary objective</div><div class="prose">${dash(shortenText(profile.brief.objective, 220))}</div>`
                   : ""
               }`,
            )
          : ""
      }

      ${stats ? section("Email campaigns", metrics) : ""}

      ${notes ? `<div class="card full"><h2>Internal notes</h2>${notes}</div>` : ""}
      ${timelineNotes ? `<div class="card full"><h2>Timeline notes</h2>${timelineNotes}</div>` : ""}
      ${history ? `<div class="card full"><h2>Engagement timeline</h2><div class="tl">${history}</div></div>` : ""}
      ${attributes ? `<div class="card full"><h2>Information</h2><div class="kv-grid">${attributes}</div></div>` : ""}
      ${lists ? `<div class="card full"><h2>Lists</h2><div class="lists">${lists}</div></div>` : ""}
    </div>
  </div>
</body>
</html>`;
}

function imageNaturalSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        w: img.naturalWidth || 120,
        h: img.naturalHeight || 32,
      });
    img.onerror = () => resolve({ w: 120, h: 32 });
    img.src = dataUrl;
  });
}

function waitFrames(count = 2) {
  return new Promise<void>((resolve) => {
    const step = (left: number) => {
      if (left <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(left - 1));
    };
    step(count);
  });
}

export async function downloadLeadReportPdf(
  contact: ContactDetail,
  options?: {
    photoSrc?: string;
    fileName?: string;
    projectLogoSrc?: string;
    projectName?: string;
    nexusesLogoSrc?: string;
  },
) {
  const profile = contact.profile || {};
  const fullName =
    `${contact.firstName || ""} ${contact.lastName || ""}`.trim() ||
    contact.fullName ||
    contact.email ||
    "lead";

  const photoSrc =
    options?.photoSrc || resolveContactPhotoUrl(profile) || "";
  const nexusesLogoSrc = options?.nexusesLogoSrc || NEXUSES_LOGO_SRC;
  const projectLogoSrc = options?.projectLogoSrc?.trim() || "";
  const [photoDataUrl, nexusesLogoDataUrl, projectLogoDataUrl] =
    await Promise.all([
      photoSrc ? toDataUrl(photoSrc) : Promise.resolve(null),
      toDataUrl(nexusesLogoSrc),
      projectLogoSrc ? toDataUrl(projectLogoSrc) : Promise.resolve(null),
    ]);

  const BG = "#f5f5f7";
  // Render in an iframe so styles and layout get a real document viewport
  // (off-screen divs often yield a 0×0 html2canvas result).
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("title", "Lead report PDF render");
  iframe.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:794px",
    "height:1200px",
    "border:0",
    "opacity:0.01",
    "pointer-events:none",
    "z-index:2147483646",
    `background:${BG}`,
  ].join(";");
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument;
  const iframeWin = iframe.contentWindow;
  if (!iframeDoc || !iframeWin) {
    iframe.remove();
    throw new Error("Failed to open PDF render frame");
  }

  iframeDoc.open();
  iframeDoc.write(buildReportHtml(contact, photoDataUrl, nexusesLogoDataUrl));
  iframeDoc.close();

  try {
    await new Promise<void>((resolve) => {
      if (iframeDoc.readyState === "complete") {
        resolve();
        return;
      }
      iframe.onload = () => resolve();
      window.setTimeout(() => resolve(), 500);
    });

    const images = Array.from(iframeDoc.images || []);
    await Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              resolve();
              return;
            }
            img.onload = () => resolve();
            img.onerror = () => resolve();
            window.setTimeout(() => resolve(), 1500);
          }),
      ),
    );
    await waitFrames(3);

    const page = iframeDoc.querySelector(".page") as HTMLElement | null;
    if (!page) throw new Error("Failed to build PDF layout");

    // Size iframe to full content height so capture isn't clipped to 0.
    const contentHeight = Math.max(
      page.scrollHeight,
      page.offsetHeight,
      iframeDoc.body.scrollHeight,
      400,
    );
    iframe.style.height = `${contentHeight + 40}px`;
    await waitFrames(2);

    const width = Math.max(page.scrollWidth, page.offsetWidth, 794);
    const height = Math.max(page.scrollHeight, page.offsetHeight, 1);
    if (!width || !height) {
      throw new Error("PDF layout has no size");
    }

    const canvas = await html2canvas(page, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: BG,
      logging: false,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
      scrollX: 0,
      scrollY: 0,
      foreignObjectRendering: false,
      onclone: (_doc, element) => {
        const root = element as HTMLElement;
        root.style.fontFamily = "Arial, Helvetica, sans-serif";
        root.style.letterSpacing = "0.01px";
        root.style.fontVariant = "normal";
        root.querySelectorAll<HTMLElement>("*").forEach((node) => {
          node.style.letterSpacing = "0.01px";
          node.style.fontVariant = "normal";
          node.style.fontFeatureSettings = '"liga" 0, "clig" 0';
        });
      },
    });

    if (!canvas.width || !canvas.height) {
      throw new Error("PDF capture produced an empty image");
    }

    // Flatten onto an opaque light canvas so JPEG never gets black transparency.
    const flat = document.createElement("canvas");
    flat.width = canvas.width;
    flat.height = canvas.height;
    const flatCtx = flat.getContext("2d");
    if (!flatCtx) throw new Error("Canvas unsupported");
    flatCtx.fillStyle = BG;
    flatCtx.fillRect(0, 0, flat.width, flat.height);
    flatCtx.drawImage(canvas, 0, 0);

    const imgW = 210;
    const pageH = 297;
    const footerH = 16;
    const contentH = pageH - footerH;
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const pageCanvas = document.createElement("canvas");
    const pageCtx = pageCanvas.getContext("2d");
    if (!pageCtx) throw new Error("Canvas unsupported");

    let footerLogo: {
      dataUrl: string;
      format: "PNG" | "JPEG";
      w: number;
      h: number;
    } | null = null;
    if (projectLogoDataUrl) {
      const natural = await imageNaturalSize(projectLogoDataUrl);
      const maxH = 7;
      const maxW = 48;
      const ratio = natural.w / Math.max(natural.h, 1);
      let h = maxH;
      let w = h * ratio;
      if (w > maxW) {
        w = maxW;
        h = w / ratio;
      }
      footerLogo = {
        dataUrl: projectLogoDataUrl,
        format: projectLogoDataUrl.includes("image/jpeg") ? "JPEG" : "PNG",
        w,
        h,
      };
    }

    const pxPerMm = flat.width / imgW;
    const fullPageHeightPx = Math.floor(pageH * pxPerMm);
    const lastPageHeightPx = Math.floor(contentH * pxPerMm);
    let rendered = 0;
    let pageIndex = 0;

    while (rendered < flat.height) {
      const remaining = flat.height - rendered;
      const fitsOnOnePage = remaining <= fullPageHeightPx;
      const maxSlice =
        fitsOnOnePage && footerLogo ? lastPageHeightPx : fullPageHeightPx;
      const sliceH = Math.min(maxSlice, remaining);
      const isLastPage = rendered + sliceH >= flat.height;

      pageCanvas.width = flat.width;
      pageCanvas.height = sliceH;
      pageCtx.fillStyle = BG;
      pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      pageCtx.drawImage(
        flat,
        0,
        rendered,
        flat.width,
        sliceH,
        0,
        0,
        flat.width,
        sliceH,
      );
      const sliceData = pageCanvas.toDataURL("image/jpeg", 0.95);
      const sliceMm = sliceH / pxPerMm;
      if (pageIndex > 0) pdf.addPage();
      pdf.addImage(sliceData, "JPEG", 0, 0, imgW, sliceMm);

      if (isLastPage && footerLogo) {
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, pageH - footerH, imgW, footerH, "F");
        pdf.setDrawColor(229, 231, 235);
        pdf.setLineWidth(0.2);
        pdf.line(8, pageH - footerH, imgW - 8, pageH - footerH);
        const x = 10;
        const y = pageH - footerH + (footerH - footerLogo.h) / 2;
        pdf.addImage(
          footerLogo.dataUrl,
          footerLogo.format,
          x,
          y,
          footerLogo.w,
          footerLogo.h,
        );
      }

      rendered += sliceH;
      pageIndex += 1;
    }

    const safeName = fullName.replace(/[^\w.-]+/g, "_").slice(0, 60) || "lead";
    pdf.save(options?.fileName || `${safeName}_lead_report.pdf`);
  } finally {
    iframe.remove();
  }
}
