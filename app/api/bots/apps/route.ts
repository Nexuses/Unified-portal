import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  composioConfigured,
  connectApp,
  disconnectApp,
  forgetConnectedCache,
  listApps,
} from "@/lib/composio-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const maxDuration = 60;

/** Connected apps (Composio) for the project's bots. */
export async function GET() {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  if (!composioConfigured()) return NextResponse.json({ configured: false, apps: [] });
  try {
    return NextResponse.json({ configured: true, apps: await listApps(new ObjectId(session.projectId)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load apps" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  const projectId = new ObjectId(session.projectId);
  const body = ((await request.json().catch(() => ({}))) ?? {}) as { action?: string; toolkit?: string; accountId?: string };
  try {
    forgetConnectedCache(projectId);
    if (body.action === "connect") {
      return NextResponse.json({ url: await connectApp(projectId, String(body.toolkit ?? "")) });
    }
    if (body.action === "disconnect") {
      await disconnectApp(projectId, String(body.accountId ?? ""));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "App action failed" }, { status: 400 });
  }
}
