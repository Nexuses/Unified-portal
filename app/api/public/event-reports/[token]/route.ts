import { NextResponse } from "next/server";
import { buildEventReportByShareToken } from "@/lib/event-report";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { token } = await context.params;
  try {
    const report = await buildEventReportByShareToken(token);
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    return NextResponse.json(report, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Failed to load public event report:", error);
    return NextResponse.json(
      { error: "Failed to load report" },
      { status: 500 },
    );
  }
}
