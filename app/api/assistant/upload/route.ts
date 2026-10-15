import { NextRequest, NextResponse } from "next/server";
import { listProjectBuckets, uploadFileToBucket } from "@/lib/s3-edm";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 120;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const bucketName = String(form?.get("bucket") ?? "").trim();
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Files can be up to 25 MB." }, { status: 400 });
    }
    const bucket = (await listProjectBuckets(session.projectName)).find(
      (item) => item.name === bucketName,
    );
    if (!bucket) {
      return NextResponse.json(
        { error: "That bucket is not available for this project." },
        { status: 400 },
      );
    }
    const url = await uploadFileToBucket(bucket, {
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ url, bucket: bucket.name, name: file.name });
  } catch (error) {
    console.error("Assistant upload failed:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
