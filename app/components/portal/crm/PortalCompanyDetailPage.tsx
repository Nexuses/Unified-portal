"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatCompanyDate,
  formatRelativeTime,
  groupHistoryByDay,
  type CompanyHistoryEvent,
  type CompanyWithContacts,
} from "@/lib/crm";
import { portalCompanyRoute, PORTAL_ROUTES } from "@/lib/portal-nav";

type CompanyDetailResponse = {
  company: CompanyWithContacts;
  history: CompanyHistoryEvent[];
  navigation: {
    index: number;
    total: number;
    prevId: string | null;
    nextId: string | null;
  };
};

type PortalCompanyDetailPageProps = {
  companyId: string;
};

type DetailTab = "overview" | "history";

function CompanyHistoryTimeline({
  events,
  owner,
  createdAt,
}: {
  events: CompanyHistoryEvent[];
  owner: string;
  createdAt: string;
}) {
  const groups = groupHistoryByDay(events);

  if (events.length === 0) {
    return <p className="cd-empty">No activity yet.</p>;
  }

  return (
    <>
      {groups.map((group) => (
        <div key={group.label}>
          <div className="cd-history-day">{group.label}</div>
          <div className="cd-timeline">
            {group.events.map((event) => (
              <div className="cd-event" key={event.id}>
                <div className="cd-event-rail">
                  <span className="cd-event-dot" />
                </div>
                <div className="cd-event-body">
                  <div className="cd-event-title">{event.title}</div>
                  <div className="cd-event-time">
                    {formatRelativeTime(event.at)}
                    {event.actor ? ` • ${event.actor}` : ""}
                  </div>
                  <div className="company-history-copy">{event.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="cd-foot-note">
        Added by {owner} on {formatCompanyDate(createdAt)}
      </div>
    </>
  );
}

export default function PortalCompanyDetailPage({
  companyId,
}: PortalCompanyDetailPageProps) {
  const router = useRouter();
  const [detail, setDetail] = useState<CompanyDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<DetailTab>("overview");

  useEffect(() => {
    setTab("overview");
  }, [companyId]);

  useEffect(() => {
    async function loadCompany() {
      if (!companyId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/crm/companies/${companyId}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load company");
        }
        setDetail(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load company");
      } finally {
        setLoading(false);
      }
    }

    void loadCompany();
  }, [companyId]);

  const company = detail?.company ?? null;
  const history = detail?.history ?? [];
  const navigation = detail?.navigation;

  const pagerLabel = useMemo(() => {
    if (!navigation || navigation.total === 0) {
      return "0 of 0";
    }
    return `${navigation.index + 1} of ${navigation.total}`;
  }, [navigation]);

  if (loading) {
    return <div className="crm-empty">Loading company...</div>;
  }

  if (error || !company) {
    return (
      <>
        <div className="cd-top">
          <div className="cd-identity">
            <button
              type="button"
              className="cd-back"
              aria-label="Back to companies"
              onClick={() => router.push(PORTAL_ROUTES.companies)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          </div>
        </div>
        <div className="crm-error">{error || "Company not found."}</div>
      </>
    );
  }

  return (
    <>
      <div className="cd-top">
        <div className="cd-identity">
          <button
            type="button"
            className="cd-back"
            aria-label="Back to companies"
            onClick={() => router.push(PORTAL_ROUTES.companies)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div className="cd-avatar company-avatar">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M4 20V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14" />
              <path d="M9 20v-6h6v6" />
              <path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01" />
            </svg>
          </div>
          <div>
            <div className="cd-name-row">
              <h2 className="cd-name">{company.name}</h2>
            </div>
          </div>
        </div>

        <div className="cd-pager">
          <button
            type="button"
            aria-label="Previous company"
            disabled={!navigation?.prevId}
            onClick={() =>
              navigation?.prevId
                ? router.push(portalCompanyRoute(navigation.prevId))
                : undefined
            }
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span>{pagerLabel}</span>
          <button
            type="button"
            aria-label="Next company"
            disabled={!navigation?.nextId}
            onClick={() =>
              navigation?.nextId
                ? router.push(portalCompanyRoute(navigation.nextId))
                : undefined
            }
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="cd-tabs">
        <button
          type="button"
          className={`cd-tab ${tab === "overview" ? "active" : ""}`}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className={`cd-tab ${tab === "history" ? "active" : ""}`}
          onClick={() => setTab("history")}
        >
          History
        </button>
      </div>

      {tab === "history" ? (
        <div className="company-history-panel">
          <div className="company-history-filters">
            <button type="button" className="company-filter-pill active">
              All activities
            </button>
            <button type="button" className="company-filter-pill" disabled>
              Notes
            </button>
            <button type="button" className="company-filter-pill" disabled>
              Files
            </button>
            <button type="button" className="company-filter-pill" disabled>
              Companies
            </button>
            <button type="button" className="company-filter-pill" disabled>
              Contacts
            </button>
            <button type="button" className="company-filter-pill" disabled>
              Conversations
            </button>
          </div>

          <div className="cd-card">
            <CompanyHistoryTimeline
              events={history}
              owner={company.owner}
              createdAt={company.createdAt}
            />
          </div>
        </div>
      ) : (
        <div className="cd-grid">
          <div className="cd-col">
            <div className="cd-card">
              <div className="cd-card-head">
                <h3>Information</h3>
                <button
                  type="button"
                  className="cd-icon-btn"
                  aria-label="More"
                  disabled
                >
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="5" cy="12" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="19" cy="12" r="1.6" />
                  </svg>
                </button>
              </div>
              <div className="cd-field">
                <div className="cd-label">Owner</div>
                <div className="cd-value">
                  <select className="company-owner-select" disabled value={company.owner}>
                    <option value={company.owner}>{company.owner}</option>
                  </select>
                </div>
              </div>
              <div className="cd-field">
                <div className="cd-label">Company name</div>
                <div className="cd-value">{company.name}</div>
              </div>
              <div className="cd-field">
                <div className="cd-label">Domain</div>
                <div className="cd-value">
                  {company.domain ? (
                    <a
                      href={`https://${company.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="company-domain-link"
                    >
                      {company.domain}
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M14 5h5v5M19 5 10 14" />
                        <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
                      </svg>
                    </a>
                  ) : (
                    "—"
                  )}
                </div>
              </div>
              <div className="cd-field">
                <div className="cd-label">Revenue</div>
                <div className="cd-value muted">—</div>
              </div>
              <div className="cd-field">
                <div className="cd-label">Created at</div>
                <div className="cd-value">
                  {formatCompanyDate(company.createdAt)}
                </div>
              </div>
            </div>
          </div>

          <div className="cd-col">
            <div className="cd-card">
              <div className="cd-card-head">
                <h3>Recent history</h3>
              </div>
              <CompanyHistoryTimeline
                events={history.slice(0, 5)}
                owner={company.owner}
                createdAt={company.createdAt}
              />
            </div>
          </div>

          <div className="cd-col right">
            <div className="cd-card">
              <div className="cd-card-head">
                <h3>Contacts ({company.contacts.length})</h3>
                <button
                  type="button"
                  className="cd-icon-btn"
                  aria-label="Edit contacts"
                  disabled
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </button>
              </div>
              {company.contacts.length === 0 ? (
                <p className="cd-empty">No contacts associated with this company.</p>
              ) : (
                <ul className="company-detail-contacts">
                  {company.contacts.map((contact) => (
                    <li key={contact.id}>
                      <div className="company-detail-contact-name">
                        {contact.fullName}
                      </div>
                      <div className="company-detail-contact-email">
                        {contact.email}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
