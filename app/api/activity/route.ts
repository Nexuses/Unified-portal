import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  getProjectActivityFeed,
  type ActivityFeedGroup,
  type ActivityFeedType,
} from "@/lib/activity-feed-server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

const GROUPS = new Set<ActivityFeedGroup>([
  "all",
  "engagement",
  "unsubscribes",
  "campaigns",
  "lists",
  "senders",
  "pipeline",
]);

const TYPES = new Set<ActivityFeedType>([
  "campaign_opened",
  "campaign_clicked",
  "campaign_unsubscribed",
  "campaign_launched",
  "campaign_scheduled",
  "campaign_created",
  "list_created",
  "sender_added",
  "company_created",
  "pipeline_created",
]);

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const groupParam = request.nextUrl.searchParams.get("group")?.trim() || "all";
    const group = GROUPS.has(groupParam as ActivityFeedGroup)
      ? (groupParam as ActivityFeedGroup)
      : "all";

    const typeParam = request.nextUrl.searchParams.get("type")?.trim() || "all";
    const type =
      typeParam === "all"
        ? "all"
        : TYPES.has(typeParam as ActivityFeedType)
          ? (typeParam as ActivityFeedType)
          : "all";

    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const pageParam = Number(request.nextUrl.searchParams.get("page") || "1");
    const page = Number.isFinite(pageParam) ? pageParam : 1;

    const feed = await getProjectActivityFeed(new ObjectId(session.projectId), {
      group,
      type,
      q,
      page,
      pageSize: 40,
    });

    return NextResponse.json(feed);
  } catch (error) {
    console.error("Failed to load activity feed:", error);
    return NextResponse.json(
      { error: "Failed to load activity feed" },
      { status: 500 },
    );
  }
}
