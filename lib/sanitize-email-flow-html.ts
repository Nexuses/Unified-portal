const ALLOWED_TAGS = new Set([
  "b",
  "strong",
  "br",
  "p",
  "div",
  "h2",
  "ul",
  "ol",
  "li",
  "a",
]);

function stripDisallowedTags(html: string) {
  return String(html ?? "").replace(/<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi, (match, tagName) => {
    const tag = String(tagName ?? "").toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      return "";
    }
    if (tag === "br") {
      return "<br>";
    }
    return match.startsWith("</") ? `</${tag}>` : `<${tag}>`;
  });
}

function sanitizeAnchorHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
    return trimmed.replace(/"/g, "&quot;");
  }
  return null;
}

function sanitizeAnchorTags(html: string) {
  return html.replace(/<a\s+([^>]*)>/gi, (_match, attrs: string) => {
    const hrefMatch = attrs.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "") : "";
    const safeHref = sanitizeAnchorHref(href);
    return safeHref ? `<a href="${safeHref}">` : "<a>";
  });
}

/** Sanitize email flow message HTML without pulling in jsdom on the server. */
export function sanitizeEmailFlowHtml(input: string): string {
  return sanitizeAnchorTags(stripDisallowedTags(input))
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .trim();
}
