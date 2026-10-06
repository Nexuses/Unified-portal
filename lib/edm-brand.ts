import { listEdmLinks } from "@/lib/edm-server";

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

async function readPage(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "NexusesEDM/1.0" },
    });
    if (!response.ok) return "";
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text")) return "";
    return (await response.text()).slice(0, 180_000);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function pageText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
}

export async function loadKnowledgeBrand(projectId: string) {
  const links = await listEdmLinks(projectId);
  const pages = await Promise.all(
    links.slice(0, 4).map(async (item) => {
      const html = await readPage(item.link);
      if (!html) {
        return `${item.name}: ${item.link}`;
      }
      const colors = topColors(html);
      return [
        `${item.name}: ${item.link}`,
        colors.length ? `Brand colors: ${colors.join(", ")}` : "",
        `Page copy: ${pageText(html)}`,
      ]
        .filter(Boolean)
        .join("\n");
    }),
  );
  return pages.join("\n\n");
}
