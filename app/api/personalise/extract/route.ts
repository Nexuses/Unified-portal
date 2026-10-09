import { NextRequest, NextResponse } from "next/server";
import { extractPersonalisePlan } from "@/lib/personalise-extract";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 180;

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const plan = await extractPersonalisePlan(file.name || "upload", buffer);
    return NextResponse.json(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read that file.";
    console.error("Failed to extract personalise file:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
