import { NextResponse } from "next/server";
import {
  buildEventReportByShareToken,
  buildEventReportWorkbook,
  eventReportDownloadName,
} from "@/lib/event-report";

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
    const workbook = await buildEventReportWorkbook(report);
    const filename = eventReportDownloadName(report.eventName);
    return new NextResponse(new Uint8Array(workbook), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to export public event report:", error);
    return NextResponse.json(
      { error: "Failed to export report" },
      { status: 500 },
    );
  }
}
