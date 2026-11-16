import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  removeLeadReportSolutionOption,
  updateLeadReportSolutions,
} from "@/lib/crm-lead-reports-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const MAX_NAME_LENGTH = 120;

/** Remove a solution option from every lead report in the project. */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json().catch(() => null)) as {
      solution?: unknown;
    } | null;
    const name = String(body?.solution ?? "")
      .trim()
      .slice(0, MAX_NAME_LENGTH);
    if (!name) {
      return NextResponse.json(
        { error: "solution is required" },
        { status: 400 },
      );
    }

    const result = await removeLeadReportSolutionOption(
      new ObjectId(session.projectId),
      name,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to remove lead report solution option:", error);
    return NextResponse.json(
      { error: "Failed to remove solution option" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const body = (await request.json().catch(() => null)) as {
      contactId?: string;
      solution?: unknown;
      solutions?: unknown;
    } | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    if (!body.contactId || !ObjectId.isValid(body.contactId)) {
      return NextResponse.json(
        { error: "Invalid contact id" },
        { status: 400 },
      );
    }

    // A lead report holds a single solution. Accept either shape and keep one.
    const raw =
      body.solution !== undefined
        ? body.solution
        : Array.isArray(body.solutions)
          ? body.solutions[0]
          : "";
    if (typeof raw !== "string" && typeof raw !== "number") {
      return NextResponse.json(
        { error: "solution must be a string" },
        { status: 400 },
      );
    }

    const name = String(raw).trim().slice(0, MAX_NAME_LENGTH);

    const item = await updateLeadReportSolutions(
      new ObjectId(session.projectId),
      new ObjectId(body.contactId),
      name ? [name] : [],
    );
    if (!item) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    return NextResponse.json({ item, solution: name });
  } catch (error) {
    console.error("Failed to update lead report solution:", error);
    return NextResponse.json(
      { error: "Failed to update solution" },
      { status: 500 },
    );
  }
}
