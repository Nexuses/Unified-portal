/**
 * Deterministic HTML cleanups for deliverability content findings.
 * Used after AI rewrite so issues like missing alt always get fixed.
 */

function altFromSrc(src: string) {
  try {
    const path = src.split("?")[0] ?? src;
    const file = path.split("/").pop() ?? "";
    const base = file.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
    if (base && base.length >= 2 && base.length <= 60) {
      return base;
    }
  } catch {
    // ignore
  }
  return "";
}

function readAttr(tag: string, name: string) {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
  );
  return match?.[2]?.trim() ?? "";
}

/**
 * Ensure every <img> has a non-empty alt attribute.
 * Empty alt="" and missing alt are both treated as missing.
 */
export function ensureImageAltAttributes(html: string) {
  let index = 0;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    index += 1;
    const existing = readAttr(tag, "alt");
    if (existing) {
      return tag;
    }

    const title = readAttr(tag, "title");
    const src = readAttr(tag, "src");
    const fromSrc = src ? altFromSrc(src) : "";
    const alt =
      title ||
      fromSrc ||
      (src.toLowerCase().includes("logo") ? "Logo" : "") ||
      `Email image ${index}`;

    if (/\balt\s*=\s*(["'])[\s\S]*?\1/i.test(tag)) {
      return tag.replace(/\balt\s*=\s*(["'])[\s\S]*?\1/i, `alt="${alt}"`);
    }

    // Insert alt before the closing /> or >
    if (/\/>\s*$/.test(tag)) {
      return tag.replace(/\/>\s*$/, ` alt="${alt}" />`);
    }
    return tag.replace(/>\s*$/, ` alt="${alt}">`);
  });
}

export function stripDangerousEmailScripts(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/\shref\s*=\s*(["'])javascript:[^"']*\1/gi, ' href="#"');
}

export function applyDeterministicDeliverabilityFixes(html: string) {
  let next = html;
  next = stripDangerousEmailScripts(next);
  next = ensureImageAltAttributes(next);
  return next;
}

export function countMissingImageAlts(html: string) {
  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  return images.filter((tag) => !/\balt\s*=\s*["'][^"']+["']/i.test(tag)).length;
}
