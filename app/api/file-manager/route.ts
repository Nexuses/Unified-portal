import { NextRequest, NextResponse } from "next/server";
import { compressFileForUpload } from "@/lib/file-manager-compress";
import {
  listFilesCatalogPage,
  listProjectBuckets,
  uploadFileToBucket,
} from "@/lib/s3-edm";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 120;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const buckets = await listProjectBuckets(session.projectName);
    const requested = request.nextUrl.searchParams.get("bucket")?.trim() || "all";
    const type = request.nextUrl.searchParams.get("type")?.trim() || "all";
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const pageParam = Number(request.nextUrl.searchParams.get("page") || "1");
    const page = Number.isFinite(pageParam) ? pageParam : 1;

    const catalog = await listFilesCatalogPage(buckets, {
      bucketName: requested,
      page,
      pageSize: PAGE_SIZE,
      type,
      q,
    });

    return NextResponse.json({
      projectName: session.projectName,
      buckets,
      bucket: catalog.bucket,
      type: catalog.type,
      q: catalog.q,
      files: catalog.files,
      page: catalog.page,
      pageSize: catalog.pageSize,
      total: catalog.total,
      totalPages: catalog.totalPages,
      truncated: catalog.truncated,
    });
  } catch (error) {
    console.error("Failed to load file manager:", error);
    const message =
      error instanceof Error ? error.message : "Could not load files";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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
      return NextResponse.json(
        { error: "Choose a file to upload." },
        { status: 400 },
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Files can be up to 25 MB." },
        { status: 400 },
      );
    }
    if (!bucketName || bucketName === "all") {
      return NextResponse.json(
        { error: "Pick a specific bucket before uploading." },
        { status: 400 },
      );
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

    const compressed = await compressFileForUpload({
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    const url = await uploadFileToBucket(bucket, {
      name: compressed.name,
      type: compressed.type,
      bytes: compressed.bytes,
    });
    const type = String(form?.get("type") ?? "all").trim() || "all";
    const q = String(form?.get("q") ?? "").trim();
    const catalog = await listFilesCatalogPage(
      await listProjectBuckets(session.projectName),
      {
        bucketName,
        page: 1,
        pageSize: PAGE_SIZE,
        type,
        q,
      },
    );
    return NextResponse.json({
      url,
      bucket: bucket.name,
      name: compressed.name,
      originalName: file.name,
      compressed: compressed.compressed,
      originalBytes: compressed.originalBytes,
      bytes: compressed.bytes.length,
      type: catalog.type,
      q: catalog.q,
      files: catalog.files,
      page: catalog.page,
      pageSize: catalog.pageSize,
      total: catalog.total,
      totalPages: catalog.totalPages,
      truncated: catalog.truncated,
    });
  } catch (error) {
    console.error("File manager upload failed:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
