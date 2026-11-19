import { NextResponse } from "next/server";
import { requireProjectEvent } from "@/lib/event-api-guard";
import {
  buildEventReportPayload,
  buildEventReportWorkbook,
  eventReportDownloadName,
} from "@/lib/event-report";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectEvent(id);
  if (access instanceof NextResponse) {
    return access;
  }

  try {
    const report = await buildEventReportPayload(id);
    if (!report) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
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
    console.error("Failed to export event report:", error);
    return NextResponse.json(
      { error: "Failed to export report" },
      { status: 500 },
    );
  }
}
