import { NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { dispatchDueScheduledInvites } from "@/lib/scheduled-invites";

async function runDispatch(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await dispatchDueScheduledInvites();
    return NextResponse.json({
      message: "Scheduled invite dispatch complete.",
      ...result,
    });
  } catch {
    return NextResponse.json({ message: "Failed to dispatch scheduled invites." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return runDispatch(request);
}

export async function POST(request: Request) {
  return runDispatch(request);
}
