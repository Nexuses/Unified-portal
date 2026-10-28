"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CONTACT_ATTRIBUTE_LABELS,
  formatListDate,
  resolveContactPhotoUrl,
  type ContactCampaignStats,
  type ContactDetail,
  type ContactListMembership,
} from "@/lib/crm";
import {
  portalCompanyRoute,
  portalContactRoute,
  portalListRoute,
  portalReturnPath,
  PORTAL_ROUTES,
} from "@/lib/portal-nav";
import ContactActivityPanel from "@/app/components/portal/crm/ContactActivityPanel";
import PortalContactLeadReportView from "@/app/components/portal/crm/PortalContactLeadReportView";

type PortalContactDetailPageProps = {
  contactId: string;
  from?: string;
};

type DetailTab = "overview" | "activity" | "lists" | "preferences";

function pct(part: number, total: number) {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.round((part / total) * 100)}%`;
}

function ensureHttp(url?: string) {
  const value = (url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function contactInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function IconMail() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}
function IconPhone() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function IconLinkedIn() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}
function IconBuilding() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4M10 10h4M10 14h4M10 18h4" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function IconBriefcase() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect width="20" height="14" x="2" y="7" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <path d="M12 12v.01" />
    </svg>
  );
}
function IconMapPin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function IconGlobe() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
function IconTag() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
      <path d="M7 7h.01" />
    </svg>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="cd-info-row">
      <span className="cd-info-icon" aria-hidden>
        {icon}
      </span>
      <div className="cd-info-copy">
        <div className="cd-info-label">{label}</div>
        <div className="cd-info-value">{children}</div>
      </div>
    </div>
  );
}

function ContactAvatar({
  name,
  photoUrl,
  size = "md",
}: {
  name: string;
  photoUrl?: string;
  size?: "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(photoUrl && !failed);
  return (
    <div className={`cd-avatar-pro is-${size}${showPhoto ? " has-photo" : ""}`}>
      {showPhoto ? (
        <img src={photoUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        <span>{contactInitials(name)}</span>
      )}
    </div>
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
            {total === 0
              ? "0-0 of 0"
              : `${startIndex + 1}-${endIndex} of ${total}`}
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
  from,
}: PortalContactDetailPageProps) {
  const searchParams = useSearchParams();
  if (searchParams.get("view") === "lead-report") {
    return <PortalContactLeadReportView contactId={contactId} from={from} />;
  }
  return <ContactTabsDetail contactId={contactId} from={from} />;
}

function ContactTabsDetail({
  contactId,
  from,
}: PortalContactDetailPageProps) {
  const router = useRouter();
  const backHref = portalReturnPath(from, PORTAL_ROUTES.contacts);
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
              aria-label="Back"
              onClick={() => router.push(backHref)}
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

  const profile = contact.profile;
  const photoUrl = resolveContactPhotoUrl(profile);
  const linkedinUrl = ensureHttp(
    profile.linkedinUrl || contact.attributes?.personalLinkedIn,
  );
  const phone =
    profile.phone?.trim() || contact.attributes?.phoneNumber?.trim() || "";
  const position =
    profile.title?.trim() || contact.attributes?.position?.trim() || "";
  const location =
    profile.location?.trim() ||
    contact.attributes?.personLocation?.trim() ||
    "";
  const website = ensureHttp(contact.attributes?.website);
  const knownAttrKeys = new Set([
    "position",
    "phoneNumber",
    "personalLinkedIn",
    "personLocation",
    "website",
  ]);
  const extraAttributes = Object.entries(contact.attributes ?? {}).filter(
    ([key, value]) => !knownAttrKeys.has(key) && String(value ?? "").trim(),
  );

  return (
    <>
      <div className="cd-top cd-top-pro">
        <div className="cd-identity">
          <button
            type="button"
            className="cd-back"
            aria-label="Back"
            onClick={() => router.push(backHref)}
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
          <ContactAvatar name={contact.fullName} photoUrl={photoUrl} size="lg" />
          <div className="cd-identity-copy">
            <div className="cd-name-row">
              <h2 className="cd-name">{contact.fullName}</h2>
              {contact.subscribed ? (
                <span className="cd-status-pill is-subscribed">Subscribed</span>
              ) : (
                <span className="cd-status-pill">Unsubscribed</span>
              )}
            </div>
            <p className="cd-subtitle">
              {position ? <span>{position}</span> : null}
              {position && contact.companyName ? (
                <span className="cd-subtitle-dot" aria-hidden>
                  ·
                </span>
              ) : null}
              {contact.companyName ? (
                contact.company?.id ? (
                  <Link
                    href={portalCompanyRoute(contact.company.id)}
                    className="cd-subtitle-link"
                  >
                    {contact.companyName}
                  </Link>
                ) : (
                  <span>{contact.companyName}</span>
                )
              ) : null}
              {!position && !contact.companyName ? (
                <span className="muted">{contact.email}</span>
              ) : null}
            </p>
            <div className="cd-quick-actions">
              <a className="cd-quick-btn" href={`mailto:${contact.email}`}>
                <IconMail />
                Email
              </a>
              {phone ? (
                <a className="cd-quick-btn" href={`tel:${phone.replace(/\s+/g, "")}`}>
                  <IconPhone />
                  Call
                </a>
              ) : null}
              {linkedinUrl ? (
                <a
                  className="cd-quick-btn is-linkedin"
                  href={linkedinUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <IconLinkedIn />
                  LinkedIn
                </a>
              ) : (
                <span className="cd-quick-btn is-linkedin is-disabled">
                  <IconLinkedIn />
                  LinkedIn
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="cd-actions-bar">
          <div className="cd-pager">
            <button
              type="button"
              aria-label="Previous contact"
              disabled={!navigation?.prevId}
              onClick={() =>
                navigation?.prevId
                  ? router.push(portalContactRoute(navigation.prevId, from))
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
                  ? router.push(portalContactRoute(navigation.nextId, from))
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
          <button
            type="button"
            className="btn-dark"
            onClick={() =>
              router.push(
                portalContactRoute(contactId, from, { view: "lead-report" }),
              )
            }
          >
            Lead Report
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
          className={`cd-tab ${tab === "activity" ? "active" : ""}`}
          onClick={() => setTab("activity")}
        >
          Activity
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

      {tab === "activity" ? (
        <div className="cd-card cd-activity-card">
          <ContactActivityPanel
            contact={contact}
            onContactChange={setContact}
          />
        </div>
      ) : null}

      {tab === "lists" ? (
        <ContactListsPanel lists={contact.lists} folder={contact.owner} />
      ) : null}

      {tab === "preferences" ? (
        <div className="cd-grid-simple">
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
      ) : null}

      {tab === "overview" ? (
        <div className="cd-layout">
          <aside className="cd-layout-side">
            <div className="cd-card cd-info-card">
              <div className="cd-card-head">
                <h3>Information</h3>
              </div>

              <div className="cd-info-stack">
                <InfoRow icon={<IconUser />} label="Name">
                  {[contact.firstName, contact.lastName]
                    .filter(Boolean)
                    .join(" ") || "—"}
                </InfoRow>
                <InfoRow icon={<IconMail />} label="Email">
                  <a className="cd-info-link" href={`mailto:${contact.email}`}>
                    {contact.email}
                  </a>
                </InfoRow>
                <InfoRow icon={<IconPhone />} label="Phone">
                  {phone ? (
                    <a
                      className="cd-info-link"
                      href={`tel:${phone.replace(/\s+/g, "")}`}
                    >
                      {phone}
                    </a>
                  ) : (
                    <span className="cd-info-muted">Not set</span>
                  )}
                </InfoRow>
                <InfoRow icon={<IconBriefcase />} label="Position">
                  {position || <span className="cd-info-muted">Not set</span>}
                </InfoRow>
                <InfoRow icon={<IconBuilding />} label="Company">
                  {contact.company?.id ? (
                    <Link
                      href={portalCompanyRoute(contact.company.id)}
                      className="cd-info-link"
                    >
                      {contact.companyName}
                    </Link>
                  ) : (
                    contact.companyName || (
                      <span className="cd-info-muted">Not set</span>
                    )
                  )}
                </InfoRow>
                <InfoRow icon={<IconMapPin />} label="Location">
                  {location || <span className="cd-info-muted">Not set</span>}
                </InfoRow>
                {website ? (
                  <InfoRow icon={<IconGlobe />} label="Website">
                    <a
                      className="cd-info-link"
                      href={website}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {contact.attributes?.website}
                    </a>
                  </InfoRow>
                ) : null}
                {extraAttributes.map(([key, value]) => (
                  <InfoRow key={key} icon={<IconTag />} label={CONTACT_ATTRIBUTE_LABELS[key] ?? key}>
                    {value}
                  </InfoRow>
                ))}
              </div>

              <div className="cd-info-actions">
                {linkedinUrl ? (
                  <a
                    className="cd-linkedin-btn"
                    href={linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <IconLinkedIn />
                    View LinkedIn profile
                  </a>
                ) : (
                  <span className="cd-linkedin-btn is-disabled">
                    <IconLinkedIn />
                    LinkedIn not added
                  </span>
                )}
              </div>
            </div>

            <div className="cd-card cd-stats-card">
              <div className="cd-card-head">
                <h3>Email campaigns</h3>
              </div>
              <CampaignStatsBar stats={contact.campaignStats} />
            </div>

            <div className="cd-card cd-company-card">
              <div className="cd-card-head">
                <h3>Company</h3>
              </div>
              {!contact.company ? (
                <p className="cd-empty">No company associated yet.</p>
              ) : (
                <div className="cd-company-row">
                  <span className="cd-company-icon" aria-hidden>
                    <IconBuilding />
                  </span>
                  <div>
                    <Link
                      href={portalCompanyRoute(contact.company.id)}
                      className="cd-company-name"
                    >
                      {contact.company.name}
                    </Link>
                    <p className="cd-company-meta">
                      {contact.company.contactCount} associated contact
                      {contact.company.contactCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </aside>

          <section className="cd-layout-main">
            <div className="cd-card cd-activity-card">
              <ContactActivityPanel
                contact={contact}
                onContactChange={setContact}
              />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
