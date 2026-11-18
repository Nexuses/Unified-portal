import { NextResponse } from "next/server";
import { requireProjectEvent } from "@/lib/event-api-guard";
import { revalidateEventPagesByEventId } from "@/lib/revalidate-dashboard";
import { deleteSubmissionByIdForEvent } from "@/lib/submissions";

type RouteContext = {
  params: Promise<{ id: string; submissionId: string }>;
};

export async function DELETE(_: Request, context: RouteContext) {
  const { id, submissionId } = await context.params;
  const access = await requireProjectEvent(id);
  if (access instanceof NextResponse) {
    return access;
  }

  try {
    const deleted = await deleteSubmissionByIdForEvent(id, submissionId);
    if (!deleted) {
      return NextResponse.json({ message: "Submission not found." }, { status: 404 });
    }
    await revalidateEventPagesByEventId(id);
    return NextResponse.json({ message: "Submission removed." }, { status: 200 });
  } catch {
    return NextResponse.json({ message: "Failed to remove submission." }, { status: 500 });
  }
}
