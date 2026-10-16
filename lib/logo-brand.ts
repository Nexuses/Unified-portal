import sharp from "sharp";

export type LogoBrand = {
  colors: string[];
  pngDataUrl: string;
};

function hexByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function toHex(r: number, g: number, b: number) {
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
}

function isBackground(r: number, g: number, b: number, a: number) {
  if (a < 40) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max > 246 && max - min < 12;
}

function colorDistance(left: string, right: string) {
  const [r1, g1, b1] = [1, 3, 5].map((index) => Number.parseInt(left.slice(index, index + 2), 16));
  const [r2, g2, b2] = [1, 3, 5].map((index) => Number.parseInt(right.slice(index, index + 2), 16));
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/** Most common non-background colors in a logo, most used first. Near-duplicates collapse into one. */
function dominantColors(data: Buffer, channels: number) {
  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
  for (let index = 0; index + 3 < data.length; index += channels) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = channels > 3 ? data[index + 3] : 255;
    if (isBackground(r, g, b, a)) continue;
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()]
    .sort((left, right) => right.n - left.n)
    .map((bucket) => toHex(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n));
  const colors: string[] = [];
  for (const color of ranked) {
    if (colors.every((existing) => colorDistance(existing, color) > 80)) colors.push(color);
    if (colors.length === 4) break;
  }
  return colors;
}

/** Downloads the client logo and reads its brand colors. */
export async function readLogoBrand(logoUrl: string): Promise<LogoBrand> {
  const empty = { colors: [], pngDataUrl: "" };
  const url = logoUrl.trim();
  if (!/^https?:\/\//i.test(url)) return empty;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return empty;
    const input = Buffer.from(await response.arrayBuffer());
    if (input.length === 0 || input.length > 6_000_000) return empty;
    const png = await sharp(input, { density: 180, limitInputPixels: 20_000_000 })
      .resize(640, 640, { fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer();
    const sample = await sharp(png)
      .resize(48, 48, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      colors: dominantColors(sample.data, sample.info.channels),
      pngDataUrl: `data:image/png;base64,${png.toString("base64")}`,
    };
  } catch (error) {
    console.error("Failed to read logo brand:", error);
    return empty;
  }
}

/** Places the real logo on the top-left of a generated post. */
export async function stampLogo(image: string, logoPngDataUrl: string) {
  const source = image.trim();
  const logoBase64 = logoPngDataUrl.split(",")[1];
  if (!source || !logoBase64) return source;
  const base =
    source.startsWith("data:")
      ? Buffer.from(source.split(",")[1] ?? "", "base64")
      : Buffer.from(await (await fetch(source, { signal: AbortSignal.timeout(20_000) })).arrayBuffer());
  const logo = Buffer.from(logoBase64, "base64");
  const meta = await sharp(base).metadata();
  const width = meta.width || 1024;
  const logoWidth = Math.max(72, Math.round(width * 0.26));
  const pad = Math.max(16, Math.round(width * 0.045));
  const logoBuf = await sharp(logo)
    .resize(logoWidth, logoWidth, { fit: "inside" })
    .png()
    .toBuffer();
  const out = await sharp(base)
    .composite([{ input: logoBuf, top: pad, left: pad }])
    .png()
    .toBuffer();
  return `data:image/png;base64,${out.toString("base64")}`;
}
