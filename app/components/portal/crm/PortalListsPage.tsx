"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatListDate, type CrmList } from "@/lib/crm";
import { PORTAL_ROUTES, portalListRoute } from "@/lib/portal-nav";

const LISTS_PAGE_SIZE = 15;

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7 7.4 19a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function ListsPagination({
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

export default function PortalListsPage() {
  const router = useRouter();
  const [lists, setLists] = useState<CrmList[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState<{
    ids: string[];
    label: string;
  } | null>(null);
  const [renamePrompt, setRenamePrompt] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  async function loadLists() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/crm/lists");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load lists");
      }
      setLists((data as CrmList[]).filter((list) => list.name !== "Unsubscribe"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lists");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLists();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    if (!openMenuId) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuId(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenuId]);

  useEffect(() => {
    if (!renamePrompt) {
      return;
    }
    const timer = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [renamePrompt]);

  const filteredLists = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = query
      ? lists.filter(
          (list) =>
            list.name.toLowerCase().includes(query) ||
            String(list.displayId).includes(query),
        )
      : lists;

    return [...matched].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [lists, search]);

  const totalPages = Math.max(1, Math.ceil(filteredLists.length / LISTS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageLists = filteredLists.slice(
    (currentPage - 1) * LISTS_PAGE_SIZE,
    currentPage * LISTS_PAGE_SIZE,
  );

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pageIds = useMemo(() => pageLists.map((list) => list.id), [pageLists]);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  function toggleAll(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        for (const id of pageIds) {
          next.add(id);
        }
      } else {
        for (const id of pageIds) {
          next.delete(id);
        }
      }
      return next;
    });
  }

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function askDeleteLists(ids: string[], label: string) {
    if (ids.length === 0) {
      return;
    }
    setOpenMenuId(null);
    setDeletePrompt({ ids, label });
  }

  function askRenameList(list: CrmList) {
    setOpenMenuId(null);
    setError("");
    setRenamePrompt({ id: list.id, name: list.name });
    setRenameValue(list.name);
  }

  async function confirmRenameList() {
    if (!renamePrompt || renaming) {
      return;
    }
    const nextName = renameValue.trim();
    if (!nextName) {
      setError("List name is required");
      return;
    }
    if (nextName === renamePrompt.name) {
      setRenamePrompt(null);
      return;
    }

    setRenaming(true);
    setError("");
    try {
      const response = await fetch(
        `/api/crm/lists/${encodeURIComponent(renamePrompt.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nextName }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to rename list");
      }
      const updated = data.list as CrmList | undefined;
      setLists((current) =>
        current.map((list) =>
          list.id === renamePrompt.id
            ? {
                ...list,
                name: updated?.name ?? nextName,
              }
            : list,
        ),
      );
      setSuccess(`List renamed to "${updated?.name ?? nextName}".`);
      setRenamePrompt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename list");
    } finally {
      setRenaming(false);
    }
  }

  async function confirmDeleteLists(deleteContacts: boolean) {
    if (!deletePrompt || deleting) {
      return;
    }
    const { ids, label } = deletePrompt;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch("/api/crm/lists", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, deleteContacts }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete lists");
      }
      const removed = new Set(ids);
      setLists((current) => current.filter((list) => !removed.has(list.id)));
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of ids) {
          next.delete(id);
        }
        return next;
      });
      const contactsDeleted = Number(data.contactsDeleted) || 0;
      const listNote =
        ids.length === 1
          ? `List "${label}" deleted.`
          : `${ids.length} lists deleted.`;
      setSuccess(
        deleteContacts && contactsDeleted > 0
          ? `${listNote} ${contactsDeleted.toLocaleString()} contact${
              contactsDeleted === 1 ? "" : "s"
            } removed from CRM.`
          : listNote,
      );
      setDeletePrompt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete lists");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="crm-page-head">
        <div>
          <h2>Lists</h2>
          <p className="desc">
            This is where you organize your lists. Create, modify, and manage
            custom lists for targeted interactions.
          </p>
        </div>
        <div className="lists-head-right">
          <button
            type="button"
            className="btn-dark"
            onClick={() => router.push(`${PORTAL_ROUTES.lists}/new`)}
          >
            <span className="plus">+</span> Create a list
          </button>
        </div>
      </div>

      <div className="crm-tabs">
        <button type="button" className="crm-tab active">
          All lists
        </button>
      </div>

      <div className="drip-toolbar">
        {selectedIds.size > 0 ? (
          <button
            type="button"
            className="lists-bulk-delete"
            disabled={deleting}
            onClick={() =>
              askDeleteLists(
                [...selectedIds],
                lists.find((list) => selectedIds.has(list.id))?.name ?? "list",
              )
            }
          >
            {deleting ? "Deleting..." : `Delete (${selectedIds.size})`}
          </button>
        ) : null}
        <label className="drip-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Search a list name or ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {error ? <div className="crm-error">{error}</div> : null}
      {success ? <div className="crm-summary">{success}</div> : null}

      {!loading ? (
        <ListsPagination
          total={filteredLists.length}
          page={currentPage}
          pageSize={LISTS_PAGE_SIZE}
          onPage={setPage}
        />
      ) : null}

      <div className="data-table-wrap lists-table-wrap">
        <table className="data-table lists-index-table">
          <thead>
            <tr>
              <th className="chk">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  disabled={loading || pageIds.length === 0 || deleting}
                  onChange={(event) => toggleAll(event.target.checked)}
                  aria-label="Select all lists on this page"
                />
              </th>
              <th className="lists-name-cell">Lists</th>
              <th className="lists-id-cell">ID</th>
              <th className="lists-count-cell">Contacts</th>
              <th className="lists-date-cell">
                <span className="th-sort">
                  Creation date{" "}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </span>
              </th>
              <th className="lists-actions-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="crm-empty">
                  Loading lists...
                </td>
              </tr>
            ) : filteredLists.length === 0 ? (
              <tr>
                <td colSpan={6} className="crm-empty">
                  {search.trim()
                    ? "No lists match that search."
                    : "No lists yet. Create a list and upload a CSV to get started."}
                </td>
              </tr>
            ) : (
              pageLists.map((list) => (
                <tr key={list.id}>
                  <td className="chk">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(list.id)}
                      disabled={deleting}
                      onChange={(event) =>
                        toggleOne(list.id, event.target.checked)
                      }
                      aria-label={`Select ${list.name}`}
                    />
                  </td>
                  <td className="lists-name-cell">
                    <button
                      type="button"
                      className="name-link lists-name-link"
                      title={list.name}
                      onClick={() => router.push(portalListRoute(list.id))}
                    >
                      {list.name}
                    </button>
                  </td>
                  <td className="lists-id-cell id-cell">#{list.displayId}</td>
                  <td className="lists-count-cell">{list.contactCount}</td>
                  <td className="lists-date-cell">{formatListDate(list.createdAt)}</td>
                  <td className="lists-actions lists-actions-cell">
                    <div
                      className="drip-more-wrap"
                      ref={openMenuId === list.id ? menuRef : undefined}
                    >
                      <button
                        type="button"
                        className={`kebab${openMenuId === list.id ? " active" : ""}`}
                        aria-label={`Actions for ${list.name}`}
                        aria-expanded={openMenuId === list.id}
                        disabled={deleting || renaming}
                        onClick={() =>
                          setOpenMenuId((current) =>
                            current === list.id ? null : list.id,
                          )
                        }
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="1.6" />
                          <circle cx="12" cy="12" r="1.6" />
                          <circle cx="12" cy="19" r="1.6" />
                        </svg>
                      </button>
                      {openMenuId === list.id ? (
                        <div className="drip-more-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            disabled={deleting || renaming}
                            onClick={() => askRenameList(list)}
                          >
                            <EditIcon />
                            Edit
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="danger"
                            disabled={deleting || renaming}
                            onClick={() => askDeleteLists([list.id], list.name)}
                          >
                            <TrashIcon />
                            {deleting ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading ? (
        <div className="crm-contacts-pager-bottom">
          <ListsPagination
            total={filteredLists.length}
            page={currentPage}
            pageSize={LISTS_PAGE_SIZE}
            onPage={setPage}
          />
        </div>
      ) : null}

      {renamePrompt ? (
        <div
          className="crm-modal-backdrop"
          onClick={() => {
            if (!renaming) {
              setRenamePrompt(null);
            }
          }}
        >
          <div
            className="crm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lists-rename-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="lists-rename-title">Edit list name</h3>
                <p>Update the name for this list.</p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                disabled={renaming}
                onClick={() => setRenamePrompt(null)}
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body">
              <div className="crm-field">
                <label htmlFor="lists-rename-input">List name</label>
                <input
                  ref={renameInputRef}
                  id="lists-rename-input"
                  type="text"
                  value={renameValue}
                  maxLength={120}
                  disabled={renaming}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void confirmRenameList();
                    }
                  }}
                />
              </div>
            </div>
            <div className="crm-modal-foot" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="btn-soft"
                disabled={renaming}
                onClick={() => setRenamePrompt(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                disabled={renaming || !renameValue.trim()}
                onClick={() => void confirmRenameList()}
              >
                {renaming ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deletePrompt ? (
        <div
          className="crm-modal-backdrop"
          onClick={() => {
            if (!deleting) {
              setDeletePrompt(null);
            }
          }}
        >
          <div
            className="crm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lists-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="lists-delete-title">
                  {deletePrompt.ids.length === 1
                    ? `Delete list "${deletePrompt.label}"?`
                    : `Delete ${deletePrompt.ids.length} lists?`}
                </h3>
                <p>
                  Choose whether contacts in {deletePrompt.ids.length === 1 ? "this list" : "these lists"} stay in CRM or are deleted too.
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                disabled={deleting}
                onClick={() => setDeletePrompt(null)}
              >
                ×
              </button>
            </div>
            <div className="crm-modal-foot" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-soft"
                disabled={deleting}
                onClick={() => setDeletePrompt(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-soft"
                disabled={deleting}
                onClick={() => void confirmDeleteLists(false)}
              >
                {deleting ? "Deleting..." : "Delete list only"}
              </button>
              <button
                type="button"
                className="btn-dark"
                disabled={deleting}
                onClick={() => void confirmDeleteLists(true)}
              >
                {deleting ? "Deleting..." : "Delete list and contacts"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
