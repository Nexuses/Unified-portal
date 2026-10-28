"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
const BULK_ACTION_CHUNK = 250;
const LIST_CONTACTS_COLUMNS_STORAGE_KEY = "portal-list-contacts-visible-columns";

const LIST_CONTACT_COLUMN_OPTIONS = [
  { id: "subscribed", label: "Subscribed", defaultVisible: true },
  { id: "email", label: "Email", defaultVisible: true },
  { id: "companyName", label: "Company", defaultVisible: true },
  { id: "position", label: "Position", defaultVisible: false },
  { id: "phoneNumber", label: "Phone Number", defaultVisible: false },
  { id: "industry", label: "Industry", defaultVisible: false },
  { id: "website", label: "Website", defaultVisible: false },
  { id: "personalLinkedIn", label: "Personal LinkedIn", defaultVisible: false },
  { id: "personLocation", label: "Person Location", defaultVisible: false },
  { id: "blocklisted", label: "Blocklisted", defaultVisible: false },
] as const;

type ListContactColumnId = (typeof LIST_CONTACT_COLUMN_OPTIONS)[number]["id"];
type ListContactColumnVisibility = Record<ListContactColumnId, boolean>;

function defaultListContactColumnVisibility(): ListContactColumnVisibility {
  return LIST_CONTACT_COLUMN_OPTIONS.reduce((acc, column) => {
    acc[column.id] = column.defaultVisible;
    return acc;
  }, {} as ListContactColumnVisibility);
}

function loadListContactColumnVisibility(): ListContactColumnVisibility {
  const defaults = defaultListContactColumnVisibility();
  if (typeof window === "undefined") {
    return defaults;
  }
  try {
    const raw = window.localStorage.getItem(LIST_CONTACTS_COLUMNS_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<ListContactColumnVisibility>;
    return LIST_CONTACT_COLUMN_OPTIONS.reduce((acc, column) => {
      acc[column.id] =
        typeof parsed[column.id] === "boolean"
          ? Boolean(parsed[column.id])
          : column.defaultVisible;
      return acc;
    }, {} as ListContactColumnVisibility);
  } catch {
    return defaults;
  }
}

function emptyAttributeValues() {
  return Object.fromEntries(
    DEFAULT_LIST_ATTRIBUTES.map((field) => [field.key, ""]),
  ) as Record<string, string>;
}

function listContactColumnValue(
  contact: Contact,
  columnId: ListContactColumnId,
): string {
  if (columnId === "email") {
    return contact.email;
  }
  if (columnId === "companyName") {
    return contact.companyName?.trim() || "—";
  }
  if (columnId === "blocklisted") {
    return contact.blocklisted ? "Yes" : "—";
  }
  if (columnId === "subscribed") {
    return contact.subscribed ? "Email" : "—";
  }
  return contact.attributes?.[columnId]?.trim() || "—";
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectingAll, setSelectingAll] = useState(false);
  const [busyAction, setBusyAction] = useState<"remove" | "delete" | null>(null);
  const [contactActionPrompt, setContactActionPrompt] = useState<
    "remove" | "delete" | null
  >(null);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [columnMenuPos, setColumnMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [visibleColumns, setVisibleColumns] =
    useState<ListContactColumnVisibility>(defaultListContactColumnVisibility);
  const requestIdRef = useRef(0);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const columnMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const columnMenuPanelRef = useRef<HTMLDivElement | null>(null);

  const visibleOptionalColumns = useMemo(
    () =>
      LIST_CONTACT_COLUMN_OPTIONS.filter((column) => visibleColumns[column.id]),
    [visibleColumns],
  );

  const tableColSpan = useMemo(
    () => 3 + visibleOptionalColumns.length,
    [visibleOptionalColumns.length],
  );

  function toggleListContactColumn(columnId: ListContactColumnId) {
    setVisibleColumns((current) => {
      const next = { ...current, [columnId]: !current[columnId] };
      try {
        window.localStorage.setItem(
          LIST_CONTACTS_COLUMNS_STORAGE_KEY,
          JSON.stringify(next),
        );
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setVisibleColumns(loadListContactColumnVisibility());
  }, []);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    setSelectedIds([]);
  }, [listId, debouncedSearch]);

  useLayoutEffect(() => {
    if (!columnMenuOpen) {
      setColumnMenuPos(null);
      return;
    }
    function placeMenu() {
      const button = columnMenuButtonRef.current;
      if (!button) {
        return;
      }
      const rect = button.getBoundingClientRect();
      const menuWidth = 220;
      const left = Math.max(
        12,
        Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12),
      );
      setColumnMenuPos({
        top: rect.bottom + 6,
        left,
      });
    }
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [columnMenuOpen]);

  useEffect(() => {
    if (!columnMenuOpen) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      const inTrigger = columnMenuRef.current?.contains(target);
      const inPanel = columnMenuPanelRef.current?.contains(target);
      if (!inTrigger && !inPanel) {
        setColumnMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setColumnMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [columnMenuOpen]);

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

  const pageIds = useMemo(
    () => contacts.map((contact) => contact.id),
    [contacts],
  );
  const selectedOnPage = pageIds.filter((id) => selectedIds.includes(id));
  const allVisibleSelected =
    pageIds.length > 0 && selectedOnPage.length === pageIds.length;
  const allMatchingSelected = total > 0 && selectedIds.length >= total;
  const showSelectAllBanner =
    total > LIST_CONTACTS_PAGE_SIZE &&
    allVisibleSelected &&
    !allMatchingSelected;

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

  async function selectAllMatching() {
    if (total === 0 || selectingAll || busyAction) {
      return;
    }
    setSelectingAll(true);
    setError("");
    try {
      const params = new URLSearchParams({ idsOnly: "1" });
      if (debouncedSearch) {
        params.set("q", debouncedSearch);
      }
      const response = await fetch(
        `/api/crm/lists/${encodeURIComponent(listId)}?${params.toString()}`,
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to select all contacts");
      }
      const ids = Array.isArray(data.ids)
        ? data.ids.map((id: unknown) => String(id))
        : [];
      setSelectedIds(ids);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to select all contacts",
      );
    } finally {
      setSelectingAll(false);
    }
  }

  async function confirmContactAction() {
    if (!contactActionPrompt || selectedIds.length === 0 || busyAction) {
      return;
    }
    const action = contactActionPrompt;
    const ids = [...selectedIds];
    setBusyAction(action);
    setError("");
    try {
      let processed = 0;
      for (let index = 0; index < ids.length; index += BULK_ACTION_CHUNK) {
        const chunk = ids.slice(index, index + BULK_ACTION_CHUNK);
        if (action === "remove") {
          const response = await fetch(
            `/api/crm/lists/${encodeURIComponent(listId)}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ removeContactIds: chunk }),
            },
          );
          const data = await response.json();
          if (!response.ok) {
            throw new Error(
              data.error || "Failed to remove contacts from list",
            );
          }
          processed += Number(data.removed) || chunk.length;
        } else {
          const response = await fetch("/api/crm/contacts", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: chunk }),
          });
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error || "Failed to delete contacts");
          }
          processed += Number(data.deleted) || chunk.length;
        }
      }
      setSuccessNote(
        action === "remove"
          ? `Removed ${processed.toLocaleString()} contact${
              processed === 1 ? "" : "s"
            } from this list.`
          : `Deleted ${processed.toLocaleString()} contact${
              processed === 1 ? "" : "s"
            } from CRM.`,
      );
      setSelectedIds([]);
      setContactActionPrompt(null);
      setPage(1);
      await loadListPage(1);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : action === "remove"
            ? "Failed to remove contacts from list"
            : "Failed to delete contacts",
      );
    } finally {
      setBusyAction(null);
    }
  }

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

      <div className="drip-toolbar">
        {selectedIds.length > 0 ? (
          <>
            <button
              type="button"
              className="btn-soft"
              disabled={Boolean(busyAction) || selectingAll}
              onClick={() => setContactActionPrompt("remove")}
            >
              {busyAction === "remove"
                ? "Removing..."
                : `Remove from list (${selectedIds.length})`}
            </button>
            <button
              type="button"
              className="lists-bulk-delete"
              disabled={Boolean(busyAction) || selectingAll}
              onClick={() => setContactActionPrompt("delete")}
            >
              {busyAction === "delete"
                ? "Deleting..."
                : `Delete from CRM (${selectedIds.length})`}
            </button>
          </>
        ) : null}
        <label className="drip-search">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Search by name or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {error ? <div className="crm-error">{error}</div> : null}
      {successNote ? <div className="crm-summary">{successNote}</div> : null}

      {showSelectAllBanner || allMatchingSelected ? (
        <div className="crm-summary" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {allMatchingSelected ? (
            <>
              <span>
                All {total.toLocaleString()} contact
                {total === 1 ? "" : "s"}
                {debouncedSearch ? " matching this search" : " in this list"}{" "}
                selected.
              </span>
              <button
                type="button"
                className="btn-soft"
                disabled={Boolean(busyAction)}
                onClick={() => setSelectedIds([])}
              >
                Clear selection
              </button>
            </>
          ) : (
            <>
              <span>
                {selectedOnPage.length.toLocaleString()} on this page selected.
              </span>
              <button
                type="button"
                className="btn-dark"
                disabled={selectingAll || Boolean(busyAction)}
                onClick={() => void selectAllMatching()}
              >
                {selectingAll
                  ? "Selecting..."
                  : `Select all ${total.toLocaleString()}${
                      debouncedSearch ? " matching" : ""
                    }`}
              </button>
            </>
          )}
        </div>
      ) : null}

      <ListContactsPagination
        total={total}
        page={currentPage}
        pageSize={LIST_CONTACTS_PAGE_SIZE}
        onPage={setPage}
      />

      <div className="data-table-wrap list-contacts-table-wrap">
        <table className="data-table contacts-table list-contacts-table">
          <thead>
            <tr>
              <th className="chk">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={loading || pageIds.length === 0 || selectingAll}
                  onChange={toggleAllVisible}
                  aria-label="Select all contacts on this page"
                />
              </th>
              <th className="contact-name-cell">Contact</th>
              {visibleOptionalColumns.map((column) => (
                <th
                  key={column.id}
                  className={
                    column.id === "subscribed"
                      ? "contact-subscribed-cell"
                      : column.id === "email"
                        ? "contact-email-cell"
                        : column.id === "companyName"
                          ? "contact-company-cell"
                          : column.id === "blocklisted"
                            ? "contact-blocklisted-cell"
                            : "contact-attr-cell"
                  }
                >
                  {column.label}
                </th>
              ))}
              <th className="list-contacts-columns-cell">
                <div
                  className="drip-more-wrap lists-columns-wrap"
                  ref={columnMenuRef}
                >
                  <button
                    ref={columnMenuButtonRef}
                    type="button"
                    className={`kebab${columnMenuOpen ? " active" : ""}`}
                    aria-label="Choose columns"
                    aria-expanded={columnMenuOpen}
                    onClick={() => setColumnMenuOpen((open) => !open)}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="1.6" />
                      <circle cx="12" cy="12" r="1.6" />
                      <circle cx="12" cy="19" r="1.6" />
                    </svg>
                  </button>
                  {columnMenuOpen && typeof document !== "undefined"
                    ? createPortal(
                        <div
                          ref={columnMenuPanelRef}
                          className="lists-columns-menu-portal"
                          role="menu"
                          aria-label="Visible columns"
                          style={{
                            top: columnMenuPos?.top ?? 0,
                            left: columnMenuPos?.left ?? 0,
                            visibility: columnMenuPos ? "visible" : "hidden",
                          }}
                        >
                          {LIST_CONTACT_COLUMN_OPTIONS.map((column) => (
                            <label
                              key={column.id}
                              className="lists-columns-option"
                              role="menuitemcheckbox"
                              aria-checked={visibleColumns[column.id]}
                            >
                              <input
                                type="checkbox"
                                checked={visibleColumns[column.id]}
                                onChange={() =>
                                  toggleListContactColumn(column.id)
                                }
                              />
                              <span>{column.label}</span>
                            </label>
                          ))}
                        </div>,
                        document.body,
                      )
                    : null}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && contacts.length === 0 ? (
              <tr>
                <td colSpan={tableColSpan} className="crm-empty">
                  Loading list contacts...
                </td>
              </tr>
            ) : total === 0 ? (
              <tr>
                <td colSpan={tableColSpan} className="crm-empty">
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
                      checked={selectedIds.includes(contact.id)}
                      disabled={Boolean(busyAction)}
                      onChange={() => toggleContact(contact.id)}
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
                  {visibleOptionalColumns.map((column) => {
                    if (column.id === "subscribed") {
                      return (
                        <td
                          key={column.id}
                          className="contact-subscribed-cell"
                        >
                          {contact.subscribed ? (
                            <span className="sub-badge">
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <rect
                                  x="3"
                                  y="5"
                                  width="18"
                                  height="14"
                                  rx="2"
                                />
                                <path d="m3 7 9 6 9-6" />
                              </svg>
                              Email
                            </span>
                          ) : (
                            <span className="contact-empty-dash">—</span>
                          )}
                        </td>
                      );
                    }
                    if (column.id === "email") {
                      return (
                        <td
                          key={column.id}
                          className="contact-email-cell email-cell"
                          title={contact.email}
                        >
                          <span className="contact-email-text">
                            {contact.email}
                          </span>
                        </td>
                      );
                    }
                    if (column.id === "companyName") {
                      return (
                        <td
                          key={column.id}
                          className="contact-company-cell"
                          title={contact.companyName || undefined}
                        >
                          <span className="contact-company-text">
                            {contact.companyName || "—"}
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={column.id}
                        className={
                          column.id === "blocklisted"
                            ? "contact-blocklisted-cell"
                            : "contact-attr-cell"
                        }
                        title={
                          listContactColumnValue(contact, column.id) !== "—"
                            ? listContactColumnValue(contact, column.id)
                            : undefined
                        }
                      >
                        {listContactColumnValue(contact, column.id)}
                      </td>
                    );
                  })}
                  <td className="list-contacts-columns-cell" aria-hidden />
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

      {contactActionPrompt ? (
        <div
          className="crm-modal-backdrop"
          onClick={() => {
            if (!busyAction) {
              setContactActionPrompt(null);
            }
          }}
        >
          <div
            className="crm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="list-contact-action-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="list-contact-action-title">
                  {contactActionPrompt === "remove"
                    ? `Remove ${selectedIds.length} contact${
                        selectedIds.length === 1 ? "" : "s"
                      } from this list?`
                    : `Delete ${selectedIds.length} contact${
                        selectedIds.length === 1 ? "" : "s"
                      } from CRM?`}
                </h3>
                <p>
                  {contactActionPrompt === "remove"
                    ? "Contacts stay in CRM and other lists. Only this list membership is removed."
                    : "This permanently deletes the contacts from CRM and all lists."}
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                disabled={Boolean(busyAction)}
                onClick={() => setContactActionPrompt(null)}
              >
                ×
              </button>
            </div>
            <div
              className="crm-modal-foot"
              style={{ justifyContent: "flex-end", gap: 8 }}
            >
              <button
                type="button"
                className="btn-soft"
                disabled={Boolean(busyAction)}
                onClick={() => setContactActionPrompt(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                disabled={Boolean(busyAction)}
                onClick={() => void confirmContactAction()}
              >
                {busyAction
                  ? contactActionPrompt === "remove"
                    ? "Removing..."
                    : "Deleting..."
                  : contactActionPrompt === "remove"
                    ? "Remove from list"
                    : "Delete from CRM"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
