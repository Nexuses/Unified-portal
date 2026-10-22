"use client";

import { useEffect, useMemo, useState } from "react";
import type { CampaignReportTables } from "@/lib/campaign-report-tables";

type TableKey = "companies" | "sent" | "clickers" | "opensOnly" | "bounces" | "summary";

type Column = { label: string; key: string; numeric?: boolean };

const TABLES: Array<{ key: TableKey; label: string; columns: Column[] }> = [
  {
    key: "companies",
    label: "Companies",
    columns: [
      { label: "Company", key: "company" },
      { label: "Domain", key: "domain" },
      { label: "Contacts", key: "contacts", numeric: true },
      { label: "Sent", key: "sent", numeric: true },
      { label: "Opened", key: "opened", numeric: true },
      { label: "Clicked", key: "clicked", numeric: true },
      { label: "Bounced", key: "bounced", numeric: true },
      { label: "Unsubscribed", key: "unsubscribed", numeric: true },
      { label: "Open rate", key: "openRate", numeric: true },
      { label: "Click rate", key: "clickRate", numeric: true },
    ],
  },
  {
    key: "sent",
    label: "Sent",
    columns: [
      { label: "Person", key: "name" },
      { label: "Email", key: "email" },
      { label: "Company", key: "company" },
      { label: "Domain", key: "domain" },
      { label: "Step", key: "step" },
      { label: "Send date", key: "date" },
      { label: "Send time", key: "time" },
    ],
  },
  {
    key: "clickers",
    label: "Clickers",
    columns: [
      { label: "Person", key: "name" },
      { label: "Email", key: "email" },
      { label: "Company", key: "company" },
      { label: "Domain", key: "domain" },
      { label: "Open date", key: "openDate" },
      { label: "Open time", key: "openTime" },
      { label: "Opens", key: "opens", numeric: true },
      { label: "Clicks", key: "clicks", numeric: true },
      { label: "CTA clicked", key: "cta" },
      { label: "Status", key: "status" },
    ],
  },
  {
    key: "opensOnly",
    label: "Opens only",
    columns: [
      { label: "Person", key: "name" },
      { label: "Email", key: "email" },
      { label: "Company", key: "company" },
      { label: "Domain", key: "domain" },
      { label: "Open date", key: "openDate" },
      { label: "Open time", key: "openTime" },
      { label: "Opens", key: "opens", numeric: true },
      { label: "Status", key: "status" },
    ],
  },
  {
    key: "bounces",
    label: "Bounces",
    columns: [
      { label: "Person", key: "name" },
      { label: "Email", key: "email" },
      { label: "Company", key: "company" },
      { label: "Domain", key: "domain" },
      { label: "Reason", key: "reason" },
      { label: "Bounced date", key: "date" },
      { label: "Bounced time", key: "time" },
    ],
  },
  {
    key: "summary",
    label: "Summary",
    columns: [
      { label: "Metric", key: "metric" },
      { label: "Value", key: "value" },
    ],
  },
];

const PAGE_SIZE = 50;

const loaded = new Map<string, CampaignReportTables>();

type Row = Record<string, string | number>;

export default function PortalCampaignReportTable({ url }: { url: string }) {
  const [data, setData] = useState<CampaignReportTables | null>(() => loaded.get(url) ?? null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<TableKey>("companies");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let live = true;
    if (loaded.has(url)) return;
    void (async () => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as
          | (CampaignReportTables & { error?: string })
          | null;
        if (!response.ok || !body) throw new Error(body?.error || "Failed to load the report table");
        loaded.set(url, body);
        if (live) setData(body);
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : "Failed to load the report table");
      }
    })();
    return () => {
      live = false;
    };
  }, [url]);

  const rowsByTable = useMemo<Record<TableKey, Row[]>>(() => {
    if (!data) {
      return { companies: [], sent: [], clickers: [], opensOnly: [], bounces: [], summary: [] };
    }
    const summaryRows = Array.isArray(data.summary)
      ? data.summary.map((row) => {
          if (Array.isArray(row)) {
            const [metric, value] = row;
            return { metric, value };
          }
          return { metric: "", value: "" };
        })
      : [];
    return {
      companies: Array.isArray(data.companies) ? data.companies : [],
      sent: Array.isArray(data.sent) ? data.sent : [],
      clickers: Array.isArray(data.clickers) ? data.clickers : [],
      opensOnly: Array.isArray(data.opensOnly) ? data.opensOnly : [],
      bounces: Array.isArray(data.bounces) ? data.bounces : [],
      summary: summaryRows,
    };
  }, [data]);

  const table = TABLES.find((item) => item.key === active) ?? TABLES[0];
  const query = search.trim().toLowerCase();
  const rows = query
    ? rowsByTable[active].filter((row) =>
        table.columns.some((column) => String(row[column.key] ?? "").toLowerCase().includes(query)),
      )
    : rowsByTable[active];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function pick(key: TableKey) {
    setActive(key);
    setPage(1);
  }

  if (error) return <p className="crm-error">{error}</p>;

  return (
    <div className="drip-report-table-view">
      <div className="drip-report-table-bar">
        <div className="drip-report-tabs">
          {TABLES.map((item) => (
            <button
              key={item.key}
              type="button"
              className={active === item.key ? "active" : ""}
              onClick={() => pick(item.key)}
            >
              {item.label}
              {data ? <span className="drip-report-table-count">{rowsByTable[item.key].length}</span> : null}
            </button>
          ))}
        </div>
        {active !== "summary" ? (
          <input
            type="search"
            placeholder="Search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="lists-search-input drip-report-table-search"
          />
        ) : null}
      </div>

      <div className="data-table-wrap">
        <table className="data-table drip-report-table">
          <thead>
            <tr>
              <th className="drip-report-table-num">#</th>
              {table.columns.map((column) => (
                <th key={column.key} className={column.numeric ? "drip-report-table-num" : undefined}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr>
                <td colSpan={table.columns.length + 1} className="crm-empty">
                  Loading report… Large campaigns can take a few seconds.
                </td>
              </tr>
            ) : paged.length === 0 ? (
              <tr>
                <td colSpan={table.columns.length + 1} className="crm-empty">
                  {query ? "No rows match your search." : "No records yet."}
                </td>
              </tr>
            ) : (
              paged.map((row, index) => (
                <tr key={`${active}-${(currentPage - 1) * PAGE_SIZE + index}`}>
                  <td className="drip-report-table-num">{(currentPage - 1) * PAGE_SIZE + index + 1}</td>
                  {table.columns.map((column) => {
                    const value = row[column.key];
                    const text = value === "" || value === undefined ? "—" : String(value);
                    return (
                      <td
                        key={column.key}
                        data-label={column.label}
                        className={column.numeric ? "drip-report-table-num" : undefined}
                      >
                        {column.key === "status" ? (
                          <span className={`drip-report-status is-${text.toLowerCase()}`}>{text}</span>
                        ) : (
                          text
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && rows.length > PAGE_SIZE ? (
        <div className="drip-pagination">
          <span className="drip-page-range">
            {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, rows.length)} of{" "}
            {rows.length}
          </span>
          <div className="drip-page-controls">
            <button
              type="button"
              className="drip-page-arrow"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
              aria-label="Previous page"
            >
              ‹
            </button>
            <button
              type="button"
              className="drip-page-arrow"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
