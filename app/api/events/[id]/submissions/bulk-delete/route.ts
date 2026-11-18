import { NextResponse } from "next/server";
import { requireProjectEvent } from "@/lib/event-api-guard";
import { revalidateEventPagesByEventId } from "@/lib/revalidate-dashboard";
import { deleteSubmissionsByIdsForEvent } from "@/lib/submissions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectEvent(id);
  if (access instanceof NextResponse) {
    return access;
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      submissionIds?: unknown;
    };
    const submissionIds = Array.isArray(body.submissionIds)
      ? body.submissionIds.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];

    if (submissionIds.length === 0) {
      return NextResponse.json({ message: "No submissions selected." }, { status: 400 });
    }

    const deletedCount = await deleteSubmissionsByIdsForEvent(id, submissionIds);
    await revalidateEventPagesByEventId(id);

    return NextResponse.json(
      {
        message:
          deletedCount === 1
            ? "1 contact removed."
            : `${deletedCount} contacts removed.`,
        deletedCount,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ message: "Failed to remove contacts." }, { status: 500 });
  }
}
