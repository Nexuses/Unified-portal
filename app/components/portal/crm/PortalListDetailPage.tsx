"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_LIST_ATTRIBUTES,
  type Contact,
  type CrmList,
} from "@/lib/crm";
import { PORTAL_ROUTES, portalContactRoute } from "@/lib/portal-nav";

type PortalListDetailPageProps = {
  listId: string;
};

const CORE_FIELDS = new Set(["firstName", "lastName", "email", "companyName"]);
const LIST_CONTACTS_PAGE_SIZE = 50;

function emptyAttributeValues() {
  return Object.fromEntries(
    DEFAULT_LIST_ATTRIBUTES.map((field) => [field.key, ""]),
  ) as Record<string, string>;
}

function ListContactsPagination({
  total,
  page,
  pageSize,
  onPage,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (next: number) => void;
}) {
  if (total <= pageSize) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);

  return (
    <div className="drip-pagination">
      <span className="drip-page-range">
        {start}-{end} of {total.toLocaleString()}
      </span>
      <div className="drip-page-controls">
        <select
          value={currentPage}
          onChange={(event) => onPage(Number(event.target.value))}
          aria-label="Page"
        >
          {Array.from({ length: totalPages }, (_, index) => (
            <option key={index + 1} value={index + 1}>
              {index + 1}
            </option>
          ))}
        </select>
        <span>of {totalPages} pages</span>
        <button
          type="button"
          className="drip-page-arrow"
          disabled={currentPage <= 1}
          onClick={() => onPage(currentPage - 1)}
          aria-label="Previous page"
        >
          ‹
        </button>
        <button
          type="button"
          className="drip-page-arrow"
          disabled={currentPage >= totalPages}
          onClick={() => onPage(currentPage + 1)}
          aria-label="Next page"
        >
          ›
        </button>
      </div>
    </div>
  );
}

export default function PortalListDetailPage({ listId }: PortalListDetailPageProps) {
  const router = useRouter();
  const [list, setList] = useState<CrmList | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(emptyAttributeValues);
  const [modalError, setModalError] = useState("");
  const [saving, setSaving] = useState(false);
  const [successNote, setSuccessNote] = useState("");
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  async function loadListPage(nextPage = page) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(LIST_CONTACTS_PAGE_SIZE),
      });
      if (debouncedSearch) {
        params.set("q", debouncedSearch);
      }
      const response = await fetch(
        `/api/crm/lists/${encodeURIComponent(listId)}?${params.toString()}`,
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load list");
      }
      if (requestId !== requestIdRef.current) {
        return;
      }
      setList(data.list);
      setContacts(Array.isArray(data.items) ? data.items : data.contacts ?? []);
      setTotal(Number(data.total) || 0);
      const maxPage = Math.max(
        1,
        Number(data.totalPages) ||
          Math.ceil((Number(data.total) || 0) / LIST_CONTACTS_PAGE_SIZE),
      );
      if (nextPage > maxPage) {
        setPage(maxPage);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load list");
      setContacts([]);
      setTotal(0);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadListPage(page);
  }, [listId, page, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(total / LIST_CONTACTS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  function openAddModal() {
    setValues(emptyAttributeValues());
    setModalError("");
    setSuccessNote("");
    setModalOpen(true);
  }

  function closeAddModal() {
    if (saving) {
      return;
    }
    setModalOpen(false);
    setModalError("");
  }

  async function handleAddContact() {
    setSaving(true);
    setModalError("");
    try {
      const firstName = values.firstName?.trim() ?? "";
      const lastName = values.lastName?.trim() ?? "";
      const email = values.email?.trim() ?? "";
      const companyName = values.companyName?.trim() ?? "";
      if (!firstName || !email || !companyName) {
        throw new Error("First Name, Email, and Company Name are required.");
      }

      const attributes: Record<string, string> = {};
      for (const field of DEFAULT_LIST_ATTRIBUTES) {
        if (CORE_FIELDS.has(field.key)) {
          continue;
        }
        const value = values[field.key]?.trim() ?? "";
        if (value) {
          attributes[field.key] = value;
        }
      }

      const response = await fetch(`/api/crm/lists/${encodeURIComponent(listId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contacts: [
            {
              firstName,
              lastName,
              email,
              companyName,
              attributes,
            },
          ],
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to add contact");
      }

      setModalOpen(false);
      setValues(emptyAttributeValues());
      setSuccessNote(`Added ${email} to this list.`);
      setPage(1);
      await loadListPage(1);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Failed to add contact");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="crm-page-head">
        <div>
          <button
            type="button"
            className="cd-back"
            aria-label="Back to lists"
            onClick={() => router.push(PORTAL_ROUTES.lists)}
            style={{ marginBottom: "8px" }}
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
          <h2>{list?.name ?? "List"}</h2>
          <p className="desc">
            Contacts in this list. Import via CSV when creating a list, or add
            one manually here.
          </p>
        </div>
        <div className="crm-actions">
          <button
            type="button"
            className="btn-dark"
            onClick={openAddModal}
            disabled={loading || !list}
          >
            Add contact
          </button>
        </div>
      </div>

      <div className="crm-meta-row">
        <div className="crm-meta-right" style={{ marginLeft: "auto" }}>
          <div className="search-input">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3-3" />
            </svg>
            <input
              type="search"
              placeholder="Search by name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="lists-search-input"
            />
          </div>
        </div>
      </div>

      {error ? <div className="crm-error">{error}</div> : null}
      {successNote ? <div className="crm-summary">{successNote}</div> : null}

      <ListContactsPagination
        total={total}
        page={currentPage}
        pageSize={LIST_CONTACTS_PAGE_SIZE}
        onPage={setPage}
      />

      <div className="data-table-wrap">
        <table className="data-table contacts-table list-contacts-table">
          <thead>
            <tr>
              <th className="chk">
                <input type="checkbox" disabled aria-label="Select all" />
              </th>
              <th className="contact-name-cell">Contact</th>
              <th className="contact-subscribed-cell">Subscribed</th>
              <th className="contact-email-cell">Email</th>
              <th className="contact-company-cell">Company</th>
            </tr>
          </thead>
          <tbody>
            {loading && contacts.length === 0 ? (
              <tr>
                <td colSpan={5} className="crm-empty">
                  Loading list contacts...
                </td>
              </tr>
            ) : total === 0 ? (
              <tr>
                <td colSpan={5} className="crm-empty">
                  {debouncedSearch
                    ? "No contacts match that search."
                    : "No contacts in this list yet. Click Add contact to add one manually."}
                </td>
              </tr>
            ) : (
              contacts.map((contact) => (
                <tr key={contact.id}>
                  <td className="chk">
                    <input
                      type="checkbox"
                      disabled
                      aria-label={`Select ${contact.fullName}`}
                    />
                  </td>
                  <td className="contact-name-cell">
                    <Link
                      href={portalContactRoute(contact.id)}
                      className="contact-table-link"
                      title={contact.fullName}
                    >
                      {contact.fullName}
                    </Link>
                  </td>
                  <td className="contact-subscribed-cell">
                    {contact.subscribed ? (
                      <span className="sub-badge">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <rect x="3" y="5" width="18" height="14" rx="2" />
                          <path d="m3 7 9 6 9-6" />
                        </svg>
                        Email
                      </span>
                    ) : (
                      <span className="contact-empty-dash">—</span>
                    )}
                  </td>
                  <td className="contact-email-cell email-cell" title={contact.email}>
                    <span className="contact-email-text">{contact.email}</span>
                  </td>
                  <td className="contact-company-cell" title={contact.companyName || undefined}>
                    <span className="contact-company-text">{contact.companyName || "—"}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="crm-contacts-pager-bottom">
        <ListContactsPagination
          total={total}
          page={currentPage}
          pageSize={LIST_CONTACTS_PAGE_SIZE}
          onPage={setPage}
        />
      </div>

      {modalOpen ? (
        <div className="crm-modal-backdrop" onClick={closeAddModal}>
          <div
            className="crm-modal crm-modal-wide"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="list-add-contact-title"
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="list-add-contact-title">Add contact</h3>
                <p>
                  Add a contact to{" "}
                  <strong>{list?.name ?? "this list"}</strong>
                  {list?.displayId ? ` (#${list.displayId})` : ""}. First Name,
                  Email, and Company Name are required.
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                onClick={closeAddModal}
                aria-label="Close"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <div className="crm-modal-body">
              <div className="crm-mapping-grid">
                {DEFAULT_LIST_ATTRIBUTES.map((field) => (
                  <div className="crm-field" key={field.key}>
                    <label htmlFor={`list-add-contact-${field.key}`}>
                      {field.label}
                      {field.required ? " *" : ""}
                    </label>
                    <input
                      id={`list-add-contact-${field.key}`}
                      value={values[field.key] ?? ""}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      placeholder={field.label}
                      disabled={saving}
                      type={
                        field.key === "email"
                          ? "email"
                          : field.key === "phoneNumber"
                            ? "tel"
                            : "text"
                      }
                    />
                  </div>
                ))}
              </div>

              {modalError ? <div className="crm-error">{modalError}</div> : null}
            </div>

            <div className="crm-modal-foot">
              <button
                type="button"
                className="btn-soft"
                onClick={closeAddModal}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                onClick={() => void handleAddContact()}
                disabled={saving}
              >
                {saving ? "Saving…" : "Add contact"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
