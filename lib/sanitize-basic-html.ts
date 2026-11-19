/**
 * DOM-free sanitizer for rich-text output (editor + public pages).
 * Allowed: b, strong, i, em, br, p, div, span (font-size only), h2, h3, hr
 */

function validateFontSizeValue(raw: string): string | null {
  const t = raw.trim();
  const m = /^([\d.]+)\s*(px|em|rem|%)$/i.exec(t);
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  if (unit === "px") {
    if (n < 10 || n > 40) {
      return null;
    }
    return `${n}px`;
  }
  if (unit === "em" || unit === "rem") {
    if (n < 0.65 || n > 2.75) {
      return null;
    }
    return `${n}${unit}`;
  }
  if (unit === "%") {
    if (n < 70 || n > 200) {
      return null;
    }
    return `${n}%`;
  }
  return null;
}

/** Style attribute must be a single font-size declaration only. */
function sanitizeFontSizeOnlyStyleBody(styleBody: string): string | null {
  const parts = styleBody
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length !== 1) {
    return null;
  }
  const m = /^font-size\s*:\s*(.+)$/i.exec(parts[0]);
  if (!m) {
    return null;
  }
  return validateFontSizeValue(m[1].trim());
}

function sanitizeSpanOpenTag(fullTag: string): string {
  const inner = /^<span(\s[^>]*)?>$/i.exec(fullTag);
  if (!inner) {
    return "<span>";
  }
  const attrs = inner[1] ?? "";
  const styleMatch = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i.exec(attrs);
  if (!styleMatch) {
    return "<span>";
  }
  const token = sanitizeFontSizeOnlyStyleBody(styleMatch[2]);
  if (!token) {
    return "<span>";
  }
  return `<span style="font-size:${token}">`;
}

export function sanitizeBasicHtml(input: string): string {
  const html = String(input ?? "");
  const withoutScripts = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");

  const allowOnly = withoutScripts.replace(
    /<(?!\/?(?:b|strong|i|em|br|p|div|span|h2|h3|hr)\b)[^>]*>/gi,
    ""
  );

  const withSpans = allowOnly.replace(/<span\b[^>]*>/gi, (tag) => sanitizeSpanOpenTag(tag));

  return withSpans
    .replace(/<(b|strong|i|em|p|div|h2|h3)\b[^>]*>/gi, "<$1>")
    .replace(/<br\b[^>]*>/gi, "<br>")
    .replace(/<hr\b[^>]*>/gi, "<hr>");
}
