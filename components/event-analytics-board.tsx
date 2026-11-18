import Link from "next/link";
import { RecentVisitsTable } from "@/components/recent-visits-table";
import type { EventPageAnalyticsSummary } from "@/lib/event-page-analytics";

type EventAnalyticsBoardProps = {
  eventId: string;
  eventName: string;
  publicId: string;
  publicUrl: string;
  analytics: EventPageAnalyticsSummary;
};

function formatDayLabel(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return dateKey;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-black/10 bg-[#fafaf8] p-5">
      <p className="text-xs tracking-wide text-black/50 uppercase">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-black">{value}</p>
      {hint ? <p className="mt-1 text-xs text-black/55">{hint}</p> : null}
    </div>
  );
}

function BreakdownList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ name: string; count: number }>;
}) {
  const max = items.reduce((highest, item) => Math.max(highest, item.count), 0) || 1;
  return (
    <div className="rounded-2xl border border-black/10 p-5">
      <h2 className="text-base font-semibold text-black">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-black/55">{empty}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <div key={`${title}-${item.name}`}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <p className="truncate font-medium text-black">{item.name}</p>
                <p className="shrink-0 text-xs text-black/55">{item.count}</p>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-black/6">
                <div
                  className="h-full rounded-full bg-black/55"
                  style={{ width: `${Math.max(6, (item.count / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EventAnalyticsBoard({
  eventId,
  eventName,
  publicId,
  publicUrl,
  analytics,
}: EventAnalyticsBoardProps) {
  const maxDailyViews =
    analytics.daily.reduce((highest, day) => Math.max(highest, day.views), 0) || 1;

  return (
    <section className="rounded-3xl border border-black/10 bg-white p-7 shadow-[0_25px_80px_-60px_rgba(0,0,0,0.55)]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/portal/marketing/events"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-black/55 transition hover:text-black"
          >
            <span aria-hidden>←</span>
            <span>All events</span>
          </Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-black">
            {eventName} <span className="font-normal text-black/55">Analytics</span>
          </h1>
          <p className="mt-2 text-sm text-black/60">
            Web analytics for the public event page{" "}
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-black underline decoration-black/20 underline-offset-2 hover:decoration-black/50"
            >
              /{publicId}
            </a>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/portal/marketing/events/${eventId}`}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-black/15 px-3 text-xs font-medium text-black/75 hover:bg-black/5 hover:text-black"
          >
            Open Event
          </Link>
          <Link
            href={`/portal/marketing/events/${eventId}/submissions`}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-black/20 px-3 text-xs font-medium text-black hover:bg-black/5"
          >
            Submissions
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Page views"
          value={analytics.totalViews}
          hint={`${analytics.viewsLast7Days} in last 7 days`}
        />
        <StatCard
          label="Unique visitors"
          value={analytics.uniqueVisitors}
          hint={`${analytics.visitorsLast7Days} in last 7 days`}
        />
        <StatCard
          label="30-day views"
          value={analytics.viewsLast30Days}
          hint={`${analytics.avgViewsPerDay30} avg / day`}
        />
        <StatCard
          label="Conversion"
          value={`${analytics.conversionRate}%`}
          hint={`${analytics.registrationCount} registrations / unique visitors`}
        />
      </div>

      <div className="mt-8 rounded-2xl border border-black/10 p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-black">Views last 14 days</h2>
            <p className="mt-1 text-xs text-black/55">Daily page views on the public URL</p>
          </div>
        </div>
        <div className="mt-6 flex h-44 items-end gap-1.5 sm:gap-2">
          {analytics.daily.map((day) => (
            <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="flex h-36 w-full items-end justify-center">
                <div
                  className="w-full max-w-[28px] rounded-t-md bg-black/70"
                  style={{
                    height: `${Math.max(day.views > 0 ? 8 : 2, (day.views / maxDailyViews) * 100)}%`,
                    opacity: day.views > 0 ? 1 : 0.2,
                  }}
                  title={`${day.date}: ${day.views} views, ${day.visitors} visitors`}
                />
              </div>
              <p className="truncate text-[10px] text-black/45">{formatDayLabel(day.date)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <BreakdownList
          title="Top referrers"
          empty="No referrer data yet. Share the public link to start collecting traffic sources."
          items={analytics.topReferrers}
        />
        <BreakdownList
          title="Devices"
          empty="No device data yet."
          items={analytics.devices.map((item) => ({
            ...item,
            name: item.name.charAt(0).toUpperCase() + item.name.slice(1),
          }))}
        />
        <BreakdownList
          title="Browsers"
          empty="No browser data yet."
          items={analytics.browsers}
        />
        <BreakdownList
          title="Countries"
          empty="No location data yet. Open the public page to collect visitor locations."
          items={analytics.countries}
        />
      </div>

      <div className="mt-6 rounded-2xl border border-black/10 p-5">
        <h2 className="text-base font-semibold text-black">Recent visits</h2>
        <p className="mt-1 text-xs text-black/55">Latest page views on the public event URL</p>
        <RecentVisitsTable views={analytics.recentViews} />
      </div>
    </section>
  );
}
