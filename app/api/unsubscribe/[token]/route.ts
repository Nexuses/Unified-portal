import { NextRequest, NextResponse } from "next/server";
import { getCampaignSendByToken } from "@/lib/campaign-blasts-server";
import { unsubscribeSend } from "@/lib/unsubscribe-server";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const url = new URL(`/unsubscribe/${token}`, request.url);
  return NextResponse.redirect(url, { status: 302 });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const send = await getCampaignSendByToken(token);
    if (!send) {
      return NextResponse.json({ error: "Unsubscribe link is invalid." }, { status: 404 });
    }

    // The public page sends the email the client typed manually; it must
    // match the address this unsubscribe link was sent to. One-click
    // unsubscribe POSTs from mailbox providers carry no email field and
    // keep working with the token alone.
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as {
        email?: unknown;
      } | null;
      const typed =
        typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!typed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) {
        return NextResponse.json(
          { error: "Enter a valid email address." },
          { status: 400 },
        );
      }
      if (typed !== send.email.trim().toLowerCase()) {
        return NextResponse.json(
          {
            error:
              "That email does not match this unsubscribe link. Enter the email address that received the message.",
          },
          { status: 400 },
        );
      }
    }

    const result = await unsubscribeSend(send);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to unsubscribe:", error);
    return NextResponse.json(
      { error: "Failed to unsubscribe" },
      { status: 400 },
    );
  }
}
