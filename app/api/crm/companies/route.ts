import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  getProjectCompaniesWithContacts,
  listProjectCompanies,
} from "@/lib/crm-companies-server";
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

    const projectId = new ObjectId(session.projectId);
    const params = request.nextUrl.searchParams;
    const pageParam = params.get("page");
    const paginate = pageParam != null || params.has("pageSize") || params.has("q");

    if (paginate) {
      const data = await listProjectCompanies(projectId, session.projectName, {
        page: Number(pageParam ?? "1"),
        pageSize: Number(params.get("pageSize") ?? "50"),
        q: params.get("q") ?? "",
      });
      return NextResponse.json(data);
    }

    const companies = await getProjectCompaniesWithContacts(
      projectId,
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
