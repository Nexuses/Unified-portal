const ALLOWED_TAGS = new Set(["b", "strong", "br", "p", "div"]);

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

export function sanitizeInviteMessageHtml(input: string): string {
  return stripDisallowedTags(input)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .trim();
}

export function inviteMessageHtmlToPlainText(html: string): string {
  const withBreaks = String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return withBreaks
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isInviteMessageHtmlEmpty(html: string) {
  const sanitized = sanitizeInviteMessageHtml(html);
  if (!sanitized) {
    return true;
  }
  const plain = inviteMessageHtmlToPlainText(sanitized);
  return plain.length === 0;
}
