import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  confirmLinkedinLogin,
  getLinkedinSession,
  openLinkedinComputer,
  watchLinkedinComputer,
} from "@/lib/linkedin-campaigns-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const linkedin = await getLinkedinSession(new ObjectId(session.projectId));
    return NextResponse.json({ session: linkedin });
  } catch (error) {
    console.error("LinkedIn session failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load LinkedIn" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const projectId = new ObjectId(session.projectId);
    const body = (await request.json().catch(() => null)) as {
      action?: string;
      accountName?: string;
    } | null;
    if (body?.action === "confirm") {
      const linkedin = await confirmLinkedinLogin(projectId, String(body.accountName || ""));
      return NextResponse.json({ session: linkedin });
    }
    if (body?.action === "watch") {
      const opened = await watchLinkedinComputer(projectId);
      return NextResponse.json({ desktopUrl: opened.desktopUrl });
    }
    const opened = await openLinkedinComputer(projectId);
    return NextResponse.json({ desktopUrl: opened.desktopUrl, session: opened.session });
  } catch (error) {
    console.error("LinkedIn computer failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not open LinkedIn" },
      { status: 400 },
    );
  }
}
