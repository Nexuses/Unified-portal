"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompanyWithContacts } from "@/lib/crm";
import { portalCompanyRoute } from "@/lib/portal-nav";

export default function PortalCompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyWithContacts[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

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

  return (
    <>
      <div className="crm-page-head">
        <h2>Companies</h2>
        <div className="crm-actions">
          <button type="button" className="btn-soft" disabled>
            Import companies
          </button>
          <button type="button" className="btn-dark" disabled>
            Create company
          </button>
        </div>
      </div>

      <div className="crm-tabs">
        <button type="button" className="crm-tab active">
          All companies
        </button>
        <button
          type="button"
          className="crm-tab-add"
          aria-label="Add view"
          disabled
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="crm-filter-row">
        <button type="button" className="dd-btn" disabled>
          Add filter{" "}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <div className="spacer" />
        <button
          type="button"
          className="icon-square"
          aria-label="Settings"
          disabled
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </div>

      <div className="crm-meta-row">
        <div className="crm-count">
          {loading ? "Loading..." : `${filteredCompanies.length} companies`}
        </div>
        <div className="crm-meta-right">
          <button type="button" className="link-purple" disabled>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <rect x="3" y="4" width="7" height="16" rx="1" />
              <rect x="14" y="4" width="7" height="10" rx="1" />
            </svg>
            Customize columns
          </button>
          <div className="search-input wide">
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
              placeholder="Company name, domain"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="lists-search-input"
            />
          </div>
        </div>
      </div>

      {error ? <div className="crm-error">{error}</div> : null}

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="chk">
                <input type="checkbox" readOnly />
              </th>
              <th>
                <span className="th-sort">
                  Company name{" "}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="m8 9 4 4 4-4M16 15l-4-4-4 4" />
                  </svg>
                </span>
              </th>
              <th>
                <span className="th-sort">
                  Domain{" "}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="m8 9 4 4 4-4M16 15l-4-4-4 4" />
                  </svg>
                </span>
              </th>
              <th>
                <span className="th-sort">
                  Owner{" "}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="m8 9 4 4 4-4M16 15l-4-4-4 4" />
                  </svg>
                </span>
              </th>
              <th>
                <span className="th-sort">
                  Phone number{" "}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="m8 9 4 4 4-4M16 15l-4-4-4 4" />
                  </svg>
                </span>
              </th>
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
                  No companies yet. Companies are created automatically when
                  you import contacts with a company name.
                </td>
              </tr>
            ) : (
              filteredCompanies.map((company) => (
                <tr key={company.id}>
                  <td className="chk">
                    <input type="checkbox" readOnly />
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
                  <td className="muted-cell">—</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
