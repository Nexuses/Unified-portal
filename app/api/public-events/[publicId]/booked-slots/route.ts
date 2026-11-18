import { NextResponse } from "next/server";
import { getEventByPublicId } from "@/lib/events";
import { getBookedSlotIndexesByEventId } from "@/lib/submissions";

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { publicId } = await context.params;
  const event = await getEventByPublicId(publicId);

  if (!event || event.status !== "published") {
    return NextResponse.json({ message: "Event not found." }, { status: 404 });
  }

  const bookedSlotIndexes = await getBookedSlotIndexesByEventId(event.id);
  return NextResponse.json(
    { bookedSlotIndexes },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
