import { NextResponse } from "next/server";
import { requireEventSession } from "@/lib/event-api-guard";
import { uploadEventImage, type EventImageKind } from "@/lib/s3-image-upload";

const KINDS = new Set<EventImageKind>(["header", "banner", "company"]);

export async function POST(request: Request) {
  const session = await requireEventSession();
  if (session instanceof NextResponse) {
    return session;
  }
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const kind = String(formData.get("kind") ?? "");

    if (!(file instanceof File)) {
      return NextResponse.json({ message: "Choose an image to upload." }, { status: 400 });
    }
    if (!KINDS.has(kind as EventImageKind)) {
      return NextResponse.json({ message: "Invalid image type." }, { status: 400 });
    }

    const url = await uploadEventImage(file, kind as EventImageKind, session.projectName);
    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload image.";
    const isClientError = /^(Use |Image |Choose |Invalid |No )/.test(message);
    return NextResponse.json({ message }, { status: isClientError ? 400 : 500 });
  }
}
