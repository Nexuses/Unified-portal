import { NextResponse } from "next/server";
import { getApiCreditStatus } from "@/lib/api-credits-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export async function GET() {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    return NextResponse.json(await getApiCreditStatus(session.projectId));
  } catch (error) {
    console.error("Failed to load API credits:", error);
    return NextResponse.json({ error: "Failed to load API credit" }, { status: 500 });
  }
}
