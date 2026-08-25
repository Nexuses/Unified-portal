"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  formatCampaignClock,
  formatMetric,
  getDripCampaign,
  mergeBlastReport,
  type DripCampaign,
} from "@/lib/drip-campaigns";
import { PORTAL_ROUTES, portalListRoute } from "@/lib/portal-nav";

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5S14.4 16 15 19" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M16.2 19c.3-1.8 1.5-3.1 3.3-3.6" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.4 2.4 0 1 1 3.3 2.2c-.7.4-1.1.8-1.1 1.6" />
      <circle cx="12" cy="16.6" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TimelineIcon({ type }: { type: "draft" | "scheduled" | "sent" }) {
  if (type === "sent") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="m22 2-7 20-4-9-9-4Z" strokeLinejoin="round" />
        <path d="M22 2 11 13" />
      </svg>
    );
  }
  if (type === "scheduled") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3.5" y="5" width="17" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M3.5 10h17" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function rate(value: number, total: number) {
  return formatMetric(value, total).pct;
}

export default function PortalCampaignReport({
  campaign,
  onCampaignChange,
}: {
  campaign: DripCampaign;
  onCampaignChange?: (campaign: DripCampaign) => void;
}) {
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        await fetch("/api/campaigns/process-due", { method: "POST" });
        const response = await fetch("/api/campaigns/stats");
        const data = await response.json();
        if (cancelled || !response.ok) {
          return;
        }
        const report = (
          data.reports as Array<Parameters<typeof mergeBlastReport>[1]>
        ).find((item) => item.campaignId === campaign.id);
        const current = getDripCampaign(campaign.id);
        if (report && current && onCampaignChange) {
          onCampaignChange(mergeBlastReport(current, report));
        }
      } catch {
        // Keep showing the last known stats.
      }
    }

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [campaign.id]);

  const timezone = campaign.timezone || "Asia/Kolkata";
  const sentLabel = campaign.sentAt
    ? formatCampaignClock(campaign.sentAt, timezone)
    : campaign.scheduledAt
      ? formatCampaignClock(campaign.scheduledAt, timezone)
      : "";
  const from = campaign.senderName
    ? `${campaign.senderName} <${campaign.senderEmail}>`
    : campaign.senderEmail;
  const replyTo = campaign.replyToEnabled
    ? campaign.replyToEmail
    : campaign.senderEmail;
  const delivered = campaign.delivered ?? campaign.recipients;
  const metrics = [
    {
      label: "Delivered",
      value: delivered,
      rateLabel: "Delivery rate",
      rate: rate(delivered, campaign.recipients || delivered),
      view: true,
    },
    {
      label: "Opens",
      value: campaign.opens,
      rateLabel: "Open rate",
      rate: rate(campaign.opens, campaign.recipients),
      view: true,
    },
    {
      label: "Clicks",
      value: campaign.clicks,
      rateLabel: "Click-through rate",
      rate: rate(campaign.clicks, campaign.recipients),
      view: true,
    },
    {
      label: "Conversions",
      value: campaign.conversions,
      rateLabel: "Conversion rate",
      rate: rate(campaign.conversions, campaign.recipients),
      view: false,
    },
    {
      label: "Unsubscribes",
      value: campaign.unsubscribed,
      rateLabel: "Unsubscribe rate",
      rate: rate(campaign.unsubscribed, campaign.recipients),
      view: true,
    },
  ];

  const timeline = [...(campaign.timeline ?? [])].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );

  return (
    <div className="drip-report-page">
      <div className="drip-report-head">
        <Link href={PORTAL_ROUTES.drip} className="drip-back" aria-label="Back to campaigns">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <div className="drip-report-thumb">
          {campaign.designHtml ? (
            <iframe title="Campaign preview" srcDoc={campaign.designHtml} />
          ) : null}
        </div>
        <div className="drip-report-head-copy">
          <h2>{campaign.name}</h2>
          <div className="drip-report-meta">
            #{campaign.id}
            {sentLabel ? ` • Sent on ${sentLabel}` : campaign.status === "scheduled" ? " • Scheduled" : ""}
          </div>
          <div className="drip-report-fields">
            <div>
              <span>Subject</span>
              <strong>{campaign.subject}</strong>
            </div>
            <div>
              <span>From</span>
              <strong title={from}>{from}</strong>
            </div>
            <div>
              <span>Reply to</span>
              <strong title={replyTo}>{replyTo}</strong>
            </div>
          </div>
        </div>
        <div className="drip-report-actions">
          <button type="button" className="drip-report-share" aria-label="Share">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <path d="m8.7 13.4 6.6 3.8M15.3 6.8 8.7 10.6" />
            </svg>
          </button>
          <button type="button" className="drip-report-export">
            Export report
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="drip-report-tabs">
        {["Overview", "Deliverability", "Opens", "Clicks", "Conversions", "Unsubscribes"].map(
          (label) => (
            <button
              key={label}
              type="button"
              className={tab === label.toLowerCase() ? "active" : ""}
              onClick={() => setTab(label.toLowerCase())}
            >
              {label}
            </button>
          ),
        )}
      </div>

      <div className="drip-report-section-head">
        <h3>Campaign performance</h3>
        <span>
          • Automated opens and clicks included.
          <HelpIcon />
        </span>
      </div>

      <div className="drip-report-metrics">
        {metrics.map((metric) => (
          <div key={metric.label} className="drip-report-metric">
            <div className="drip-report-metric-k">{metric.label}</div>
            <div className="drip-report-metric-row">
              <div className="drip-report-metric-v">{metric.value}</div>
              {metric.view ? (
                <button type="button" className="drip-report-view">
                  <PeopleIcon />
                  View
                </button>
              ) : null}
            </div>
            <div className="drip-report-metric-rate">
              {metric.rateLabel}
              <strong>{metric.rate}</strong>
            </div>
          </div>
        ))}
      </div>

      <h3 className="drip-report-audience-title">Campaign audience</h3>
      <div className="drip-report-lists-label">
        Included lists
        <span className="drip-report-plus">+</span>
      </div>
      <div className="drip-report-list-card">
        <div>
          {campaign.listDisplayId ? `#${campaign.listDisplayId} ` : ""}
          {campaign.listName || "Selected recipients"}
        </div>
        <div>{campaign.recipients} contacts</div>
        {campaign.listId ? (
          <Link href={portalListRoute(campaign.listId)} className="drip-report-view">
            <PeopleIcon />
            View
          </Link>
        ) : (
          <span className="drip-report-view">
            <PeopleIcon />
            View
          </span>
        )}
      </div>

      <h3 className="drip-report-audience-title">Timeline</h3>
      <div className="drip-report-timeline">
        {timeline.length === 0 ? (
          <div className="drip-report-empty">No timeline events yet.</div>
        ) : (
          timeline.map((event) => (
            <div key={event.id} className="drip-report-event">
              <div className="drip-report-event-icon">
                <TimelineIcon type={event.type} />
              </div>
              <div>
                <div className="drip-report-event-title">{event.title}</div>
                <div className="drip-report-event-copy">{event.description}</div>
                <div className="drip-report-event-at">
                  {formatCampaignClock(event.at, timezone)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
