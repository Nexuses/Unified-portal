import { NextRequest, NextResponse } from "next/server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";
import {
  getDataCreditStatus,
  refundDataCreditReservation,
  reserveDataCredits,
} from "@/lib/data-credits-server";

export async function GET() {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    return NextResponse.json(await getDataCreditStatus(session.projectId));
  } catch (error) {
    console.error("Failed to load data credits:", error);
    return NextResponse.json({ error: "Failed to load data credits" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const body = (await request.json().catch(() => ({}))) as { amount?: unknown };
    const amount = Math.floor(Number(body.amount));
    if (!Number.isFinite(amount) || amount < 1) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
    }
    const result = await reserveDataCredits(session.projectId, amount);
    if (!result.ok) {
      const { remaining } = result.status;
      return NextResponse.json(
        {
          error:
            remaining === 0
              ? "No data credits left this month."
              : `Only ${remaining.toLocaleString()} data credits left this month — save ${remaining.toLocaleString()} or fewer contacts.`,
          status: result.status,
        },
        { status: 402 },
      );
    }
    return NextResponse.json({ status: result.status, reservationId: result.reservationId });
  } catch (error) {
    console.error("Failed to reserve data credits:", error);
    return NextResponse.json({ error: "Failed to reserve data credits" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;
  try {
    const reservationId = request.nextUrl.searchParams.get("reservationId") ?? "";
    return NextResponse.json(await refundDataCreditReservation(session.projectId, reservationId));
  } catch (error) {
    console.error("Failed to refund data credits:", error);
    return NextResponse.json({ error: "Failed to refund data credits" }, { status: 500 });
  }
}
