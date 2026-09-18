"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_LIST_ATTRIBUTES,
  type Contact,
  type CrmList,
} from "@/lib/crm";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

type PortalListDetailPageProps = {
  listId: string;
};

const CORE_FIELDS = new Set(["firstName", "lastName", "email", "companyName"]);

function emptyAttributeValues() {
  return Object.fromEntries(
    DEFAULT_LIST_ATTRIBUTES.map((field) => [field.key, ""]),
  ) as Record<string, string>;
}

export default function PortalListDetailPage({ listId }: PortalListDetailPageProps) {
  const router = useRouter();
  const [list, setList] = useState<CrmList | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(emptyAttributeValues);
  const [modalError, setModalError] = useState("");
  const [saving, setSaving] = useState(false);
  const [successNote, setSuccessNote] = useState("");

  const loadList = useCallback(async () => {
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
  }, [listId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

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

  function openAddModal() {
    setValues(emptyAttributeValues());
    setModalError("");
    setSuccessNote("");
    setModalOpen(true);
  }

  function closeAddModal() {
    if (saving) {
      return;
    }
    setModalOpen(false);
    setModalError("");
  }

  async function handleAddContact() {
    setSaving(true);
    setModalError("");
    try {
      const firstName = values.firstName?.trim() ?? "";
      const lastName = values.lastName?.trim() ?? "";
      const email = values.email?.trim() ?? "";
      const companyName = values.companyName?.trim() ?? "";
      if (!firstName || !email || !companyName) {
        throw new Error("First Name, Email, and Company Name are required.");
      }

      const attributes: Record<string, string> = {};
      for (const field of DEFAULT_LIST_ATTRIBUTES) {
        if (CORE_FIELDS.has(field.key)) {
          continue;
        }
        const value = values[field.key]?.trim() ?? "";
        if (value) {
          attributes[field.key] = value;
        }
      }

      const response = await fetch(`/api/crm/lists/${encodeURIComponent(listId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contacts: [
            {
              firstName,
              lastName,
              email,
              companyName,
              attributes,
            },
          ],
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to add contact");
      }

      setModalOpen(false);
      setValues(emptyAttributeValues());
      setSuccessNote(`Added ${email} to this list.`);
      await loadList();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Failed to add contact");
    } finally {
      setSaving(false);
    }
  }

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
          <p className="desc">
            Contacts in this list. Import via CSV when creating a list, or add
            one manually here.
          </p>
        </div>
        <div className="crm-actions">
          <button
            type="button"
            className="btn-dark"
            onClick={openAddModal}
            disabled={loading || !list}
          >
            Add contact
          </button>
        </div>
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
      {successNote ? <div className="crm-summary">{successNote}</div> : null}

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
                  No contacts in this list yet. Click Add contact to add one
                  manually.
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

      {modalOpen ? (
        <div className="crm-modal-backdrop" onClick={closeAddModal}>
          <div
            className="crm-modal crm-modal-wide"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="list-add-contact-title"
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="list-add-contact-title">Add contact</h3>
                <p>
                  Add a contact to{" "}
                  <strong>{list?.name ?? "this list"}</strong>
                  {list?.displayId ? ` (#${list.displayId})` : ""}. First Name,
                  Email, and Company Name are required.
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                onClick={closeAddModal}
                aria-label="Close"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <div className="crm-modal-body">
              <div className="crm-mapping-grid">
                {DEFAULT_LIST_ATTRIBUTES.map((field) => (
                  <div className="crm-field" key={field.key}>
                    <label htmlFor={`list-add-contact-${field.key}`}>
                      {field.label}
                      {field.required ? " *" : ""}
                    </label>
                    <input
                      id={`list-add-contact-${field.key}`}
                      value={values[field.key] ?? ""}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      placeholder={field.label}
                      disabled={saving}
                      type={
                        field.key === "email"
                          ? "email"
                          : field.key === "phoneNumber"
                            ? "tel"
                            : "text"
                      }
                    />
                  </div>
                ))}
              </div>

              {modalError ? <div className="crm-error">{modalError}</div> : null}
            </div>

            <div className="crm-modal-foot">
              <button
                type="button"
                className="btn-soft"
                onClick={closeAddModal}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                onClick={() => void handleAddContact()}
                disabled={saving}
              >
                {saving ? "Saving…" : "Add contact"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
