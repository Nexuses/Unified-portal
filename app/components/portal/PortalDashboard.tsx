"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

type PortalDashboardProps = {
  firstName: string;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

export default function PortalDashboard({ firstName }: PortalDashboardProps) {
  const today = new Date();
  const [viewDate, setViewDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );

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

  return (
    <>
      <div className="home-head">
        <h2>Hello {firstName}</h2>
        <button className="btn-customize" type="button">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <rect x="3" y="3" width="7" height="7" rx="1.2" />
            <rect x="14" y="3" width="7" height="7" rx="1.2" />
            <rect x="3" y="14" width="7" height="7" rx="1.2" />
            <rect x="14" y="14" width="7" height="7" rx="1.2" />
          </svg>
          Customize page
        </button>
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
            <h3>Planned for today</h3>
            <Link href={PORTAL_ROUTES.drip} className="btn-campaign">
              Create campaign
            </Link>
          </div>
          <div className="planned-empty">Nothing planned for today</div>
          <div className="tip-row">
            <div className="tip-card">
              <div className="tip-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="8" r="3.2" />
                  <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
                </svg>
              </div>
              <h4>Do you have new contacts to organize?</h4>
              <p>
                Use segmentation to send personalized messages and organize
                your contacts.
              </p>
              <Link href={PORTAL_ROUTES.segments} className="link-purple">
                Segment contacts →
              </Link>
            </div>
            <div className="tip-card">
              <div className="tip-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 2 11 13" />
                  <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
                </svg>
              </div>
              <h4>Expand your reach with sign-up forms</h4>
              <p>
                Grow your audience, convert website visitors to subscribers,
                and collect valuable information.
              </p>
              <button type="button" className="link-purple">
                Create sign-up form →
              </button>
            </div>
          </div>
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
              <div className="num">0</div>
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
              <div className="num">0</div>
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
              <span className="meta">No usage data yet</span>
            </div>
            <div className="usage-bar">
              <div style={{ width: "0%" }} />
            </div>
          </div>
          <div className="usage-plain">
            <span>Prepaid credits</span>
            <span>0 credits left</span>
          </div>
          <div className="usage-plain">
            <span>SMS</span>
            <span>0 credits left</span>
          </div>
          <div className="home-card-foot">
            <button type="button" className="link-blue">
              Manage your plan
            </button>
          </div>
        </div>

        <div className="home-card">
          <div className="home-card-head">
            <h3>Your last campaigns</h3>
            <Link href={PORTAL_ROUTES.drip} className="link-blue">
              Create a campaign
            </Link>
          </div>
          <div className="planned-empty">No campaigns yet</div>
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
          <Link href={PORTAL_ROUTES.oneone} className="btn">
            Create automation
          </Link>
        </div>
      </div>
    </>
  );
}
