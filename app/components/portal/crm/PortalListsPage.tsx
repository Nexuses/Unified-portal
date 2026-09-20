"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatListDate, type CrmList } from "@/lib/crm";
import { PORTAL_ROUTES, portalListRoute } from "@/lib/portal-nav";

const LISTS_PAGE_SIZE = 15;

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

  async function deleteSelectedLists(ids: string[], label: string) {
    if (ids.length === 0) {
      return;
    }

    const confirmText =
      ids.length === 1
        ? `Delete list "${label}"? Contacts stay in CRM.`
        : `Delete ${ids.length} lists? Contacts stay in CRM.`;
    if (!window.confirm(confirmText)) {
      setOpenMenuId(null);
      return;
    }

    setDeleting(true);
    setOpenMenuId(null);
    setError("");
    try {
      const response = await fetch("/api/crm/lists", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
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
      setSuccess(
        ids.length === 1 ? "List deleted." : `${ids.length} lists deleted.`,
      );
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
              void deleteSelectedLists(
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
                        disabled={deleting}
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
                            className="danger"
                            disabled={deleting}
                            onClick={() =>
                              void deleteSelectedLists([list.id], list.name)
                            }
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
    </>
  );
}
