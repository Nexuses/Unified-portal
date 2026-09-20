"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_LIST_ATTRIBUTES,
  type Contact,
  type CrmList,
} from "@/lib/crm";
import { portalContactRoute } from "@/lib/portal-nav";

const CORE_FIELDS = new Set(["firstName", "lastName", "email", "companyName"]);
const CONTACTS_PAGE_SIZE = 50;

/** Suppression imports store firstName as "Blocked" — prefer a readable label. */
function contactDisplayName(contact: Contact) {
  const first = contact.firstName?.trim() ?? "";
  const last = contact.lastName?.trim() ?? "";
  const combined = `${first} ${last}`.trim();
  if (!combined || (/^blocked$/i.test(first) && !last)) {
    const local = contact.email.split("@")[0]?.trim();
    return local || contact.email || "Unknown";
  }
  if (/^blocked$/i.test(first) && last) {
    return last;
  }
  return combined;
}

type ContactsPageResponse = {
  items: Contact[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function emptyAttributeValues() {
  return Object.fromEntries(
    DEFAULT_LIST_ATTRIBUTES.map((field) => [field.key, ""]),
  ) as Record<string, string>;
}

function ContactsPagination({
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

export default function PortalContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [lists, setLists] = useState<CrmList[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchField, setSearchField] = useState<"all" | "name" | "email">("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [listId, setListId] = useState("");
  const [values, setValues] = useState<Record<string, string>>(emptyAttributeValues);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [debouncedSearch, searchField]);

  async function loadContactsPage(nextPage = page) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(CONTACTS_PAGE_SIZE),
        searchField,
      });
      if (debouncedSearch) {
        params.set("q", debouncedSearch);
      }
      const response = await fetch(`/api/crm/contacts?${params.toString()}`);
      const data = (await response.json()) as ContactsPageResponse | { error?: string };
      if (!response.ok || !("items" in data)) {
        throw new Error(
          !response.ok && data && "error" in data && data.error
            ? data.error
            : "Failed to load contacts",
        );
      }
      if (requestId !== requestIdRef.current) {
        return;
      }
      setContacts(data.items);
      setTotal(data.total);
      const maxPage = Math.max(1, data.totalPages || Math.ceil(data.total / CONTACTS_PAGE_SIZE));
      if (nextPage > maxPage) {
        setPage(maxPage);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load contacts");
      setContacts([]);
      setTotal(0);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadContactsPage(page);
  }, [page, debouncedSearch, searchField]);

  useEffect(() => {
    if (!modalOpen) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/crm/lists");
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load lists");
        }
        if (!cancelled) {
          const next = (data as CrmList[]).filter(
            (list) => list.name !== "Unsubscribe",
          );
          setLists(next);
          setListId((current) =>
            current && next.some((list) => list.id === current)
              ? current
              : (next[0]?.id ?? ""),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setModalError(
            err instanceof Error ? err.message : "Failed to load lists",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modalOpen]);

  const totalPages = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pageIds = useMemo(
    () => contacts.map((contact) => contact.id),
    [contacts],
  );
  const selectedOnPage = pageIds.filter((id) => selectedIds.includes(id));
  const allVisibleSelected =
    pageIds.length > 0 && selectedOnPage.length === pageIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        selectedOnPage.length > 0 && !allVisibleSelected;
    }
  }, [allVisibleSelected, selectedOnPage.length]);

  function toggleContact(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      if (allVisibleSelected) {
        return current.filter((id) => !pageIds.includes(id));
      }
      return Array.from(new Set([...current, ...pageIds]));
    });
  }

  async function deleteSelectedContacts() {
    if (selectedIds.length === 0 || deleting) {
      return;
    }

    const label =
      selectedIds.length === 1
        ? contacts.find((contact) => contact.id === selectedIds[0])?.fullName ??
          "this contact"
        : `${selectedIds.length} contacts`;
    const confirmText =
      selectedIds.length === 1
        ? `Delete contact "${label}"? This removes them from all lists.`
        : `Delete ${selectedIds.length} contacts? This removes them from all lists.`;
    if (!window.confirm(confirmText)) {
      return;
    }

    setDeleting(true);
    setError("");
    try {
      const response = await fetch("/api/crm/contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete contacts");
      }
      setSelectedIds([]);
      await loadContactsPage(currentPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete contacts");
    } finally {
      setDeleting(false);
    }
  }

  function openCreateModal() {
    setValues(emptyAttributeValues());
    setModalError("");
    setModalOpen(true);
  }

  function closeCreateModal() {
    if (saving) {
      return;
    }
    setModalOpen(false);
    setModalError("");
  }

  async function handleCreateContact() {
    setSaving(true);
    setModalError("");
    try {
      if (!listId) {
        throw new Error("Select a list for this contact.");
      }
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
        throw new Error(data.error || "Failed to create contact");
      }

      setModalOpen(false);
      setValues(emptyAttributeValues());
      setPage(1);
      await loadContactsPage(1);
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : "Failed to create contact",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="crm-page-head">
        <div>
          <h2>Contacts</h2>
          <p className="desc">
            All contacts imported across your lists, combined in one place.
          </p>
        </div>
        <div className="crm-actions">
          <button type="button" className="btn-dark" onClick={openCreateModal}>
            Create a contact
          </button>
        </div>
      </div>

      <div className="crm-tabs">
        <button type="button" className="crm-tab active">
          All contacts
        </button>
      </div>

      <div className="drip-toolbar">
        {selectedIds.length > 0 ? (
          <button
            type="button"
            className="lists-bulk-delete"
            disabled={deleting}
            onClick={() => void deleteSelectedContacts()}
          >
            {deleting ? "Deleting..." : `Delete (${selectedIds.length})`}
          </button>
        ) : null}
        <label className="drip-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder={
              searchField === "email"
                ? "Search by email"
                : searchField === "name"
                  ? "Search by name"
                  : "Search by name or email"
            }
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          className="drip-select"
          value={searchField}
          onChange={(event) =>
            setSearchField(event.target.value as "all" | "name" | "email")
          }
          aria-label="Search in"
        >
          <option value="all">Name or email</option>
          <option value="name">Name</option>
          <option value="email">Email</option>
        </select>
      </div>

      {error ? <div className="crm-error">{error}</div> : null}

      <ContactsPagination
        total={total}
        page={currentPage}
        pageSize={CONTACTS_PAGE_SIZE}
        onPage={setPage}
      />

      <div className="data-table-wrap">
        <table className="data-table contacts-table">
          <thead>
            <tr>
              <th className="chk">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={loading || pageIds.length === 0}
                  onChange={toggleAllVisible}
                  aria-label="Select all contacts on this page"
                />
              </th>
              <th className="contact-name-cell">Contact</th>
              <th className="contact-subscribed-cell">Subscribed</th>
              <th className="contact-email-cell">Email</th>
              <th className="contact-company-cell">Company</th>
              <th className="contact-blocklisted-cell">Blocklisted</th>
            </tr>
          </thead>
          <tbody>
            {loading && contacts.length === 0 ? (
              <tr>
                <td colSpan={6} className="crm-empty">
                  Loading contacts...
                </td>
              </tr>
            ) : total === 0 ? (
              <tr>
                <td colSpan={6} className="crm-empty">
                  {debouncedSearch
                    ? "No contacts match that search."
                    : "No contacts yet. Create a list and upload a CSV to import contacts."}
                </td>
              </tr>
            ) : (
              contacts.map((contact) => (
                <tr key={contact.id}>
                  <td className="chk">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(contact.id)}
                      onChange={() => toggleContact(contact.id)}
                      aria-label={`Select ${contact.fullName}`}
                    />
                  </td>
                  <td className="contact-name-cell">
                    <Link
                      href={portalContactRoute(contact.id)}
                      className="contact-table-link"
                      title={contactDisplayName(contact)}
                    >
                      {contactDisplayName(contact)}
                    </Link>
                  </td>
                  <td className="contact-subscribed-cell">
                    <span className="contact-status-badges">
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
                      ) : null}
                      {contact.blocklisted ? (
                        <span className="blocked-badge">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <circle cx="12" cy="12" r="9" />
                            <path d="m8 8 8 8M16 8l-8 8" />
                          </svg>
                          Blocked
                        </span>
                      ) : null}
                      {!contact.subscribed && !contact.blocklisted ? (
                        <span className="contact-empty-dash">—</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="contact-email-cell email-cell" title={contact.email}>
                    <span className="contact-email-text">{contact.email}</span>
                  </td>
                  <td className="contact-company-cell" title={contact.companyName || undefined}>
                    <span className="contact-company-text">{contact.companyName || "—"}</span>
                  </td>
                  <td className="contact-blocklisted-cell muted-cell">
                    {contact.blocklisted ? "Yes" : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="crm-contacts-pager-bottom">
        <ContactsPagination
          total={total}
          page={currentPage}
          pageSize={CONTACTS_PAGE_SIZE}
          onPage={setPage}
        />
      </div>

      {modalOpen ? (
        <div className="crm-modal-backdrop" onClick={closeCreateModal}>
          <div
            className="crm-modal crm-modal-wide"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-contact-title"
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="create-contact-title">Create a contact</h3>
                <p>
                  Choose a list and fill in contact details. First Name, Email,
                  and Company Name are required.
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                onClick={closeCreateModal}
                aria-label="Close"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <div className="crm-modal-body">
              <div className="crm-field">
                <label htmlFor="create-contact-list">List</label>
                <select
                  id="create-contact-list"
                  value={listId}
                  onChange={(event) => setListId(event.target.value)}
                  disabled={saving || lists.length === 0}
                >
                  {lists.length === 0 ? (
                    <option value="">No lists available</option>
                  ) : (
                    lists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name} (#{list.displayId})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="crm-mapping-grid">
                {DEFAULT_LIST_ATTRIBUTES.map((field) => (
                  <div className="crm-field" key={field.key}>
                    <label htmlFor={`create-contact-${field.key}`}>
                      {field.label}
                      {field.required ? " *" : ""}
                    </label>
                    <input
                      id={`create-contact-${field.key}`}
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
                onClick={closeCreateModal}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                onClick={() => void handleCreateContact()}
                disabled={saving || lists.length === 0}
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
