"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Contact, CrmList } from "@/lib/crm";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

type PortalListDetailPageProps = {
  listId: string;
};

export default function PortalListDetailPage({ listId }: PortalListDetailPageProps) {
  const router = useRouter();
  const [list, setList] = useState<CrmList | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadList() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/crm/lists/${listId}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load list");
        }
        setList(data.list);
        setContacts(data.contacts);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load list");
      } finally {
        setLoading(false);
      }
    }

    void loadList();
  }, [listId]);

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return contacts;
    }
    return contacts.filter(
      (contact) =>
        contact.fullName.toLowerCase().includes(query) ||
        contact.email.toLowerCase().includes(query),
    );
  }, [contacts, search]);

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
          <p className="desc">Contacts imported into this list</p>
        </div>
      </div>

      <div className="crm-meta-row">
        <div className="crm-count">
          {loading
            ? "Loading..."
            : `${filteredContacts.length} contacts`}
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
              <th>Email</th>
              <th>Company</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="crm-empty">
                  Loading list contacts...
                </td>
              </tr>
            ) : filteredContacts.length === 0 ? (
              <tr>
                <td colSpan={5} className="crm-empty">
                  No contacts in this list yet.
                </td>
              </tr>
            ) : (
              filteredContacts.map((contact) => (
                <tr key={contact.id}>
                  <td className="chk">
                    <input type="checkbox" readOnly />
                  </td>
                  <td>{contact.fullName}</td>
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
