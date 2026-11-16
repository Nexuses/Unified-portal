import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import {
  boatConfigured,
  getProjectBackupMeta,
  getProjectSnapshot,
  saveProjectSnapshot,
} from "@/lib/boat";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

/** Saved-snapshot backup of the email computer (keeps sender logins across expired disks). */
export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    if (!boatConfigured()) return NextResponse.json({ backup: { status: "none" } });
    const projectId = new ObjectId(session.projectId);
    const [snapshot, meta] = await Promise.all([
      getProjectSnapshot(projectId).catch(() => ({ status: "none" as const })),
      getProjectBackupMeta(projectId),
    ]);
    return NextResponse.json({ backup: { ...snapshot, ...meta } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load backup status" },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const projectId = new ObjectId(session.projectId);
    const result = await saveProjectSnapshot(projectId, { force: true });
    if (!result.saved) {
      return NextResponse.json(
        { error: "Start the computer once before backing it up." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start the backup" },
      { status: 500 },
    );
  }
}
