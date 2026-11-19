import { NextResponse } from "next/server";
import { getEventById } from "@/lib/events";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function requireEventSession() {
  const session = await requirePortalSession();
  if (isSessionError(session)) {
    return session;
  }
  return session;
}

export async function requireProjectEvent(eventId: string) {
  const session = await requireEventSession();
  if (session instanceof NextResponse) {
    return session;
  }
  const event = await getEventById(eventId, session.projectId);
  if (!event) {
    return NextResponse.json({ message: "Event not found." }, { status: 404 });
  }
  return { session, event };
}
