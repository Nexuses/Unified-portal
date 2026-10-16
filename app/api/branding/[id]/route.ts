import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import {
  colorsFromGuide,
  deleteBrandMemory,
  listBrandMemories,
  mergeBrandColors,
  updateBrandMemory,
} from "@/lib/brand-memories";
import { readLogoBrand } from "@/lib/logo-brand";
import { getProjectBranding } from "@/lib/project-branding";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

async function payload(projectId: ObjectId) {
  const brand = await getProjectBranding(projectId);
  const memories = await listBrandMemories(projectId);
  const logo = await readLogoBrand(brand.logoUrl);
  const guideColors = colorsFromGuide(memories.map((memory) => memory.text).join("\n"));
  return {
    name: brand.name,
    logoUrl: brand.logoUrl,
    colors: mergeBrandColors(guideColors, logo.colors),
    fromGuidelines: guideColors.length > 0,
    memories,
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  const { id } = await context.params;
  const projectId = new ObjectId(session.projectId);
  try {
    const body = (await request.json()) as { text?: unknown };
    const updated = await updateBrandMemory(projectId, id, String(body.text ?? ""));
    if (!updated) return NextResponse.json({ error: "That memory was not found." }, { status: 404 });
    return NextResponse.json(await payload(projectId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update that memory.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  const { id } = await context.params;
  const projectId = new ObjectId(session.projectId);
  const removed = await deleteBrandMemory(projectId, id);
  if (!removed) return NextResponse.json({ error: "That memory was not found." }, { status: 404 });
  return NextResponse.json(await payload(projectId));
}
