import { NextResponse } from "next/server";
import { requireProjectEvent } from "@/lib/event-api-guard";
import { markSubmissionAsGoing } from "@/lib/submissions";
import { revalidateEventPagesByEventId } from "@/lib/revalidate-dashboard";

type RouteContext = {
  params: Promise<{ id: string; submissionId: string }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { id, submissionId } = await context.params;
  const access = await requireProjectEvent(id);
  if (access instanceof NextResponse) {
    return access;
  }

  try {
    const updated = await markSubmissionAsGoing(id, submissionId);
    if (!updated) {
      return NextResponse.json({ message: "Submission not found." }, { status: 404 });
    }

    await revalidateEventPagesByEventId(id);
    return NextResponse.json(
      {
        message: "Marked as going.",
        inviteAcceptedAt: updated.inviteAcceptedAt?.toISOString() ?? new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mark as going.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
