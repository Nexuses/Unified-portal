import { loadKnowledgeMarkdown } from "@/lib/knowledge-base-server";

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

export async function loadKnowledgeBrand(projectId: string) {
  const markdown = await loadKnowledgeMarkdown(projectId, 9000);
  if (!markdown) return "";
  const colors = topColors(markdown);
  return [colors.length ? `Brand colors: ${colors.join(", ")}` : "", markdown]
    .filter(Boolean)
    .join("\n\n");
}
