"use client";

import Link from "next/link";
import {
  Children,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Contact } from "@/lib/crm";
import type { CampaignStatus, DripCampaign } from "@/lib/drip-campaigns";
import { DEFAULT_PROJECT_SENDING_LIMIT } from "@/lib/projects";
import {
  PORTAL_ROUTES,
  portalCampaignRoute,
  portalContactRoute,
} from "@/lib/portal-nav";
import type { ActivityFeedItem } from "@/lib/activity-feed-server";

const SENDER_SOFT_LIMIT = 10;

type PortalDashboardProps = {
  firstName: string;
};

const PLANNED_PER_VIEW = 2;
const PLANNED_AUTOPLAY_MS = 5000;
const ACTIVITY_HOME_LIMIT = 12;

function UsageBar({ value }: { value: number }) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    setWidth(0);
    let frame2 = 0;
    const frame1 = window.requestAnimationFrame(() => {
      frame2 = window.requestAnimationFrame(() => {
        setWidth(Math.max(0, Math.min(100, value)));
      });
    });
    return () => {
      window.cancelAnimationFrame(frame1);
      window.cancelAnimationFrame(frame2);
    };
  }, [value]);

  return (
    <div className="usage-bar">
      <div className="usage-bar-fill" style={{ width: `${width}%` }} />
    </div>
  );
}

function formatActivityWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function activityHref(item: ActivityFeedItem) {
  if (item.contactId) {
    return portalContactRoute(item.contactId);
  }
  if (item.campaignId) {
    return portalCampaignRoute(item.campaignId, item.campaignKind);
  }
  if (item.type === "list_created" || item.listId) {
    return PORTAL_ROUTES.lists;
  }
  return PORTAL_ROUTES.activity;
}

function activityBadge(item: ActivityFeedItem) {
  switch (item.type) {
    case "campaign_opened":
      return { label: "Opened", className: "is-open" };
    case "campaign_clicked":
      return { label: "Clicked", className: "is-click" };
    case "campaign_launched":
      return { label: "Rolled out", className: "is-launch" };
    case "campaign_scheduled":
      return { label: "Scheduled", className: "is-schedule" };
    case "campaign_created":
      return { label: "Created", className: "is-create" };
    default:
      return { label: "Activity", className: "is-other" };
  }
}

function PlannedCarousel({ children, count }: { children: ReactNode; count: number }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const pageCount = Math.ceil(count / PLANNED_PER_VIEW);
  const slides = useMemo(() => {
    const list = Children.toArray(children);
    const chunks: ReactNode[][] = [];
    for (let i = 0; i < list.length; i += PLANNED_PER_VIEW) {
      chunks.push(list.slice(i, i + PLANNED_PER_VIEW));
    }
    return chunks;
  }, [children]);

  function currentPage() {
    const track = trackRef.current;
    if (!track || track.clientWidth <= 0) {
      return 0;
    }
    return Math.round(track.scrollLeft / track.clientWidth);
  }

  function goTo(next: number) {
    const track = trackRef.current;
    if (!track || pageCount < 1) {
      return;
    }
    const target = ((next % pageCount) + pageCount) % pageCount;
    track.scrollTo({ left: target * track.clientWidth, behavior: "smooth" });
    setPage(target);
  }

  useEffect(() => {
    if (paused || pageCount < 2) {
      return;
    }
    const timer = window.setInterval(() => {
      const track = trackRef.current;
      if (!track || track.clientWidth <= 0) {
        return;
      }
      const next = (Math.round(track.scrollLeft / track.clientWidth) + 1) % pageCount;
      track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
      setPage(next);
    }, PLANNED_AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [paused, pageCount]);

  return (
    <div
      className="planned-carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        ref={trackRef}
        className="planned-track"
        onScroll={() => setPage(currentPage())}
      >
        {slides.map((slideItems, index) => (
          <div key={`planned-page-${index}`} className="planned-page">
            {slideItems}
          </div>
        ))}
      </div>
      {pageCount > 1 ? (
        <div className="planned-controls planned-controls-arrows-only">
          <div className="planned-arrows">
            <button type="button" aria-label="Previous" onClick={() => goTo(page - 1)}>
              ‹
            </button>
            <button type="button" aria-label="Next" onClick={() => goTo(page + 1)}>
              ›
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_MS = 24 * 60 * 60 * 1000;

function buildCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;
  const days: Array<{ day: number; muted: boolean }> = [];

  for (let cell = 0; cell < totalCells; cell += 1) {
    if (cell < startOffset) {
      const date = new Date(year, month, cell - startOffset + 1);
      days.push({ day: date.getDate(), muted: true });
      continue;
    }

    const day = cell - startOffset + 1;
    if (day <= lastDay.getDate()) {
      days.push({ day, muted: false });
      continue;
    }

    days.push({ day: day - lastDay.getDate(), muted: true });
  }

  return days;
}

function formatCount(value: number) {
  return value.toLocaleString("en-US");
}

function campaignTimestamp(campaign: DripCampaign) {
  const raw =
    campaign.sentAt ||
    campaign.updatedAt ||
    campaign.scheduledAt ||
    campaign.createdAt;
  const ms = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function formatCampaignDate(campaign: DripCampaign) {
  const ms = campaignTimestamp(campaign);
  if (!ms) {
    return "No date";
  }
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  paused: "Paused",
};
function sentFromReport(report: { delivered?: number; recipients?: number }) {
  const delivered = Number(report.delivered);
  if (Number.isFinite(delivered) && delivered > 0) {
    return delivered;
  }
  const recipients = Number(report.recipients);
  return Number.isFinite(recipients) ? recipients : 0;
}

export default function PortalDashboard({ firstName }: PortalDashboardProps) {
  const today = new Date();
  const [viewDate, setViewDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [contactTotal, setContactTotal] = useState<number | null>(null);
  const [contactsLast30Days, setContactsLast30Days] = useState<number | null>(
    null,
  );
  const [emailsSent, setEmailsSent] = useState<number | null>(null);
  const [sendingLimit, setSendingLimit] = useState(DEFAULT_PROJECT_SENDING_LIMIT);
  const [dripEmailsSent, setDripEmailsSent] = useState<number | null>(null);
  const [oneOneEmailsSent, setOneOneEmailsSent] = useState<number | null>(null);
  const [senderCount, setSenderCount] = useState<number | null>(null);
  const [lastCampaigns, setLastCampaigns] = useState<DripCampaign[] | null>(
    null,
  );
  const [recentActivity, setRecentActivity] = useState<ActivityFeedItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadContacts() {
      try {
        const cutoff = new Date(Date.now() - 30 * DAY_MS).toISOString();
        const [totalResponse, recentResponse] = await Promise.all([
          fetch("/api/crm/contacts?page=1&pageSize=1"),
          fetch(
            `/api/crm/contacts?page=1&pageSize=1&createdAfter=${encodeURIComponent(cutoff)}`,
          ),
        ]);
        const totalData = (await totalResponse.json()) as
          | { total?: number; error?: string }
          | Contact[];
        const recentData = (await recentResponse.json()) as
          | { total?: number; error?: string }
          | Contact[];
        if (!totalResponse.ok || Array.isArray(totalData) || typeof totalData.total !== "number") {
          return;
        }
        if (cancelled) {
          return;
        }

        setContactTotal(totalData.total);
        setContactsLast30Days(
          recentResponse.ok && !Array.isArray(recentData) && typeof recentData.total === "number"
            ? recentData.total
            : 0,
        );
      } catch {
        // Keep placeholder zeros if the request fails.
      }
    }

    async function loadUsage() {
      try {
        const [statsResponse, sendersResponse, meResponse] = await Promise.all([
          fetch("/api/campaigns/stats"),
          fetch("/api/smtp/senders"),
          fetch("/api/auth/me"),
        ]);
        const statsData = (await statsResponse.json()) as {
          reports?: Array<{
            kind?: "drip" | "oneone";
            delivered?: number;
            recipients?: number;
          }>;
        };
        const sendersData = (await sendersResponse.json()) as unknown;
        const meData = (await meResponse.json()) as {
          sendingLimit?: number;
          error?: string;
        };

        if (cancelled) {
          return;
        }

        if (
          meResponse.ok &&
          typeof meData.sendingLimit === "number" &&
          meData.sendingLimit > 0
        ) {
          setSendingLimit(meData.sendingLimit);
        }

        if (statsResponse.ok && Array.isArray(statsData.reports)) {
          let dripTotal = 0;
          let oneOneTotal = 0;
          for (const report of statsData.reports) {
            const count = sentFromReport(report);
            if (report.kind === "oneone") {
              oneOneTotal += count;
            } else {
              dripTotal += count;
            }
          }
          setDripEmailsSent(dripTotal);
          setOneOneEmailsSent(oneOneTotal);
          setEmailsSent(dripTotal + oneOneTotal);
        }

        if (sendersResponse.ok && Array.isArray(sendersData)) {
          setSenderCount(sendersData.length);
        }
      } catch {
        // Keep placeholders if usage requests fail.
      }
    }

    async function loadLastCampaigns() {
      try {
        const response = await fetch("/api/campaigns");
        const data = (await response.json()) as
          | DripCampaign[]
          | { error?: string };
        if (!response.ok || !Array.isArray(data)) {
          return;
        }
        if (cancelled) {
          return;
        }

        const latest = data
          .filter((campaign) => campaign.status === "sent")
          .sort((a, b) => campaignTimestamp(b) - campaignTimestamp(a))
          .slice(0, 3);
        setLastCampaigns(latest);
      } catch {
        // Keep the empty state if campaigns fail to load.
      }
    }

    async function loadRecentActivity() {
      try {
        const response = await fetch(
          `/api/activity?group=engagement&page=1&pageSize=${ACTIVITY_HOME_LIMIT}`,
          { cache: "no-store" },
        );
        const data = (await response.json()) as {
          items?: ActivityFeedItem[];
          error?: string;
        };
        if (!response.ok || !Array.isArray(data.items) || cancelled) {
          return;
        }
        setRecentActivity(data.items);
      } catch {
        // Keep empty activity if the feed fails.
      }
    }

    void loadContacts();
    void loadUsage();
    void loadLastCampaigns();
    void loadRecentActivity();
    return () => {
      cancelled = true;
    };
  }, []);

  const activityCards = recentActivity.map((item) => {
    const badge = activityBadge(item);
    const who = item.fullName || item.email || item.title;
    const detail =
      item.campaignName ||
      item.description ||
      (item.type === "campaign_clicked" ? "Clicked a link" : item.title);
    return (
      <Link
        key={item.id}
        href={activityHref(item)}
        className="tip-card planned-card home-activity-card"
      >
        <div className="home-activity-top">
          <span className={`home-activity-badge ${badge.className}`}>
            {badge.label}
          </span>
          <span className="home-activity-when">{formatActivityWhen(item.at)}</span>
        </div>
        <h4>{who}</h4>
        <p>{detail}</p>
        <span className="link-purple">View →</span>
      </Link>
    );
  });

  const calendarDays = useMemo(
    () => buildCalendarDays(viewDate.getFullYear(), viewDate.getMonth()),
    [viewDate],
  );

  const monthLabel = viewDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  function shiftMonth(delta: number) {
    setViewDate(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + delta, 1),
    );
  }

  const isToday = (day: number, muted: boolean) =>
    !muted &&
    day === today.getDate() &&
    viewDate.getMonth() === today.getMonth() &&
    viewDate.getFullYear() === today.getFullYear();

  const totalLabel =
    contactTotal === null ? "…" : formatCount(contactTotal);
  const recentLabel =
    contactsLast30Days === null ? "…" : formatCount(contactsLast30Days);
  const emailsSentValue = emailsSent ?? 0;
  const senderCountValue = senderCount ?? 0;
  const emailsMeta =
    emailsSent === null
      ? "…"
      : `${formatCount(emailsSentValue)} / ${formatCount(sendingLimit)}`;
  const sendersMeta =
    senderCount === null ? "…" : formatCount(senderCountValue);
  const emailsBarWidth =
    emailsSent === null
      ? 0
      : Math.min(100, (emailsSentValue / Math.max(sendingLimit, 1)) * 100);
  const sendersBarWidth =
    senderCount === null
      ? 0
      : Math.min(100, (senderCountValue / SENDER_SOFT_LIMIT) * 100);
  const dripSentLabel =
    dripEmailsSent === null ? "…" : formatCount(dripEmailsSent);
  const oneOneSentLabel =
    oneOneEmailsSent === null ? "…" : formatCount(oneOneEmailsSent);

  return (
    <>
      <div className="home-head">
        <h2>Hello {firstName}</h2>
      </div>

      <div className="planner">
        <div className="planner-cal">
          <div className="cal-head">
            <button
              type="button"
              className="cal-nav"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <div className="cal-title">{monthLabel}</div>
            <button
              type="button"
              className="cal-nav"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
          <div className="cal-grid">
            {WEEKDAYS.map((day) => (
              <div key={day} className="cal-dow">
                {day}
              </div>
            ))}
            {calendarDays.map((entry, index) => (
              <div
                key={`${entry.day}-${index}`}
                className={`cal-day${entry.muted ? " muted" : ""}${isToday(entry.day, entry.muted) ? " today" : ""}`}
              >
                <span className="num">{entry.day}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="planner-day">
          <div className="planner-day-head">
            <h3>Recent activity</h3>
            <Link href={PORTAL_ROUTES.activity} className="link-purple">
              View all →
            </Link>
          </div>
          {activityCards.length > PLANNED_PER_VIEW ? (
            <PlannedCarousel count={activityCards.length}>
              {activityCards}
            </PlannedCarousel>
          ) : activityCards.length > 0 ? (
            <div className="tip-row home-activity-row">{activityCards}</div>
          ) : (
            <div className="planned-empty">No opens or clicks yet</div>
          )}
        </div>
      </div>

      <div className="home-grid">
        <div className="home-card">
          <div className="home-card-head">
            <h3>Your contacts</h3>
            <Link href={PORTAL_ROUTES.contacts} className="link-blue">
              Add contact
            </Link>
          </div>
          <div className="contact-stat">
            <div>
              <div className="num">{totalLabel}</div>
              <div className="lbl">Total contacts</div>
            </div>
            <div className="contact-stat-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="9" cy="8" r="3" />
                <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" />
                <path d="M17 8v6M14 11h6" />
              </svg>
            </div>
          </div>
          <div className="contact-stat">
            <div>
              <div className="num">{recentLabel}</div>
              <div className="lbl">New contacts over the last 30 days</div>
            </div>
            <div className="contact-stat-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="9" cy="8" r="3" />
                <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" />
                <path d="M17 8v6M14 11h6" />
              </svg>
            </div>
          </div>
          <div className="home-card-foot">
            <Link href={PORTAL_ROUTES.contacts} className="link-blue">
              Go to Contacts
            </Link>
          </div>
        </div>

        <div className="home-card">
          <div className="home-card-head">
            <h3>Your plan usage</h3>
          </div>
          <div className="usage-row">
            <div className="top">
              <span className="label">Emails</span>
              <span className="meta">{emailsMeta}</span>
            </div>
            <UsageBar value={emailsBarWidth} />
          </div>
          <div className="usage-row">
            <div className="top">
              <span className="label">Senders</span>
              <span className="meta">{sendersMeta}</span>
            </div>
            <UsageBar value={sendersBarWidth} />
          </div>
          <div className="usage-split">
            <div>
              <div className="num">{dripSentLabel}</div>
              <div className="lbl">Drip emails sent</div>
            </div>
            <div>
              <div className="num">{oneOneSentLabel}</div>
              <div className="lbl">1-1 emails sent</div>
            </div>
          </div>
          <div className="home-card-foot">
            <Link href={PORTAL_ROUTES.smtp} className="link-blue">
              Go to SMTP
            </Link>
          </div>
        </div>

        <div className="home-card">
          <div className="home-card-head">
            <h3>Your last campaigns</h3>
            <Link href={PORTAL_ROUTES.drip} className="link-blue">
              Create a campaign
            </Link>
          </div>
          {lastCampaigns && lastCampaigns.length > 0 ? (
            <div className="camp-list">
              {lastCampaigns.map((campaign) => {
                const recipients = campaign.delivered ?? campaign.recipients ?? 0;
                return (
                  <Link
                    key={`${campaign.kind ?? "drip"}-${campaign.id}`}
                    href={portalCampaignRoute(campaign.id, campaign.kind)}
                    className="camp-row"
                  >
                    <div>
                      <div className="camp-name">{campaign.name}</div>
                      <div className="camp-meta">{formatCampaignDate(campaign)}</div>
                    </div>
                    <div className="camp-tags">
                      <span className={`status-sent ${campaign.status}`}>
                        <i />
                        {STATUS_LABELS[campaign.status]}
                      </span>
                      <span className="type-pill">
                        {campaign.kind === "oneone" ? "1-1" : "Drip"}
                      </span>
                    </div>
                    <div className="camp-metrics">
                      <div>
                        <div className="k">Recipients</div>
                        <div className="v">{formatCount(recipients)}</div>
                      </div>
                      <div>
                        <div className="k">Opens</div>
                        <div className="v">{formatCount(campaign.opens ?? 0)}</div>
                      </div>
                      <div>
                        <div className="k">Clicks</div>
                        <div className="v">{formatCount(campaign.clicks ?? 0)}</div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="planned-empty">No campaigns yet</div>
          )}
          <div className="home-card-foot">
            <Link href={PORTAL_ROUTES.drip} className="link-blue">
              Go to Campaigns
            </Link>
          </div>
        </div>

        <div className="auto-card">
          <div>
            <div className="auto-illu">
              <div className="env" />
            </div>
            <h3>Deliver the right message at the right time</h3>
            <p>
              Strengthen your connection with contacts by sending automated
              personalized messages.
            </p>
          </div>
          <Link href={PORTAL_ROUTES.automation} className="btn">
            Create automation
          </Link>
        </div>
      </div>
    </>
  );
}
