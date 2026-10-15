import { NextRequest, NextResponse } from "next/server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";
import { fileToMarkdown } from "@/lib/knowledge-base-convert";
import { addKnowledgeDoc, listKnowledgeDocs } from "@/lib/knowledge-base-server";
import type { KnowledgeUploadResult } from "@/lib/knowledge-base";

export const runtime = "nodejs";

const MAX_FILES_PER_UPLOAD = 10;

export async function GET() {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    return NextResponse.json({
      docs: await listKnowledgeDocs(session.projectId),
      project: { name: session.projectName, logoUrl: session.projectLogoUrl },
    });
  } catch (error) {
    console.error("Failed to load knowledge base:", error);
    return NextResponse.json({ error: "Failed to load knowledge base" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload one or more files." }, { status: 400 });
  }
  const files = form.getAll("file").filter((value): value is File => value instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Upload one or more files." }, { status: 400 });
  }
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return NextResponse.json(
      { error: `Upload up to ${MAX_FILES_PER_UPLOAD} files at a time.` },
      { status: 400 },
    );
  }

  const names = form.getAll("name").map((value) => (typeof value === "string" ? value : ""));
  const results: KnowledgeUploadResult[] = [];
  for (const [index, file] of files.entries()) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const { title, markdown, truncated } = await fileToMarkdown(file.name, buffer, names[index]);
      const doc = await addKnowledgeDoc(session.projectId, {
        title,
        fileName: file.name,
        fileSize: buffer.byteLength,
        markdown,
        truncated,
        createdBy: session.fullName || session.email,
      });
      results.push({ fileName: file.name, ok: true, doc });
    } catch (error) {
      results.push({
        fileName: file.name,
        ok: false,
        error: error instanceof Error ? error.message : "Could not convert this file.",
      });
    }
  }
  const anyOk = results.some((result) => result.ok);
  return NextResponse.json({ results }, { status: anyOk ? 201 : 422 });
}
