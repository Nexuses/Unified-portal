"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CRM_IMPORT_FIELDS,
  formatListDate,
  type CrmImportField,
  type CrmList,
} from "@/lib/crm";
import {
  guessHeaderMapping,
  mapRowsToContacts,
  parseCsv,
} from "@/lib/csv";
import { portalListRoute } from "@/lib/portal-nav";

type ImportSummary = {
  imported: number;
  skipped: number;
  companiesCreated: number;
  contactsCreated: number;
  contactsUpdated: number;
};

const EMPTY_MAPPING: Record<CrmImportField, string> = {
  firstName: "",
  lastName: "",
  email: "",
  companyName: "",
};

export default function PortalListsPage() {
  const router = useRouter();
  const [lists, setLists] = useState<CrmList[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [listName, setListName] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [mapping, setMapping] =
    useState<Record<CrmImportField, string>>(EMPTY_MAPPING);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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

  const previewContacts = useMemo(() => {
    if (csvHeaders.length === 0) {
      return [];
    }
    return mapRowsToContacts(csvHeaders, csvRows.slice(0, 5), mapping);
  }, [csvHeaders, csvRows, mapping]);

  function resetModal() {
    setListName("");
    setCsvHeaders([]);
    setCsvRows([]);
    setImportFileName("");
    setMapping(EMPTY_MAPPING);
    setError("");
    setSuccess("");
  }

  function openModal() {
    resetModal();
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) {
      return;
    }
    setModalOpen(false);
    resetModal();
  }

  async function handleFileChange(file: File | null) {
    setError("");
    setSuccess("");
    if (!file) {
      setCsvHeaders([]);
      setCsvRows([]);
      setImportFileName("");
      setMapping(EMPTY_MAPPING);
      return;
    }

    const text = await file.text();
    setImportFileName(file.name);
    const parsed = parseCsv(text);

    if (parsed.headers.length === 0) {
      setError("Could not read CSV headers.");
      return;
    }

    const guessed = guessHeaderMapping(parsed.headers);
    setCsvHeaders(parsed.headers);
    setCsvRows(parsed.rows);
    setMapping({
      firstName: guessed.firstName ?? "",
      lastName: guessed.lastName ?? "",
      email: guessed.email ?? "",
      companyName: guessed.companyName ?? "",
    });
  }

  async function handleCreateList() {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (!listName.trim()) {
        throw new Error("List name is required.");
      }

      if (csvHeaders.length === 0) {
        throw new Error("Upload a CSV file to import contacts.");
      }

      for (const field of CRM_IMPORT_FIELDS) {
        if (field.required && !mapping[field.key]) {
          throw new Error(`Map the ${field.label} column before importing.`);
        }
      }

      const contacts = mapRowsToContacts(csvHeaders, csvRows, mapping);
      if (contacts.length === 0) {
        throw new Error("No valid rows found. Check your column mapping.");
      }

      const response = await fetch("/api/crm/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: listName.trim(),
          contacts,
          importFileName,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to create list");
      }

      const summary = data.importSummary as ImportSummary | null;
      const summaryText = summary
        ? `Imported ${summary.imported} contacts, created ${summary.contactsCreated} new contacts and ${summary.companiesCreated} companies.`
        : "List created successfully.";

      setSuccess(summaryText);
      await loadLists();
      setModalOpen(false);
      resetModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create list");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="crm-page-head">
        <div>
          <h2>Lists</h2>
          <p className="desc">
            This is where you organize your lists. Create, modify, and manage
            custom lists for targeted interactions, and keep them in folders for
            easy navigation.
          </p>
          <div className="help-links">
            <button className="help-link" type="button" disabled>
              Get started with Lists and Folders{" "}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M14 5h5v5M19 5 10 14" />
                <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
              </svg>
            </button>
            <button className="help-link" type="button" disabled>
              Lists vs Segments{" "}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M14 5h5v5M19 5 10 14" />
                <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
              </svg>
            </button>
          </div>
        </div>
        <div className="lists-head-right">
          <button type="button" className="link-purple" disabled>
            Recalculate now
          </button>
          <button type="button" className="btn-dark" onClick={openModal}>
            <span className="plus">+</span> Create a list
          </button>
        </div>
      </div>

      <div className="lists-toolbar">
        <button type="button" className="dd-btn" disabled>
          All folders ({lists.length} lists){" "}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
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
            placeholder="Search a list name or ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="lists-search-input"
          />
        </div>
      </div>

      {error && !modalOpen ? <div className="crm-error">{error}</div> : null}

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Lists</th>
              <th>ID</th>
              <th>Folder</th>
              <th>Contacts</th>
              <th>
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
              <th>Actions</th>
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
                  No lists yet. Create a list and upload a CSV to get started.
                </td>
              </tr>
            ) : (
              filteredLists.map((list) => (
                <tr key={list.id}>
                  <td>
                    <button
                      type="button"
                      className="name-link"
                      onClick={() => router.push(portalListRoute(list.id))}
                    >
                      {list.name}
                    </button>
                  </td>
                  <td className="id-cell">#{list.displayId}</td>
                  <td>—</td>
                  <td>{list.contactCount}</td>
                  <td>{formatListDate(list.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="kebab"
                      aria-label="Actions"
                      disabled
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="12" cy="19" r="1.6" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen ? (
        <div className="crm-modal-backdrop" onClick={closeModal}>
          <div
            className="crm-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-list-title"
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="create-list-title">Create a list</h3>
                <p>
                  Upload a CSV, map columns to first name, last name, email, and
                  company name, then import into CRM.
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                onClick={closeModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="crm-modal-body">
              <div className="crm-field">
                <label htmlFor="list-name">List name</label>
                <input
                  id="list-name"
                  value={listName}
                  onChange={(event) => setListName(event.target.value)}
                  placeholder="e.g. Q3 prospects"
                />
              </div>

              <div className="crm-field">
                <label htmlFor="list-file">CSV file</label>
                <input
                  id="list-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) =>
                    void handleFileChange(event.target.files?.[0] ?? null)
                  }
                />
              </div>

              {csvHeaders.length > 0 ? (
                <>
                  <div className="crm-mapping-grid">
                    {CRM_IMPORT_FIELDS.map((field) => (
                      <div className="crm-field" key={field.key}>
                        <label htmlFor={`map-${field.key}`}>
                          {field.label}
                          {field.required ? " *" : ""}
                        </label>
                        <select
                          id={`map-${field.key}`}
                          value={mapping[field.key]}
                          onChange={(event) =>
                            setMapping((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Select column</option>
                          {csvHeaders.map((header) => (
                            <option key={header} value={header}>
                              {header}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  <div className="crm-preview">
                    <table>
                      <thead>
                        <tr>
                          <th>First name</th>
                          <th>Last name</th>
                          <th>Email</th>
                          <th>Company</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewContacts.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="crm-empty">
                              Map required columns to preview imported rows.
                            </td>
                          </tr>
                        ) : (
                          previewContacts.map((row, index) => (
                            <tr key={`${row.email}-${index}`}>
                              <td>{row.firstName}</td>
                              <td>{row.lastName}</td>
                              <td>{row.email}</td>
                              <td>{row.companyName || "—"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              {error ? <div className="crm-error">{error}</div> : null}
              {success ? <div className="crm-summary">{success}</div> : null}
            </div>

            <div className="crm-modal-foot">
              <button
                type="button"
                className="btn-soft"
                onClick={closeModal}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                onClick={() => void handleCreateList()}
                disabled={saving}
              >
                {saving ? "Importing..." : "Create & import"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
