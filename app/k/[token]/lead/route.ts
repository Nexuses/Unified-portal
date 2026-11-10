import { NextRequest, NextResponse } from "next/server";
import { isAnalyticsShareExpired } from "@/lib/analytics";
import { findKanbanShareByToken } from "@/lib/analytics-kanban-server";
import { ensureContactShareToken } from "@/lib/crm-contacts-server";
import { type ContactDoc } from "@/lib/crm";
import { getDb } from "@/lib/mongodb";
import { publicContactPath } from "@/lib/portal-nav";

type RouteContext = { params: Promise<{ token: string }> };

/** Lazily creates a contact share token and redirects to the public CRM contact. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const email = String(request.nextUrl.searchParams.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email || email.length > 320) {
    return NextResponse.redirect(new URL(`/k/${encodeURIComponent(token)}`, request.url));
  }

  const share = await findKanbanShareByToken(token);
  if (!share || isAnalyticsShareExpired(share)) {
    return NextResponse.redirect(new URL(`/k/${encodeURIComponent(token)}`, request.url));
  }

  const db = await getDb();
  const contact = await db.collection<ContactDoc>("contacts").findOne(
    { projectId: share.projectId, email },
    { projection: { _id: 1 } },
  );
  if (!contact) {
    return new NextResponse("Contact not available.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const contactToken = await ensureContactShareToken(share.projectId, contact._id);
  if (!contactToken) {
    return new NextResponse("Contact not available.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.redirect(new URL(publicContactPath(contactToken), request.url));
}
