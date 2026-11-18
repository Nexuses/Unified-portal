import { NextResponse } from "next/server";
import { revalidateEventPages } from "@/lib/revalidate-dashboard";
import { acceptWebinarInviteByPublicId, acceptWebinarInviteBySubmissionId } from "@/lib/submissions";

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { publicId } = await context.params;

  try {
    const body = (await request.json()) as { sid?: unknown; email?: unknown };
    const sid = typeof body.sid === "string" ? body.sid.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";

    if (!sid && !email) {
      return NextResponse.json({ message: "Invalid invite link." }, { status: 400 });
    }

    if (sid) {
      await acceptWebinarInviteBySubmissionId(publicId, sid);
    } else {
      const decodedEmail = decodeURIComponent(email.replace(/ /g, "+"));
      await acceptWebinarInviteByPublicId(publicId, decodedEmail);
    }

    revalidateEventPages({ publicId });
    return NextResponse.json({ message: "Attendance confirmed." }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not confirm attendance.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
