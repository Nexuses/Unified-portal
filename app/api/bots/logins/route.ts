import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { AI_LOGIN_PROVIDERS, cancelLogin, listLogins, logout, startLogin } from "@/lib/ai-logins-server";
import type { AiLoginProvider } from "@/lib/ai-bots";
import { BoatError, boatConfigured } from "@/lib/boat";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

// Starting a sign-in may wake the project's computer first.
export const maxDuration = 180;

/** The project's AI plan sign-ins (ChatGPT, SuperGrok) on its computer. */
export async function GET() {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  if (!boatConfigured()) return NextResponse.json({ configured: false, logins: [] });
  try {
    return NextResponse.json({ configured: true, logins: await listLogins(new ObjectId(session.projectId)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read sign-ins" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  const projectId = new ObjectId(session.projectId);
  const body = ((await request.json().catch(() => ({}))) ?? {}) as { action?: string; provider?: string };
  const provider = body.provider as AiLoginProvider;
  if (!AI_LOGIN_PROVIDERS.includes(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  try {
    if (body.action === "connect") await startLogin(projectId, provider);
    else if (body.action === "cancel") await cancelLogin(projectId, provider);
    else if (body.action === "disconnect") await logout(projectId, provider);
    else return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    return NextResponse.json({ logins: await listLogins(projectId) });
  } catch (error) {
    const status = error instanceof BoatError && error.status >= 400 && error.status < 500 ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sign-in action failed" }, { status });
  }
}
