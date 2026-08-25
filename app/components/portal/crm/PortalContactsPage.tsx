"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Contact } from "@/lib/crm";
import { portalContactRoute } from "@/lib/portal-nav";

export default function PortalContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadContacts() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/crm/contacts");
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load contacts");
        }
        setContacts(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load contacts");
      } finally {
        setLoading(false);
      }
    }

    void loadContacts();
  }, []);

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...contacts].sort((left, right) =>
      left.fullName.localeCompare(right.fullName, undefined, {
        sensitivity: "base",
      }),
    );

    if (!query) {
      return sorted;
    }

    return sorted.filter(
      (contact) =>
        contact.fullName.toLowerCase().includes(query) ||
        contact.email.toLowerCase().includes(query) ||
        contact.companyName.toLowerCase().includes(query),
    );
  }, [contacts, search]);

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
          <button type="button" className="btn-soft" disabled>
            Create a contact
          </button>
          <button type="button" className="btn-dark" disabled>
            Import contacts
          </button>
        </div>
      </div>

      <div className="crm-tabs">
        <button type="button" className="crm-tab active">
          All contacts
        </button>
      </div>

      <div className="crm-meta-row">
        <div className="crm-count">
          {loading ? "Loading..." : `${filteredContacts.length} contacts`}
        </div>
        <div className="crm-meta-right">
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
              placeholder="Search"
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
              <th>Contact</th>
              <th>Subscribed</th>
              <th>Blocklisted</th>
              <th>Email</th>
              <th>Company</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="crm-empty">
                  Loading contacts...
                </td>
              </tr>
            ) : filteredContacts.length === 0 ? (
              <tr>
                <td colSpan={6} className="crm-empty">
                  No contacts yet. Create a list and upload a CSV to import
                  contacts.
                </td>
              </tr>
            ) : (
              filteredContacts.map((contact) => (
                <tr key={contact.id}>
                  <td className="chk">
                    <input type="checkbox" readOnly />
                  </td>
                  <td>
                    <Link href={portalContactRoute(contact.id)} className="contact-table-link">
                      {contact.fullName}
                    </Link>
                  </td>
                  <td>
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
                  </td>
                  <td className="muted-cell">
                    {contact.blocklisted ? "Yes" : ""}
                  </td>
                  <td className="email-cell">{contact.email}</td>
                  <td>{contact.companyName || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
