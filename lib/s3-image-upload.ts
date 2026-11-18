import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { listProjectBuckets, type EdmBucket } from "@/lib/s3-edm";

const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export type EventImageKind = "header" | "banner" | "company";

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Add it to the server environment.`);
  }
  return value;
}

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function chooseProjectBucket(projectName: string, buckets: EdmBucket[]) {
  const token = compact(projectName);
  const exact = buckets.find((bucket) => compact(bucket.name) === token);
  if (exact) return exact;
  return [...buckets].sort((a, b) => a.name.length - b.name.length)[0] ?? null;
}

function publicObjectUrl(bucket: string, region: string, key: string) {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export async function uploadEventImage(
  file: File,
  kind: EventImageKind,
  projectName: string,
) {
  const accessKeyId = requireEnv("AWS_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("AWS_SECRET_ACCESS_KEY");
  const buckets = await listProjectBuckets(projectName);
  const bucket = chooseProjectBucket(projectName, buckets);
  if (!bucket) {
    throw new Error(`No S3 bucket was found for ${projectName}.`);
  }

  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    throw new Error("Use a PNG, JPG, WEBP, or GIF image.");
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    throw new Error("Image must be 5 MB or smaller.");
  }

  const key = `events/${kind}/${randomUUID()}${extension}`;
  const body = Buffer.from(await file.arrayBuffer());
  const client = new S3Client({
    region: bucket.region,
    credentials: { accessKeyId, secretAccessKey },
  });

  await client.send(
    new PutObjectCommand({
      Bucket: bucket.name,
      Key: key,
      Body: body,
      ContentType: file.type,
      CacheControl: "public, max-age=31536000",
    }),
  );

  return publicObjectUrl(bucket.name, bucket.region, key);
}
