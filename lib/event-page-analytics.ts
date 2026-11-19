import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { displayCountry } from "@/lib/visitor-location";

export type EventPageViewDocument = {
  _id?: ObjectId;
  eventId: ObjectId;
  publicId: string;
  visitorId: string;
  path: string;
  referrer: string;
  referrerHost: string;
  userAgent: string;
  device: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
  browser: string;
  os: string;
  language: string;
  timezone: string;
  screen: string;
  country: string;
  region: string;
  city: string;
  createdAt: Date;
};

export type AnalyticsDayBucket = {
  date: string;
  views: number;
  visitors: number;
};

export type AnalyticsNamedCount = {
  name: string;
  count: number;
};

export type EventPageAnalyticsSummary = {
  totalViews: number;
  uniqueVisitors: number;
  viewsLast7Days: number;
  viewsLast30Days: number;
  visitorsLast7Days: number;
  visitorsLast30Days: number;
  avgViewsPerDay30: number;
  registrationCount: number;
  conversionRate: number;
  daily: AnalyticsDayBucket[];
  topReferrers: AnalyticsNamedCount[];
  devices: AnalyticsNamedCount[];
  browsers: AnalyticsNamedCount[];
  countries: AnalyticsNamedCount[];
  recentViews: Array<{
    id: string;
    createdAt: string;
    device: string;
    browser: string;
    os: string;
    referrerHost: string;
    country: string;
    region: string;
    city: string;
    timezone: string;
    path: string;
  }>;
};

function analyticsCollection() {
  return getDb().then((db) => db.collection<EventPageViewDocument>("event_page_views"));
}

function clampText(value: unknown, max = 240) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function hostFromReferrer(referrer: string) {
  if (!referrer) {
    return "Direct";
  }
  try {
    const url = new URL(referrer);
    return url.hostname.replace(/^www\./, "") || "Direct";
  } catch {
    return "Direct";
  }
}

export function parseUserAgent(userAgent: string): {
  device: EventPageViewDocument["device"];
  browser: string;
  os: string;
} {
  const ua = userAgent || "";
  const lower = ua.toLowerCase();

  let device: EventPageViewDocument["device"] = "desktop";
  if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|preview/i.test(ua)) {
    device = "bot";
  } else if (/ipad|tablet|kindle|playbook|silk|(android(?!.*mobile))/i.test(ua)) {
    device = "tablet";
  } else if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) {
    device = "mobile";
  } else if (!ua) {
    device = "unknown";
  }

  let browser = "Other";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = "Opera";
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = "Chrome";
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = "Safari";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/msie|trident/i.test(ua)) browser = "IE";

  let os = "Other";
  if (/windows nt/i.test(ua)) os = "Windows";
  else if (/mac os x/i.test(ua)) os = "macOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/linux/i.test(ua)) os = "Linux";
  else if (/cros/i.test(ua)) os = "Chrome OS";

  if (lower.includes("bot")) {
    browser = "Bot";
  }

  return { device, browser, os };
}

export async function recordEventPageView(input: {
  eventId: string;
  publicId: string;
  visitorId: string;
  path?: string;
  referrer?: string;
  userAgent?: string;
  language?: string;
  timezone?: string;
  screen?: string;
  country?: string;
  region?: string;
  city?: string;
}) {
  if (!ObjectId.isValid(input.eventId)) {
    throw new Error("Invalid event.");
  }

  const visitorId = clampText(input.visitorId, 80);
  if (!visitorId) {
    throw new Error("Visitor id is required.");
  }

  const referrer = clampText(input.referrer, 500);
  const userAgent = clampText(input.userAgent, 500);
  const parsed = parseUserAgent(userAgent);
  const collection = await analyticsCollection();

  await collection.insertOne({
    eventId: new ObjectId(input.eventId),
    publicId: clampText(input.publicId, 64),
    visitorId,
    path: clampText(input.path || `/${input.publicId}`, 200) || `/${input.publicId}`,
    referrer,
    referrerHost: hostFromReferrer(referrer),
    userAgent,
    device: parsed.device,
    browser: parsed.browser,
    os: parsed.os,
    language: clampText(input.language, 40),
    timezone: clampText(input.timezone, 64),
    screen: clampText(input.screen, 40),
    country: clampText(input.country, 64),
    region: clampText(input.region, 64),
    city: clampText(input.city, 64),
    createdAt: new Date(),
  });
}

function toDateKey(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function emptyDailyBuckets(days: number): AnalyticsDayBucket[] {
  const buckets: AnalyticsDayBucket[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    day.setUTCDate(day.getUTCDate() - i);
    buckets.push({ date: toDateKey(day), views: 0, visitors: 0 });
  }
  return buckets;
}

function namedCounts(
  rows: Array<{ _id: string; count: number }>,
  limit = 8
): AnalyticsNamedCount[] {
  return rows
    .map((row) => ({
      name: String(row._id || "Unknown").trim() || "Unknown",
      count: row.count,
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function getEventPageAnalytics(
  eventId: string,
  options?: { registrationCount?: number }
): Promise<EventPageAnalyticsSummary> {
  const empty: EventPageAnalyticsSummary = {
    totalViews: 0,
    uniqueVisitors: 0,
    viewsLast7Days: 0,
    viewsLast30Days: 0,
    visitorsLast7Days: 0,
    visitorsLast30Days: 0,
    avgViewsPerDay30: 0,
    registrationCount: options?.registrationCount ?? 0,
    conversionRate: 0,
    daily: emptyDailyBuckets(14),
    topReferrers: [],
    devices: [],
    browsers: [],
    countries: [],
    recentViews: [],
  };

  if (!ObjectId.isValid(eventId)) {
    return empty;
  }

  const eventObjectId = new ObjectId(eventId);
  const collection = await analyticsCollection();
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
  fourteenDaysAgo.setUTCHours(0, 0, 0, 0);

  const matchEvent = { eventId: eventObjectId };

  const [
    totalViews,
    uniqueVisitorDocs,
    viewsLast7Days,
    viewsLast30Days,
    visitorsLast7,
    visitorsLast30,
    dailyRaw,
    referrerRaw,
    deviceRaw,
    browserRaw,
    countryRaw,
    recentRaw,
  ] = await Promise.all([
    collection.countDocuments(matchEvent),
    collection.distinct("visitorId", matchEvent),
    collection.countDocuments({ ...matchEvent, createdAt: { $gte: sevenDaysAgo } }),
    collection.countDocuments({ ...matchEvent, createdAt: { $gte: thirtyDaysAgo } }),
    collection.distinct("visitorId", { ...matchEvent, createdAt: { $gte: sevenDaysAgo } }),
    collection.distinct("visitorId", { ...matchEvent, createdAt: { $gte: thirtyDaysAgo } }),
    collection
      .aggregate<{ _id: string; views: number; visitors: number }>([
        { $match: { ...matchEvent, createdAt: { $gte: fourteenDaysAgo } } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            views: { $sum: 1 },
            visitorIds: { $addToSet: "$visitorId" },
          },
        },
        {
          $project: {
            views: 1,
            visitors: { $size: "$visitorIds" },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    collection
      .aggregate<{ _id: string; count: number }>([
        { $match: matchEvent },
        {
          $group: {
            _id: {
              $cond: [
                { $or: [{ $eq: ["$referrerHost", ""] }, { $eq: ["$referrerHost", null] }] },
                "Direct",
                "$referrerHost",
              ],
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ])
      .toArray(),
    collection
      .aggregate<{ _id: string; count: number }>([
        { $match: matchEvent },
        { $group: { _id: "$device", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray(),
    collection
      .aggregate<{ _id: string; count: number }>([
        { $match: matchEvent },
        { $group: { _id: "$browser", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ])
      .toArray(),
    collection
      .aggregate<{ _id: string; count: number; timezone?: string }>([
        { $match: matchEvent },
        {
          $group: {
            _id: {
              country: { $ifNull: ["$country", ""] },
              timezone: { $ifNull: ["$timezone", ""] },
            },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$_id.country", ""] },
                    { $ne: ["$_id.country", null] },
                  ],
                },
                "$_id.country",
                {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$_id.timezone", ""] },
                        { $ne: ["$_id.timezone", null] },
                      ],
                    },
                    "$_id.timezone",
                    "Unknown",
                  ],
                },
              ],
            },
            timezone: "$_id.timezone",
            count: 1,
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ])
      .toArray(),
    collection
      .find(matchEvent)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray(),
  ]);

  const dailyMap = new Map(
    dailyRaw.map((row) => [row._id, { views: row.views, visitors: row.visitors }])
  );
  const daily = emptyDailyBuckets(14).map((bucket) => {
    const found = dailyMap.get(bucket.date);
    return found
      ? { date: bucket.date, views: found.views, visitors: found.visitors }
      : bucket;
  });

  const uniqueVisitors = uniqueVisitorDocs.length;
  const visitorsLast7Days = visitorsLast7.length;
  const visitorsLast30Days = visitorsLast30.length;
  const registrationCount = options?.registrationCount ?? 0;
  const conversionRate =
    uniqueVisitors > 0 ? Math.round((registrationCount / uniqueVisitors) * 1000) / 10 : 0;

  return {
    totalViews,
    uniqueVisitors,
    viewsLast7Days,
    viewsLast30Days,
    visitorsLast7Days,
    visitorsLast30Days,
    avgViewsPerDay30: Math.round((viewsLast30Days / 30) * 10) / 10,
    registrationCount,
    conversionRate,
    daily,
    topReferrers: namedCounts(referrerRaw),
    devices: namedCounts(deviceRaw),
    browsers: namedCounts(browserRaw),
    countries: namedCounts(
      (() => {
        const merged = new Map<string, number>();
        for (const row of countryRaw) {
          const label =
            displayCountry(String(row._id ?? ""), String(row.timezone ?? "")) || "Unknown";
          merged.set(label, (merged.get(label) ?? 0) + row.count);
        }
        return [...merged.entries()].map(([name, count]) => ({ _id: name, count }));
      })()
    ),
    recentViews: recentRaw.map((row) => ({
      id: row._id?.toString() ?? "",
      createdAt: row.createdAt.toISOString(),
      device: row.device || "unknown",
      browser: row.browser || "Other",
      os: row.os || "Other",
      referrerHost: row.referrerHost || "Direct",
      country: displayCountry(row.country || "", row.timezone || ""),
      region: row.region || "",
      city: row.city || "",
      timezone: row.timezone || "",
      path: row.path || "",
    })),
  };
}
