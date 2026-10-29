import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  createLeadReportContact,
  ensureContactLeadReport,
  listProjectLeadReports,
} from "@/lib/crm-lead-reports-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const params = request.nextUrl.searchParams;
    const data = await listProjectLeadReports(new ObjectId(session.projectId), {
      page: Number(params.get("page") ?? "1"),
      pageSize: Number(params.get("pageSize") ?? "50"),
      q: params.get("q") ?? "",
      stage: params.get("stage") ?? "",
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to list lead reports:", error);
    return NextResponse.json(
      { error: "Failed to list lead reports" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json().catch(() => null)) as {
      contactId?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      companyName?: string;
      leadProject?: string;
      leadOwner?: string;
    } | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const projectId = new ObjectId(session.projectId);

    if (body.contactId) {
      if (!ObjectId.isValid(body.contactId)) {
        return NextResponse.json({ error: "Invalid contact id" }, { status: 400 });
      }
      const item = await ensureContactLeadReport(
        projectId,
        new ObjectId(body.contactId),
        {
          leadProject: body.leadProject,
          leadOwner: body.leadOwner,
        },
      );
      if (!item) {
        return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      }
      return NextResponse.json(item);
    }

    if (!body.email?.trim()) {
      return NextResponse.json(
        { error: "Select a CRM contact or provide an email." },
        { status: 400 },
      );
    }

    const item = await createLeadReportContact(projectId, {
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      companyName: body.companyName,
      userId: ObjectId.isValid(session.id) ? new ObjectId(session.id) : null,
      leadProject: body.leadProject,
      leadOwner: body.leadOwner,
    });
    return NextResponse.json(item);
  } catch (error) {
    console.error("Failed to create lead report:", error);
    const message =
      error instanceof Error ? error.message : "Failed to create lead report";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
