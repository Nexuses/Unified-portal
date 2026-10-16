import {
  GetBucketLocationCommand,
  ListBucketsCommand,
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
