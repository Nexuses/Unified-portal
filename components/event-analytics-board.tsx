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
    <div className="perf-metric">
      <div className="perf-metric-label">{label}</div>
      <div className="perf-metric-value">{value}</div>
      {hint ? <div className="perf-metric-compare">{hint}</div> : null}
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
    <div className="event-portal-card">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="event-portal-empty">{empty}</p>
      ) : (
        <div className="event-portal-bars">
          {items.map((item) => (
            <div key={`${title}-${item.name}`}>
              <div className="event-portal-bar-row">
                <span>{item.name}</span>
                <strong>{item.count}</strong>
              </div>
              <div className="event-portal-bar-track">
                <div style={{ width: `${Math.max(6, (item.count / max) * 100)}%` }} />
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
    <div className="event-portal-page">
      <div className="crm-page-head drip-page-head">
        <div className="drip-detail-title-wrap">
          <Link href="/portal/marketing/events" className="drip-back" aria-label="Back to events">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <div>
            <h2>{eventName}</h2>
            <p>
              Analytics for{" "}
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                /{publicId}
              </a>
            </p>
          </div>
        </div>
        <div className="crm-actions">
          <Link href={`/portal/marketing/events/${eventId}`} className="btn-soft">
            Open event
          </Link>
          <Link href={`/portal/marketing/events/${eventId}/submissions`} className="btn-soft">
            Submissions
          </Link>
        </div>
      </div>

      <div className="event-portal-body">
      <div className="perf-metrics event-portal-stats">
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

      <div className="event-portal-card">
        <h3>Views last 14 days</h3>
        <p className="event-portal-empty">Daily page views on the public URL</p>
        <div className="event-analytics-chart">
          {analytics.daily.map((day) => (
            <div key={day.date}>
              <div className="event-analytics-chart-col">
                <div
                  style={{
                    height: `${Math.max(day.views > 0 ? 8 : 2, (day.views / maxDailyViews) * 100)}%`,
                    opacity: day.views > 0 ? 1 : 0.25,
                  }}
                  title={`${day.date}: ${day.views} views, ${day.visitors} visitors`}
                />
              </div>
              <span>{formatDayLabel(day.date)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="event-portal-grid">
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

      <div className="event-portal-card">
        <h3>Recent visits</h3>
        <p className="event-portal-empty">Latest page views on the public event URL</p>
        <RecentVisitsTable views={analytics.recentViews} />
      </div>
      </div>
    </div>
  );
}
