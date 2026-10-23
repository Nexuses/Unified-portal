import JSZip from "jszip";
import sharp from "sharp";

const MAX_IMAGE_EDGE = 2560;
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 80;

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "avif"]);
/** Formats that rarely shrink further — upload as-is. */
const SKIP_ZIP_EXT = new Set([
  "zip",
  "gz",
  "tgz",
  "rar",
  "7z",
  "bz2",
  "xz",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "mp4",
  "mov",
  "webm",
  "m4v",
  "mp3",
  "aac",
  "ogg",
  "wasm",
  "woff",
  "woff2",
  "pdf",
]);

export type CompressUploadInput = {
  name: string;
  type: string;
  bytes: Buffer;
};

export type CompressUploadResult = CompressUploadInput & {
  compressed: boolean;
  originalBytes: number;
};

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function stemOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function withExtension(name: string, ext: string) {
  return `${stemOf(name)}.${ext}`;
}

async function compressImage(input: CompressUploadInput): Promise<CompressUploadResult | null> {
  const ext = extensionOf(input.name);
  if (!IMAGE_EXT.has(ext)) {
    return null;
  }

  try {
    const image = sharp(input.bytes, { failOn: "none", animated: false }).rotate();
    const meta = await image.metadata();
    const pipeline = image.resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    });

    let out: Buffer;
    let name = input.name;
    let type = input.type;

    if (ext === "png" && meta.hasAlpha) {
      out = await pipeline.png({ compressionLevel: 9, effort: 8 }).toBuffer();
      type = "image/png";
    } else if (ext === "webp") {
      out = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
      type = "image/webp";
    } else if (ext === "png" || ext === "bmp" || ext === "tif" || ext === "tiff" || ext === "avif") {
      out = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
      name = withExtension(input.name, "jpg");
      type = "image/jpeg";
    } else {
      out = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
      name = withExtension(input.name, ext === "jpeg" ? "jpeg" : "jpg");
      type = "image/jpeg";
    }

    if (out.length >= input.bytes.length) {
      return {
        ...input,
        compressed: false,
        originalBytes: input.bytes.length,
      };
    }

    return {
      name,
      type,
      bytes: out,
      compressed: true,
      originalBytes: input.bytes.length,
    };
  } catch {
    return null;
  }
}

async function compressAsZip(input: CompressUploadInput): Promise<CompressUploadResult | null> {
  const ext = extensionOf(input.name);
  if (SKIP_ZIP_EXT.has(ext) || IMAGE_EXT.has(ext)) {
    return null;
  }

  try {
    const zip = new JSZip();
    zip.file(input.name, input.bytes);
    const out = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    if (out.length >= input.bytes.length) {
      return null;
    }
    return {
      name: withExtension(input.name, "zip"),
      type: "application/zip",
      bytes: Buffer.from(out),
      compressed: true,
      originalBytes: input.bytes.length,
    };
  } catch {
    return null;
  }
}

/** Shrink upload bytes when possible (images via sharp; other files via zip). */
export async function compressFileForUpload(
  input: CompressUploadInput,
): Promise<CompressUploadResult> {
  const originalBytes = input.bytes.length;
  const asImage = await compressImage(input);
  if (asImage?.compressed) {
    return asImage;
  }
  const asZip = await compressAsZip(input);
  if (asZip?.compressed) {
    return asZip;
  }
  return {
    ...input,
    compressed: false,
    originalBytes,
  };
}
