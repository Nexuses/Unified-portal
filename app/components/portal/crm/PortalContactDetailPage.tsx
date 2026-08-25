"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatCompanyDate,
  formatListDate,
  formatRelativeTime,
  groupHistoryByDay,
  type ContactCampaignStats,
  type ContactDetail,
  type ContactHistoryEvent,
  type ContactListMembership,
} from "@/lib/crm";
import {
  portalCompanyRoute,
  portalContactRoute,
  portalListRoute,
  PORTAL_ROUTES,
} from "@/lib/portal-nav";

type PortalContactDetailPageProps = {
  contactId: string;
};

type DetailTab = "overview" | "history" | "lists" | "preferences";

function pct(part: number, total: number) {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.round((part / total) * 100)}%`;
}

function ContactEventDescription({ event }: { event: ContactHistoryEvent }) {
  if (event.type === "company_associated" && event.companyId) {
    return (
      <div className="company-history-copy">
        This contact has been associated to the company:{" "}
        <Link href={portalCompanyRoute(event.companyId)} className="contact-history-link">
          {event.companyName}
        </Link>
      </div>
    );
  }

  if (event.type === "list_added" && event.listId) {
    return (
      <div className="company-history-copy">
        <Link href={portalListRoute(event.listId)} className="contact-history-link">
          (#{event.listDisplayId}) {event.listName}
        </Link>
      </div>
    );
  }

  if (event.type === "import" && event.importFileName) {
    return (
      <div className="company-history-copy">
        Added via a contacts import by {event.actor}: via the file{" "}
        <strong>{event.importFileName}</strong>
      </div>
    );
  }

  if (event.type === "campaign_sent" || event.type === "campaign_delivered") {
    return <div className="company-history-copy">{event.description}</div>;
  }

  return <div className="company-history-copy">{event.description}</div>;
}

function ContactHistoryTimeline({
  events,
  contact,
}: {
  events: ContactHistoryEvent[];
  contact: ContactDetail;
}) {
  const groups = groupHistoryByDay(events);
  const importEvent = events.find((event) => event.type === "import" && event.importFileName);

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
                  <ContactEventDescription event={event} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="cd-foot-note">
        {importEvent
          ? `Added via a contacts import on ${formatCompanyDate(contact.createdAt)}`
          : `Added on ${formatCompanyDate(contact.createdAt)}`}
      </div>
    </>
  );
}

function ContactListsPanel({
  lists,
  folder,
}: {
  lists: ContactListMembership[];
  folder: string;
}) {
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [page, setPage] = useState(1);

  const total = lists.length;
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const startIndex = total === 0 ? 0 : (safePage - 1) * rowsPerPage;
  const endIndex = Math.min(startIndex + rowsPerPage, total);
  const pageLists = lists.slice(startIndex, endIndex);

  useEffect(() => {
    setPage(1);
  }, [lists.length, rowsPerPage]);

  return (
    <div className="contact-lists-panel">
      <Link href={PORTAL_ROUTES.lists} className="link-purple contact-manage-lists">
        Manage lists
      </Link>

      <div className="data-table-wrap contact-lists-table-wrap">
        <table className="data-table contact-lists-table">
          <thead>
            <tr>
              <th>Lists</th>
              <th>ID</th>
              <th>Folder</th>
              <th>Creation date</th>
            </tr>
          </thead>
          <tbody>
            {total === 0 ? (
              <tr>
                <td colSpan={4} className="crm-empty">
                  This contact is not in any list yet.
                </td>
              </tr>
            ) : (
              pageLists.map((list) => (
                <tr key={list.id}>
                  <td>
                    <Link href={portalListRoute(list.id)} className="name-link">
                      {list.name}
                    </Link>
                  </td>
                  <td className="id-cell">#{list.displayId}</td>
                  <td>{folder}</td>
                  <td>{formatListDate(list.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="contact-lists-footer">
          <div className="contact-lists-footer-group">
            <span className="contact-lists-footer-label">Rows per page</span>
            <select
              className="contact-lists-select"
              value={rowsPerPage}
              onChange={(event) => setRowsPerPage(Number(event.target.value))}
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <span className="contact-lists-range">
            {total === 0 ? "0-0 of 0" : `${startIndex + 1}-${endIndex} of ${total}`}
          </span>

          <div className="contact-lists-footer-group">
            <select
              className="contact-lists-select"
              value={safePage}
              onChange={(event) => setPage(Number(event.target.value))}
              disabled={totalPages <= 1}
            >
              {Array.from({ length: totalPages }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {index + 1} of {totalPages} pages
                </option>
              ))}
            </select>
            <div className="contact-lists-nav">
              <button
                type="button"
                aria-label="Previous page"
                disabled={safePage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Next page"
                disabled={safePage >= totalPages}
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CampaignStatsBar({ stats }: { stats: ContactCampaignStats }) {
  const items = [
    { label: "Sent", value: stats.sent, pct: null as string | null },
    {
      label: "Delivered",
      value: stats.delivered,
      pct: pct(stats.delivered, stats.sent),
    },
    {
      label: "Unique opening",
      value: stats.opens,
      pct: pct(stats.opens, stats.sent),
    },
    {
      label: "Unique clicks",
      value: stats.clicks,
      pct: pct(stats.clicks, stats.sent),
    },
  ];

  return (
    <div className="cd-stats">
      {items.map((item) => (
        <div className="cd-stat" key={item.label}>
          <div className="k">{item.label}</div>
          <div className="v">
            {item.pct ? `${item.pct} (${item.value})` : item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PortalContactDetailPage({
  contactId,
}: PortalContactDetailPageProps) {
  const router = useRouter();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<DetailTab>("overview");

  useEffect(() => {
    setTab("overview");
  }, [contactId]);

  useEffect(() => {
    async function loadContact() {
      if (!contactId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/crm/contacts/${contactId}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load contact");
        }
        setContact(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load contact");
      } finally {
        setLoading(false);
      }
    }

    void loadContact();
  }, [contactId]);

  const navigation = contact?.navigation;

  const pagerLabel = useMemo(() => {
    if (!navigation || navigation.total === 0) {
      return "0 of 0";
    }
    return `${navigation.index + 1} of ${navigation.total}`;
  }, [navigation]);

  const nonCampaignHistory = useMemo(
    () =>
      (contact?.history ?? []).filter(
        (event) =>
          event.type !== "campaign_sent" && event.type !== "campaign_delivered",
      ),
    [contact?.history],
  );

  if (loading) {
    return <div className="crm-empty">Loading contact...</div>;
  }

  if (error || !contact) {
    return (
      <>
        <div className="cd-top">
          <div className="cd-identity">
            <button
              type="button"
              className="cd-back"
              aria-label="Back to contacts"
              onClick={() => router.push(PORTAL_ROUTES.contacts)}
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
        <div className="crm-error">{error || "Contact not found."}</div>
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
            aria-label="Back to contacts"
            onClick={() => router.push(PORTAL_ROUTES.contacts)}
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
          <div className="cd-avatar">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
            </svg>
          </div>
          <div>
            <div className="cd-name-row">
              <h2 className="cd-name">{contact.fullName}</h2>
              {contact.companyName ? (
                contact.company?.id ? (
                  <Link
                    href={portalCompanyRoute(contact.company.id)}
                    className="cd-role"
                  >
                    {contact.companyName}
                  </Link>
                ) : (
                  <span className="cd-role">{contact.companyName}</span>
                )
              ) : null}
            </div>
          </div>
        </div>

        <div className="cd-pager">
          <button
            type="button"
            aria-label="Previous contact"
            disabled={!navigation?.prevId}
            onClick={() =>
              navigation?.prevId
                ? router.push(portalContactRoute(navigation.prevId))
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
            aria-label="Next contact"
            disabled={!navigation?.nextId}
            onClick={() =>
              navigation?.nextId
                ? router.push(portalContactRoute(navigation.nextId))
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
        <button
          type="button"
          className={`cd-tab ${tab === "lists" ? "active" : ""}`}
          onClick={() => setTab("lists")}
        >
          Lists
          {contact.lists.length > 0 ? (
            <span className="badge">{contact.lists.length}</span>
          ) : null}
        </button>
        <button
          type="button"
          className={`cd-tab ${tab === "preferences" ? "active" : ""}`}
          onClick={() => setTab("preferences")}
        >
          Preferences
        </button>
      </div>

      {tab === "history" ? (
        <div className="company-history-panel">
          <div className="company-history-filters">
            <button type="button" className="company-filter-pill active">
              All activities
            </button>
            <button type="button" className="company-filter-pill" disabled>
              Email campaigns
            </button>
            <button type="button" className="company-filter-pill" disabled>
              Notes
            </button>
            <button type="button" className="company-filter-pill" disabled>
              Conversations
            </button>
          </div>

          <div className="cd-card">
            <ContactHistoryTimeline events={contact.history} contact={contact} />
          </div>
        </div>
      ) : null}

      {tab === "lists" ? (
        <ContactListsPanel lists={contact.lists} folder={contact.owner} />
      ) : null}

      {tab === "preferences" ? (
        <div className="cd-grid">
          <div className="cd-col">
            <div className="cd-card">
              <div className="cd-card-head">
                <h3>Preferences</h3>
              </div>
              <div className="cd-sub-row">
                {contact.subscribed ? (
                  <>
                    <span className="cd-check">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                    Subscribed
                  </>
                ) : (
                  <span className="cd-value muted">Not subscribed</span>
                )}
              </div>
              <div className="cd-pills">
                <span className="cd-pill">Email campaigns</span>
                <span className="cd-pill">Transactional emails</span>
              </div>
              {contact.blocklisted ? (
                <p className="cd-empty">This contact is blocklisted.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "overview" ? (
        <div className="cd-grid">
          <div className="cd-col">
            <div className="cd-card">
              <div className="cd-card-head">
                <h3>Preferences</h3>
              </div>
              <div className="cd-sub-row">
                {contact.subscribed ? (
                  <>
                    <span className="cd-check">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                    Subscribed
                  </>
                ) : (
                  <span className="cd-value muted">Not subscribed</span>
                )}
              </div>
              <div className="cd-pills">
                <span className="cd-pill">Email campaigns</span>
                <span className="cd-pill">Transactional emails</span>
              </div>
            </div>

            <div className="cd-card">
              <div className="cd-card-head">
                <h3>Information</h3>
                <button
                  type="button"
                  className="cd-more"
                  aria-label="Collapse"
                  disabled
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </div>
              <div className="cd-field">
                <div className="cd-label">Lastname</div>
                <div className="cd-value">{contact.lastName || "—"}</div>
              </div>
              <div className="cd-field">
                <div className="cd-label">Firstname</div>
                <div className="cd-value">{contact.firstName || "—"}</div>
              </div>
              <div className="cd-field">
                <div className="cd-label">Email</div>
                <div className="cd-value">{contact.email}</div>
              </div>
              <div className="cd-field">
                <div className="cd-label">Company</div>
                <div className="cd-value">
                  {contact.company?.id ? (
                    <Link
                      href={portalCompanyRoute(contact.company.id)}
                      className="contact-history-link"
                    >
                      {contact.companyName}
                    </Link>
                  ) : (
                    contact.companyName || "—"
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="cd-col">
            <div className="cd-card">
              <div className="cd-card-head">
                <h3>Email campaigns</h3>
              </div>
              <CampaignStatsBar stats={contact.campaignStats} />
            </div>

            <div className="cd-card">
              <div className="cd-card-head">
                <h3>Recent history</h3>
              </div>
              <ContactHistoryTimeline
                events={nonCampaignHistory.slice(0, 8)}
                contact={contact}
              />
            </div>
          </div>

          <div className="cd-col right">
            <div className="cd-card">
              <div className="cd-card-head">
                <h3>Companies ({contact.company ? 1 : 0})</h3>
              </div>
              {!contact.company ? (
                <p className="cd-empty">No company associated with this contact.</p>
              ) : (
                <ul className="company-detail-contacts">
                  <li>
                    <Link
                      href={portalCompanyRoute(contact.company.id)}
                      className="company-detail-contact-name contact-history-link"
                    >
                      {contact.company.name}
                    </Link>
                    <div className="company-detail-contact-email">
                      {contact.company.contactCount} associated contact
                      {contact.company.contactCount === 1 ? "" : "s"}
                    </div>
                  </li>
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
