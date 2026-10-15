import { NextResponse } from "next/server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    return NextResponse.json({
      logoUrl: session.projectLogoUrl,
      projectName: session.projectName,
    });
  } catch (error) {
    console.error("Failed to load EDM memory:", error);
    return NextResponse.json({ error: "Failed to load memory" }, { status: 500 });
  }
}
