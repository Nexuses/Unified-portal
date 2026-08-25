import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getProjectCompaniesWithContacts } from "@/lib/crm-companies-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const companies = await getProjectCompaniesWithContacts(
      new ObjectId(session.projectId),
      session.projectName,
    );

    return NextResponse.json(companies);
  } catch (error) {
    console.error("Failed to fetch companies:", error);
    return NextResponse.json(
      { error: "Failed to fetch companies" },
      { status: 500 },
    );
  }
}
