import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import {
  addBrandMemory,
  colorsFromGuide,
  listBrandMemories,
  mergeBrandColors,
} from "@/lib/brand-memories";
import { readLogoBrand } from "@/lib/logo-brand";
import { getProjectBranding } from "@/lib/project-branding";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

async function payload(projectId: ObjectId) {
  const brand = await getProjectBranding(projectId);
  const memories = await listBrandMemories(projectId);
  const logo = await readLogoBrand(brand.logoUrl);
  const colors = mergeBrandColors(
    colorsFromGuide(memories.map((memory) => memory.text).join("\n")),
    logo.colors,
  );
  return {
    name: brand.name,
    logoUrl: brand.logoUrl,
    colors,
    fromGuidelines: colorsFromGuide(memories.map((memory) => memory.text).join("\n")).length > 0,
    memories,
  };
}

export async function GET() {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  const body = await payload(new ObjectId(session.projectId));
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  const projectId = new ObjectId(session.projectId);
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const text = String(form.get("text") ?? "");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "That file is over 20 MB." }, { status: 400 });
      }
      await addBrandMemory(projectId, {
        text,
        fileName: file.name || "upload",
        buffer: Buffer.from(await file.arrayBuffer()),
      });
    } else {
      const body = (await request.json()) as { text?: unknown };
      await addBrandMemory(projectId, { text: String(body.text ?? "") });
    }
    return NextResponse.json(await payload(projectId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save that memory.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
