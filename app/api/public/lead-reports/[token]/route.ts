import { NextResponse } from "next/server";
import { getPublicLeadReportsBundle } from "@/lib/lead-reports-share-server";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const bundle = await getPublicLeadReportsBundle(token);
    if (!bundle) {
      return NextResponse.json(
        { error: "Shared lead reports not found or expired" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        projectName: bundle.projectName,
        projectLogoUrl: bundle.projectLogoUrl,
        columns: bundle.columns,
        items: bundle.items,
        total: bundle.total,
        expiresAt: bundle.expiresAt,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error("Failed to load public lead reports:", error);
    return NextResponse.json(
      { error: "Failed to load shared lead reports" },
      { status: 500 },
    );
  }
}
