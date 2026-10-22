import {
  GetBucketLocationCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export type EdmBucket = {
  name: string;
  region: string;
};

function credentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "AWS credentials are not set. Add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.",
    );
  }
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN?.trim() || undefined,
  };
}

function s3(region: string) {
  return new S3Client({ region, credentials: credentials() });
}

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function regionOf(constraint: string | undefined) {
  if (!constraint) return "us-east-1";
  if (constraint === "EU") return "eu-west-1";
  return constraint;
}

export async function listProjectBuckets(projectName: string) {
  const token = compact(projectName);
  if (token.length < 3) return [];
  const listed = await s3(process.env.AWS_REGION?.trim() || "us-east-1").send(
    new ListBucketsCommand({}),
  );
  const names = (listed.Buckets ?? [])
    .map((bucket) => bucket.Name?.trim() || "")
    .filter((name) => name && compact(name).includes(token))
    .slice(0, 12);

  const buckets = await Promise.all(
    names.map(async (name) => {
      try {
        const location = await s3("us-east-1").send(
          new GetBucketLocationCommand({ Bucket: name }),
        );
        return { name, region: regionOf(location.LocationConstraint) };
      } catch {
        return { name, region: process.env.AWS_REGION?.trim() || "us-east-1" };
      }
    }),
  );
  return buckets.sort((a, b) => a.name.localeCompare(b.name));
}

function imageBytes(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const contentType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > 8_000_000) return null;
  const extension = contentType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  return { contentType, bytes, extension };
}

/** Upload a generated post image and return its public URL. */
export async function uploadDataImage(bucket: EdmBucket, dataUrl: string) {
  const image = imageBytes(dataUrl);
  if (!image) {
    throw new Error("That post image could not be uploaded.");
  }
  const key = `posts/${crypto.randomUUID()}.${image.extension}`;
  await s3(bucket.region).send(
    new PutObjectCommand({
      Bucket: bucket.name,
      Key: key,
      Body: image.bytes,
      ContentType: image.contentType,
    }),
  );
  return `https://${bucket.name}.s3.${bucket.region}.amazonaws.com/${key}`;
}

export type BucketFile = {
  key: string;
  name: string;
  size: number;
  updatedAt?: string;
  url: string;
  bucket?: string;
};

const MAX_LISTED_OBJECTS = 5000;

function mapBucketObject(
  bucket: EdmBucket,
  item: { Key?: string; Size?: number; LastModified?: Date },
): BucketFile | null {
  if (!item.Key || item.Key.endsWith("/")) {
    return null;
  }
  const key = item.Key;
  const name = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
  return {
    key,
    name,
    size: Number(item.Size) || 0,
    updatedAt: item.LastModified?.toISOString(),
    url: `https://${bucket.name}.s3.${bucket.region}.amazonaws.com/${key
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    bucket: bucket.name,
  };
}

function sortFilesNewestFirst(files: BucketFile[]) {
  return [...files].sort((a, b) => {
    const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const right = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return right - left;
  });
}

/** Recent objects in a project bucket (newest first). */
export async function listBucketFiles(bucket: EdmBucket, limit = 100) {
  const listed = await listAllFilesInBucket(bucket, limit);
  return listed.files;
}

/** Walk a bucket (capped) so we can paginate with a real total. */
export async function listAllFilesInBucket(
  bucket: EdmBucket,
  maxObjects = MAX_LISTED_OBJECTS,
) {
  const files: BucketFile[] = [];
  let token: string | undefined;
  let truncated = false;
  while (files.length < maxObjects) {
    const listed = await s3(bucket.region).send(
      new ListObjectsV2Command({
        Bucket: bucket.name,
        MaxKeys: Math.min(1000, maxObjects - files.length),
        ContinuationToken: token,
      }),
    );
    for (const item of listed.Contents ?? []) {
      const mapped = mapBucketObject(bucket, item);
      if (mapped) {
        files.push(mapped);
      }
      if (files.length >= maxObjects) {
        break;
      }
    }
    if (!listed.IsTruncated || !listed.NextContinuationToken) {
      token = undefined;
      break;
    }
    truncated = true;
    token = listed.NextContinuationToken;
  }
  if (token) {
    truncated = true;
  }
  return {
    files: sortFilesNewestFirst(files),
    truncated,
  };
}

export type FileTypeFilter =
  | "all"
  | "images"
  | "video"
  | "pdf"
  | "html"
  | "docs"
  | "other";

function extensionOfName(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function matchesFileTypeFilter(
  file: BucketFile,
  filter: FileTypeFilter,
) {
  if (filter === "all") {
    return true;
  }
  const ext = extensionOfName(file.name);
  if (filter === "images") {
    return ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"].includes(
      ext,
    );
  }
  if (filter === "video") {
    return ["mp4", "webm", "mov", "m4v", "avi", "mkv"].includes(ext);
  }
  if (filter === "pdf") {
    return ext === "pdf";
  }
  if (filter === "html") {
    return ["html", "htm"].includes(ext);
  }
  if (filter === "docs") {
    return ["doc", "docx", "txt", "md", "rtf", "csv", "xls", "xlsx", "ppt", "pptx"].includes(
      ext,
    );
  }
  // other
  const known = [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "avif",
    "bmp",
    "ico",
    "mp4",
    "webm",
    "mov",
    "m4v",
    "avi",
    "mkv",
    "pdf",
    "html",
    "htm",
    "doc",
    "docx",
    "txt",
    "md",
    "rtf",
    "csv",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
  ];
  return !known.includes(ext);
}

function normalizeFileTypeFilter(value: unknown): FileTypeFilter {
  const raw = String(value ?? "all").trim().toLowerCase();
  if (
    raw === "images" ||
    raw === "video" ||
    raw === "pdf" ||
    raw === "html" ||
    raw === "docs" ||
    raw === "other"
  ) {
    return raw;
  }
  return "all";
}

function matchesFileSearch(file: BucketFile, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return (
    file.name.toLowerCase().includes(q) ||
    file.key.toLowerCase().includes(q) ||
    (file.bucket || "").toLowerCase().includes(q)
  );
}

/** One page across one bucket or all project buckets. */
export async function listFilesCatalogPage(
  buckets: EdmBucket[],
  options?: {
    bucketName?: string; // omit / "all" = every bucket
    page?: number;
    pageSize?: number;
    type?: string;
    q?: string;
  },
) {
  const pageSize = Math.max(1, Math.min(200, options?.pageSize ?? 50));
  const page = Math.max(1, Math.floor(options?.page ?? 1));
  const type = normalizeFileTypeFilter(options?.type);
  const q = String(options?.q ?? "").trim().slice(0, 200);
  const requested = (options?.bucketName || "all").trim();
  const scope =
    !requested || requested === "all"
      ? buckets
      : buckets.filter((item) => item.name === requested);

  const batches = await Promise.all(
    scope.map((item) => listAllFilesInBucket(item)),
  );
  const merged = sortFilesNewestFirst(
    batches
      .flatMap((batch) => batch.files)
      .filter(
        (file) =>
          matchesFileTypeFilter(file, type) && matchesFileSearch(file, q),
      ),
  );
  const truncated = batches.some((batch) => batch.truncated);
  const total = merged.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    files: merged.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : totalPages,
    truncated,
    bucket: requested === "all" || !requested ? "all" : requested,
    type,
    q,
  };
}

/** One page of bucket objects (S3 continuation token for next page). */
export async function listBucketFilesPage(
  bucket: EdmBucket,
  options?: { pageSize?: number; continuationToken?: string },
) {
  const pageSize = Math.max(1, Math.min(200, options?.pageSize ?? 50));
  const listed = await s3(bucket.region).send(
    new ListObjectsV2Command({
      Bucket: bucket.name,
      MaxKeys: pageSize,
      ContinuationToken: options?.continuationToken || undefined,
    }),
  );
  const files = (listed.Contents ?? [])
    .map((item) => mapBucketObject(bucket, item))
    .filter((item): item is BucketFile => Boolean(item));
  return {
    files,
    nextToken: listed.IsTruncated ? listed.NextContinuationToken || "" : "",
    hasMore: Boolean(listed.IsTruncated && listed.NextContinuationToken),
    pageSize,
  };
}

/** Upload one file to a project bucket and return its public URL. */
export async function uploadFileToBucket(
  bucket: EdmBucket,
  file: { name: string; type: string; bytes: Buffer },
) {
  const dot = file.name.lastIndexOf(".");
  const stem = (dot > 0 ? file.name.slice(0, dot) : file.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) : "";
  const key = `uploads/${stem || "file"}_${Date.now()}${extension ? `.${extension}` : ""}`;
  await s3(bucket.region).send(
    new PutObjectCommand({
      Bucket: bucket.name,
      Key: key,
      Body: file.bytes,
      ContentType: file.type || "application/octet-stream",
    }),
  );
  return `https://${bucket.name}.s3.${bucket.region}.amazonaws.com/${key}`;
}

export async function publishHtmlImages(html: string, bucket: EdmBucket) {
  const sources = [
    ...html.matchAll(/\bsrc=(?:"(data:image\/[^"]+)"|'(data:image\/[^']+)')/g),
  ]
    .map((match) => match[1] || match[2])
    .filter(Boolean);
  const unique = [...new Set(sources)];
  if (!unique.length) return html;

  const client = s3(bucket.region);
  let next = html;
  for (const dataUrl of unique) {
    const image = imageBytes(dataUrl);
    if (!image) continue;
    const key = `edm/${crypto.randomUUID()}.${image.extension}`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket.name,
        Key: key,
        Body: image.bytes,
        ContentType: image.contentType,
      }),
    );
    const url = `https://${bucket.name}.s3.${bucket.region}.amazonaws.com/${key}`;
    next = next.replaceAll(dataUrl, url);
  }
  return next;
}
