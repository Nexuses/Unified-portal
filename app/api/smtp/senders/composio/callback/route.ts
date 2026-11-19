import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { completeComposioSenderLink } from "@/lib/composio-mail";
import { createProjectSender, getProjectSenders } from "@/lib/smtp-senders-server";
import { GMAIL_DAILY_LIMIT_DEFAULT } from "@/lib/smtp-senders";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const maxDuration = 60;

function smtpRedirect(origin: string, params: Record<string, string>) {
  const url = new URL("/portal/smtp", origin);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value.slice(0, 240));
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const pending = request.nextUrl.searchParams.get("pending") ?? "";

  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      const login = new URL("/login", origin);
      login.searchParams.set("next", "/portal/smtp");
      return NextResponse.redirect(login);
    }

    const linked = await completeComposioSenderLink(pending, session);
    const projectId = new ObjectId(session.projectId);
    const existing = await getProjectSenders(projectId);
    if (
      existing.some(
        (sender) =>
          sender.provider === linked.provider &&
          sender.fromEmail.toLowerCase() === linked.fromEmail,
      )
    ) {
      return smtpRedirect(origin, {
        composio: "error",
        message: `${linked.fromEmail} is already a ${linked.provider} sender on this project.`,
      });
    }

    const sender = await createProjectSender(
      projectId,
      ObjectId.isValid(session.id) ? new ObjectId(session.id) : null,
      {
        provider: linked.provider,
        fromEmail: linked.fromEmail,
        composio: linked.composio,
        ...(linked.provider === "gmail"
          ? { dailyLimit: GMAIL_DAILY_LIMIT_DEFAULT }
          : {}),
      },
    );

    if (sender.connection?.status === "connected") {
      return smtpRedirect(origin, {
        composio: "connected",
        email: sender.fromEmail,
      });
    }

    return smtpRedirect(origin, {
      composio: "saved",
      email: sender.fromEmail,
      message:
        sender.connection?.error ||
        "The mailbox signed in, but the connection test did not send.",
    });
  } catch (error) {
    console.error("Composio sender callback failed:", error);
    const message = error instanceof Error ? error.message : "Composio connection failed.";
    return smtpRedirect(origin, { composio: "error", message });
  }
}
