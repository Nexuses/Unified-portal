import { loadKnowledgeMarkdown } from "@/lib/knowledge-base-server";
import { readLogoBrand } from "@/lib/logo-brand";

function expandHex(value: string) {
  const hex = value.toLowerCase();
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

function isGray(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b) < 18;
}

function topColors(html: string) {
  const found = [
    ...html.matchAll(
      /(?:theme-color"\s+content="|#)([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g,
    ),
  ].map((match) => expandHex(`#${match[1]}`));
  const counts = new Map<string, number>();
  for (const color of found) {
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color);
  const chromatic = ranked.filter((color) => !isGray(color)).slice(0, 6);
  const neutrals = ranked.filter((color) => isGray(color)).slice(0, 2);
  return [...chromatic, ...neutrals];
}

export type KnowledgeBrand = {
  /** Prompt text: logo colors, then the knowledge-base documents. */
  text: string;
  colors: string[];
  logoUrl: string;
  /** PNG of the client logo, for placing on a generated post. */
  logoDataUrl: string;
};

export async function loadKnowledgeBrand(projectId: string, logoUrl = ""): Promise<KnowledgeBrand> {
  const [markdown, logo] = await Promise.all([
    loadKnowledgeMarkdown(projectId, 9000),
    readLogoBrand(logoUrl),
  ]);
  const colors = logo.colors.length > 0 ? logo.colors : topColors(markdown);
  const text = [
    logoUrl ? `Client logo URL (use this exact img src, do not redraw the logo): ${logoUrl}` : "",
    colors.length
      ? `Brand colors taken from the client logo. Use these exact hex values for backgrounds, buttons, links, and accents: ${colors.join(", ")}.`
      : "",
    markdown,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { text, colors, logoUrl, logoDataUrl: logo.pngDataUrl };
}
