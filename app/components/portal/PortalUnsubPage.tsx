"use client";

import { useEffect, useState } from "react";
import { formatListDate } from "@/lib/crm";
import { portalListRoute } from "@/lib/portal-nav";
import Link from "next/link";

type SuppressionEntry = {
  id: string;
  email: string;
  fullName: string;
  addedAt: string;
};

type SuppressionList = {
  id: string;
  name: string;
  displayId: number;
  contactCount: number;
  createdAt: string;
};

export default function PortalUnsubPage() {
  const [list, setList] = useState<SuppressionList | null>(null);
  const [entries, setEntries] = useState<SuppressionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/crm/suppression");
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load suppression list");
        }
        setList(data.list);
        setEntries(data.entries ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load suppression list");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  return (
    <>
      <div className="crm-page-head">
        <div>
          <h2>Suppression List</h2>
          <p className="desc">
            Emails that unsubscribed from campaigns are stored here and skipped on future sends.
          </p>
        </div>
      </div>

      {error ? <div className="crm-error">{error}</div> : null}

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Lists</th>
              <th>ID</th>
              <th>Contacts</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="crm-empty-cell">
                  Loading suppression list...
                </td>
              </tr>
            ) : list ? (
              <tr>
                <td>
                  <Link href={portalListRoute(list.id)} className="contact-table-link">
                    {list.name}
                  </Link>
                </td>
                <td>#{list.displayId}</td>
                <td>{list.contactCount}</td>
                <td>{formatListDate(list.createdAt)}</td>
              </tr>
            ) : (
              <tr>
                <td colSpan={4} className="crm-empty-cell">
                  No unsubscribe list yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className="drip-report-audience-title" style={{ marginTop: 28 }}>
        Unsubscribed emails
      </h3>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="crm-empty-cell">
                  Loading emails...
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={3} className="crm-empty-cell">
                  No unsubscribed emails yet.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.email}</td>
                  <td>{entry.fullName || "—"}</td>
                  <td>{formatListDate(entry.addedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
