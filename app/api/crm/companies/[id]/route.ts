import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getProjectCompanyWithContacts } from "@/lib/crm-companies-server";
import { buildCompanyHistory } from "@/lib/crm";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
    }

    const result = await getProjectCompanyWithContacts(
      new ObjectId(session.projectId),
      new ObjectId(id),
      session.projectName,
    );

    if (!result.company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const history = buildCompanyHistory(
      result.company,
      result.company.contacts,
      session.projectName,
    );

    return NextResponse.json({
      company: result.company,
      history,
      navigation: {
        index: result.index,
        total: result.total,
        prevId: result.prevId,
        nextId: result.nextId,
      },
    });
  } catch (error) {
    console.error("Failed to fetch company:", error);
    return NextResponse.json(
      { error: "Failed to fetch company" },
      { status: 500 },
    );
  }
}
