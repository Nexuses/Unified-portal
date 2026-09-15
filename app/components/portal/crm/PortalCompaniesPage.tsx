"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompanyWithContacts } from "@/lib/crm";
import { downloadCsv } from "@/lib/csv";
import { portalCompanyRoute } from "@/lib/portal-nav";

export default function PortalCompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyWithContacts[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    async function loadCompanies() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/crm/companies");
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load companies");
        }
        setCompanies(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load companies",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadCompanies();
  }, []);

  const filteredCompanies = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...companies].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );

    if (!query) {
      return sorted;
    }

    return sorted.filter(
      (company) =>
        company.name.toLowerCase().includes(query) ||
        company.domain.toLowerCase().includes(query) ||
        company.owner.toLowerCase().includes(query),
    );
  }, [companies, search]);

  const filteredIds = useMemo(
    () => filteredCompanies.map((company) => company.id),
    [filteredCompanies],
  );
  const selectedOnPage = filteredIds.filter((id) => selectedIds.includes(id));
  const allVisibleSelected =
    filteredIds.length > 0 && selectedOnPage.length === filteredIds.length;

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
        return current.filter((id) => !filteredIds.includes(id));
      }
      return Array.from(new Set([...current, ...filteredIds]));
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

      <div className="crm-meta-row">
        <div className="crm-count">
          {loading ? "Loading..." : `${filteredCompanies.length} companies`}
        </div>
      </div>

      {error ? <div className="crm-error">{error}</div> : null}

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="chk">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={loading || filteredIds.length === 0}
                  onChange={toggleAllVisible}
                  aria-label="Select all companies"
                />
              </th>
              <th>Company name</th>
              <th>Domain</th>
              <th>Owner</th>
              <th>Contacts</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="crm-empty">
                  Loading companies...
                </td>
              </tr>
            ) : filteredCompanies.length === 0 ? (
              <tr>
                <td colSpan={5} className="crm-empty">
                  {search.trim()
                    ? "No companies match that search."
                    : "No companies yet. Companies are created automatically when you import contacts with a company name."}
                </td>
              </tr>
            ) : (
              filteredCompanies.map((company) => (
                <tr key={company.id}>
                  <td className="chk">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(company.id)}
                      onChange={() => toggleCompany(company.id)}
                      aria-label={`Select ${company.name}`}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="company-name-link"
                      onClick={() =>
                        router.push(portalCompanyRoute(company.id))
                      }
                    >
                      {company.name}
                    </button>
                  </td>
                  <td>{company.domain || "—"}</td>
                  <td>{company.owner}</td>
                  <td>{company.contactCount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
