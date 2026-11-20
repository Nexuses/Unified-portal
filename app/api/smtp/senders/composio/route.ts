import { NextRequest, NextResponse } from "next/server";
import {
  ComposioConfigError,
  composioCallbackOrigin,
  isComposioMailbox,
  startComposioSenderLink,
} from "@/lib/composio-mail";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = await request.json().catch(() => ({}));
    const provider = String((body as { provider?: unknown }).provider ?? "");
    const fromName = String((body as { fromName?: unknown }).fromName ?? "").trim();
    if (!isComposioMailbox(provider)) {
      return NextResponse.json(
        { error: "Connect through Composio is available for Gmail and Outlook." },
        { status: 400 },
      );
    }

    const link = await startComposioSenderLink({
      projectId: session.projectId,
      portalUserId: session.id,
      provider,
      origin: composioCallbackOrigin(request),
      ...(fromName ? { fromName } : {}),
    });
    if (!link?.redirectUrl) {
      return NextResponse.json(
        { error: "Composio did not return a sign-in link. Try again." },
        { status: 502 },
      );
    }
    return NextResponse.json(link);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not start the Composio sign-in.";
    const status = error instanceof ComposioConfigError ? 400 : 500;
    if (status === 500) {
      console.error("Failed to start Composio sender link:", error);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
