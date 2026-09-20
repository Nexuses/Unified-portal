"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompanyWithContacts } from "@/lib/crm";
import { downloadCsv } from "@/lib/csv";
import { portalCompanyRoute } from "@/lib/portal-nav";

const COMPANIES_PAGE_SIZE = 50;

type CompaniesPageResponse = {
  items: CompanyWithContacts[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function CompaniesPagination({
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

export default function PortalCompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyWithContacts[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [debouncedSearch]);

  async function loadCompaniesPage(nextPage = page) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(COMPANIES_PAGE_SIZE),
      });
      if (debouncedSearch) {
        params.set("q", debouncedSearch);
      }
      const response = await fetch(`/api/crm/companies?${params.toString()}`);
      const data = (await response.json()) as CompaniesPageResponse | { error?: string };
      if (!response.ok || !("items" in data)) {
        throw new Error(
          !response.ok && data && "error" in data && data.error
            ? data.error
            : "Failed to load companies",
        );
      }
      if (requestId !== requestIdRef.current) {
        return;
      }
      setCompanies(data.items);
      setTotal(data.total);
      const maxPage = Math.max(
        1,
        data.totalPages || Math.ceil(data.total / COMPANIES_PAGE_SIZE),
      );
      if (nextPage > maxPage) {
        setPage(maxPage);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load companies");
      setCompanies([]);
      setTotal(0);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadCompaniesPage(page);
  }, [page, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(total / COMPANIES_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pageIds = useMemo(
    () => companies.map((company) => company.id),
    [companies],
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

  function toggleCompany(id: string) {
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

  function exportSelectedContacts() {
    const selected = companies.filter((company) =>
      selectedIds.includes(company.id),
    );
    const rows = selected.flatMap((company) =>
      company.contacts.map((contact) => [
        contact.fullName,
        contact.email,
        company.name,
        company.domain,
      ]),
    );
    if (rows.length === 0) {
      setError("Selected companies have no contacts to export.");
      return;
    }
    setError("");
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `company-contacts-${stamp}.csv`,
      ["Contact", "Email", "Company", "Domain"],
      rows,
    );
  }

  return (
    <>
      <div className="crm-page-head">
        <div>
          <h2>Companies</h2>
          <p className="desc">
            Companies created from imported contacts, with associated people in
            one place.
          </p>
        </div>
        <div className="crm-actions">
          <button
            type="button"
            className="btn-dark"
            disabled={selectedIds.length === 0}
            onClick={exportSelectedContacts}
          >
            {selectedIds.length > 0
              ? `Export contacts (${selectedIds.length})`
              : "Export contacts"}
          </button>
        </div>
      </div>

      <div className="crm-tabs">
        <button type="button" className="crm-tab active">
          All companies
        </button>
      </div>

      <div className="drip-toolbar">
        <label className="drip-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Search by company name or domain"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {error ? <div className="crm-error">{error}</div> : null}

      <CompaniesPagination
        total={total}
        page={currentPage}
        pageSize={COMPANIES_PAGE_SIZE}
        onPage={setPage}
      />

      <div className="data-table-wrap">
        <table className="data-table companies-table">
          <thead>
            <tr>
              <th className="chk">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={loading || pageIds.length === 0}
                  onChange={toggleAllVisible}
                  aria-label="Select all companies on this page"
                />
              </th>
              <th className="company-name-cell">Company name</th>
              <th className="company-domain-cell">Domain</th>
              <th className="company-owner-cell">Owner</th>
              <th className="company-contacts-cell">Contacts</th>
            </tr>
          </thead>
          <tbody>
            {loading && companies.length === 0 ? (
              <tr>
                <td colSpan={5} className="crm-empty">
                  Loading companies...
                </td>
              </tr>
            ) : total === 0 ? (
              <tr>
                <td colSpan={5} className="crm-empty">
                  {debouncedSearch
                    ? "No companies match that search."
                    : "No companies yet. Companies are created automatically when you import contacts with a company name."}
                </td>
              </tr>
            ) : (
              companies.map((company) => (
                <tr key={company.id}>
                  <td className="chk">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(company.id)}
                      onChange={() => toggleCompany(company.id)}
                      aria-label={`Select ${company.name}`}
                    />
                  </td>
                  <td className="company-name-cell">
                    <button
                      type="button"
                      className="company-name-link"
                      title={company.name}
                      onClick={() => router.push(portalCompanyRoute(company.id))}
                    >
                      {company.name}
                    </button>
                  </td>
                  <td className="company-domain-cell" title={company.domain || undefined}>
                    <span className="company-ellipsis">{company.domain || "—"}</span>
                  </td>
                  <td className="company-owner-cell" title={company.owner}>
                    <span className="company-ellipsis">{company.owner}</span>
                  </td>
                  <td className="company-contacts-cell">
                    {company.contactCount ?? company.contacts.length}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="crm-contacts-pager-bottom">
        <CompaniesPagination
          total={total}
          page={currentPage}
          pageSize={COMPANIES_PAGE_SIZE}
          onPage={setPage}
        />
      </div>
    </>
  );
}
