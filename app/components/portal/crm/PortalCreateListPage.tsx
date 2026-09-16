"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONTACT_ATTRIBUTE_LABELS,
  DEFAULT_LIST_ATTRIBUTES,
  REQUIRED_CONTACT_FIELDS,
  slugifyAttributeKey,
  type ListAttributeDef,
} from "@/lib/crm";
import {
  downloadCsv,
  guessHeaderMapping,
  mapRowsToContacts,
  parseCsv,
} from "@/lib/csv";
import { PORTAL_ROUTES, portalListRoute } from "@/lib/portal-nav";

type WizardStep = "name" | "upload" | "mapping" | "confirm";

const STEP_ORDER: WizardStep[] = ["name", "upload", "mapping", "confirm"];

function CloudUploadIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden>
      <path
        d="M16 32c-4.4 0-8-3.4-8-7.6 0-3.6 2.5-6.7 5.9-7.5C15.2 12.4 19.3 9 24.2 9c6 0 10.9 4.6 11.3 10.4 3.6.4 6.5 3.5 6.5 7.2 0 4-3.3 7.4-7.4 7.4H16z"
        stroke="#60a5fa"
        strokeWidth="2.2"
        fill="#eff6ff"
      />
      <path
        d="M24 34V22M24 22l-4.5 4.5M24 22l4.5 4.5"
        stroke="#2563eb"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function buildAutoColumnMapping(
  headers: string[],
  attributes: ListAttributeDef[],
) {
  const guessed = guessHeaderMapping(headers);
  const attributeKeys = new Set(attributes.map((item) => item.key));
  const nextMapping: Record<string, string> = {};
  const usedFields = new Set<string>();

  for (const header of headers) {
    nextMapping[header] = "";
  }

  for (const [field, header] of Object.entries(guessed)) {
    if (!attributeKeys.has(field) || usedFields.has(field)) {
      continue;
    }
    nextMapping[header] = field;
    usedFields.add(field);
  }

  return nextMapping;
}

export default function PortalCreateListPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState<WizardStep>("name");
  const [listName, setListName] = useState("");
  const [attributes, setAttributes] = useState<ListAttributeDef[]>(() =>
    DEFAULT_LIST_ATTRIBUTES.map((item) => ({ ...item })),
  );
  const [newAttributeLabel, setNewAttributeLabel] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [importFileName, setImportFileName] = useState("");
  /** CSV header -> attribute key (or "") */
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>(
    {},
  );
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function attributeLabel(key: string) {
    return (
      attributes.find((item) => item.key === key)?.label ??
      CONTACT_ATTRIBUTE_LABELS[key] ??
      key
    );
  }

  const fieldMapping = useMemo(() => {
    const next: Record<string, string> = {};
    for (const [header, field] of Object.entries(columnMapping)) {
      if (field) {
        next[field] = header;
      }
    }
    return next;
  }, [columnMapping]);

  const mappedContacts = useMemo(() => {
    if (csvHeaders.length === 0) {
      return [];
    }
    return mapRowsToContacts(csvHeaders, csvRows, fieldMapping).filter((row) =>
      REQUIRED_CONTACT_FIELDS.every((field) => row[field].trim()),
    );
  }, [csvHeaders, csvRows, fieldMapping]);

  const previewContacts = mappedContacts.slice(0, 8);

  const sampleForHeader = (header: string) => {
    const index = csvHeaders.indexOf(header);
    if (index < 0) {
      return [];
    }
    return csvRows
      .map((row) => row[index] ?? "")
      .filter(Boolean)
      .slice(0, 3);
  };

  const requiredMapped = attributes
    .filter((item) => item.required)
    .every((item) => Boolean(fieldMapping[item.key]));

  function addAttribute(mapToHeader?: string) {
    const label = newAttributeLabel.trim() || mapToHeader?.trim() || "";
    if (!label) {
      return;
    }
    let key = slugifyAttributeKey(label);
    const existing = new Set(attributes.map((item) => item.key));
    if (existing.has(key)) {
      let n = 2;
      while (existing.has(`${key}_${n}`)) {
        n += 1;
      }
      key = `${key}_${n}`;
    }
    setAttributes((current) => [...current, { key, label, required: false }]);
    setNewAttributeLabel("");
    if (mapToHeader) {
      setColumnMapping((current) => {
        const next = { ...current };
        for (const [otherHeader, field] of Object.entries(next)) {
          if (field === key && otherHeader !== mapToHeader) {
            next[otherHeader] = "";
          }
        }
        next[mapToHeader] = key;
        return next;
      });
    }
    return key;
  }

  function downloadExample() {
    downloadCsv(
      "contacts-example.csv",
      attributes.map((item) => item.label),
      [
        [
          "Ada",
          "Lovelace",
          "Analytical Engines",
          "Founder",
          "ada@example.com",
          "+1 555 0100",
          "Technology",
          "https://example.com",
          "https://linkedin.com/company/example",
          "https://linkedin.com/in/ada",
          "https://example.com/ada",
          "London",
        ].slice(0, attributes.length),
      ],
    );
  }

  async function handleFile(file: File | null) {
    setError("");
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      setError("Please upload a .csv file.");
      return;
    }

    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0) {
      setError("Could not read CSV headers.");
      return;
    }

    setImportFileName(file.name);
    setCsvHeaders(parsed.headers);
    setCsvRows(parsed.rows);
    setColumnMapping(buildAutoColumnMapping(parsed.headers, attributes));
    setStep("mapping");
  }

  function goToUpload() {
    setError("");
    if (!listName.trim()) {
      setError("List name is required.");
      return;
    }
    setStep("upload");
  }

  function goToConfirm() {
    setError("");
    if (!requiredMapped) {
      setError("Map First Name, Email, and Company Name before continuing.");
      return;
    }
    if (mappedContacts.length === 0) {
      setError(
        "No valid rows found. Each row needs First Name, Email, and Company Name.",
      );
      return;
    }
    setStep("confirm");
  }

  async function handleCreate() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/crm/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: listName.trim(),
          contacts: mappedContacts,
          importFileName,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to create list");
      }
      const listId = data.list?.id as string | undefined;
      if (listId) {
        router.push(portalListRoute(listId));
        return;
      }
      router.push(PORTAL_ROUTES.lists);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create list");
    } finally {
      setSaving(false);
    }
  }

  const usedAttributeKeys = new Set(
    Object.values(columnMapping).filter(Boolean),
  );

  return (
    <div className="list-create">
      <div className="list-create-head">
        <div>
          <Link href={PORTAL_ROUTES.lists} className="cd-back" aria-label="Back to lists">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <h2>Create new list</h2>
          <p className="desc">
            Name your list, upload a CSV, review auto-mapped columns, then
            confirm the import.
          </p>
        </div>
      </div>

      <div className="list-create-steps" aria-label="Import steps">
        {(
          [
            ["name", "1", "List name"],
            ["upload", "2", "Upload file"],
            ["mapping", "3", "Map data"],
            ["confirm", "4", "Confirm"],
          ] as const
        ).map(([id, num, label]) => {
          const active = step === id;
          const done = STEP_ORDER.indexOf(step) > STEP_ORDER.indexOf(id);
          return (
            <div
              key={id}
              className={`list-create-step${active ? " active" : ""}${done ? " done" : ""}`}
            >
              <span>{done ? <CheckIcon /> : num}</span>
              {label}
            </div>
          );
        })}
      </div>

      {error ? <div className="crm-error">{error}</div> : null}

      {step === "name" ? (
        <div className="list-create-panel">
          <div className="crm-field">
            <label htmlFor="create-list-name">List name</label>
            <input
              id="create-list-name"
              value={listName}
              onChange={(event) => setListName(event.target.value)}
              placeholder="e.g. Q3 prospects"
              maxLength={120}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  goToUpload();
                }
              }}
            />
          </div>
          <div className="list-create-actions">
            <Link href={PORTAL_ROUTES.lists} className="btn-soft">
              Cancel
            </Link>
            <button type="button" className="btn-dark" onClick={goToUpload}>
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {step === "upload" ? (
        <div className="list-create-panel">
          <div className="list-upload-head">
            <div>
              <h3>
                <span>1</span> Upload your file
              </h3>
              <p>
                Select a CSV containing your contacts to import into “
                {listName.trim()}”. Required columns:{" "}
                <strong>First Name</strong>, <strong>Email</strong>, and{" "}
                <strong>Company Name</strong>. Last Name and other fields are
                optional and auto-mapped when present.
              </p>
            </div>
            <button type="button" className="link-purple" onClick={downloadExample}>
              Download example file (.csv)
            </button>
          </div>

          <div
            className={`list-dropzone${dragOver ? " over" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              void handleFile(event.dataTransfer.files?.[0] ?? null);
            }}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <CloudUploadIcon />
            <strong>Select your file or drag and drop it here</strong>
            <span>.csv</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(event) =>
                void handleFile(event.target.files?.[0] ?? null)
              }
            />
          </div>

          {importFileName ? (
            <p className="list-upload-file">Selected: {importFileName}</p>
          ) : null}

          <div className={`list-step-locked${csvHeaders.length ? "" : " muted"}`}>
            <h3>
              <span>2</span> Mapping data
            </h3>
            <p>Available after you upload a file.</p>
          </div>

          <div className="list-create-actions">
            <button type="button" className="btn-soft" onClick={() => setStep("name")}>
              Back
            </button>
            <button
              type="button"
              className="btn-dark"
              disabled={csvHeaders.length === 0}
              onClick={() => setStep("mapping")}
            >
              Continue to mapping
            </button>
          </div>
        </div>
      ) : null}

      {step === "mapping" ? (
        <div className="list-create-panel">
          <div className="list-upload-head">
            <div>
              <h3>
                <span>2</span> Mapping data
              </h3>
              <p>
                Columns are auto-mapped where possible. Add a new attribute below
                if your file has extra fields, then map a column to it. Required:
                First Name, Email, Company Name.
              </p>
            </div>
            <button
              type="button"
              className="link-purple"
              onClick={() => {
                setCsvHeaders([]);
                setCsvRows([]);
                setImportFileName("");
                setColumnMapping({});
                setStep("upload");
              }}
            >
              Change file
            </button>
          </div>

          <div className="list-map-table">
            <div className="list-map-head">
              <span>File header</span>
              <span>Data</span>
              <span>Contact attribute</span>
              <span>Mapped</span>
            </div>
            {csvHeaders.map((header) => {
              const mappedTo = columnMapping[header] ?? "";
              const samples = sampleForHeader(header);
              return (
                <div
                  key={header}
                  className={`list-map-row${mappedTo ? " mapped" : ""}`}
                >
                  <strong title={header}>{header}</strong>
                  <div className="list-map-samples">
                    {samples.length === 0 ? (
                      <em>—</em>
                    ) : (
                      samples.map((sample, index) => (
                        <span key={`${header}-${index}`}>{sample}</span>
                      ))
                    )}
                  </div>
                  <select
                    value={mappedTo}
                    onChange={(event) => {
                      const value = event.target.value;
                      setColumnMapping((current) => {
                        const next = { ...current };
                        if (value) {
                          for (const [otherHeader, field] of Object.entries(next)) {
                            if (field === value && otherHeader !== header) {
                              next[otherHeader] = "";
                            }
                          }
                        }
                        next[header] = value;
                        return next;
                      });
                    }}
                  >
                    <option value="">Do not Import</option>
                    {attributes.map((item) => (
                      <option
                        key={item.key}
                        value={item.key}
                        disabled={
                          usedAttributeKeys.has(item.key) &&
                          mappedTo !== item.key
                        }
                      >
                        {item.label}
                        {item.required ? " *" : ""}
                      </option>
                    ))}
                  </select>
                  <span className="list-map-status" aria-hidden>
                    {mappedTo ? (
                      <i>
                        <CheckIcon />
                      </i>
                    ) : (
                      <button
                        type="button"
                        className="list-map-create"
                        title={`Add "${header}" as a new attribute`}
                        onClick={() => addAttribute(header)}
                      >
                        +
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="list-attr-add list-map-add">
            <input
              value={newAttributeLabel}
              onChange={(event) => setNewAttributeLabel(event.target.value)}
              placeholder="New attribute name (e.g. Phone)"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addAttribute();
                }
              }}
            />
            <button
              type="button"
              className="btn-soft"
              onClick={() => addAttribute()}
              disabled={!newAttributeLabel.trim()}
            >
              Add attribute
            </button>
          </div>
          {attributes.some((item) => !DEFAULT_LIST_ATTRIBUTES.some((d) => d.key === item.key)) ? (
            <p className="list-map-add-hint">
              New attributes appear in the dropdowns above — map any column to them.
            </p>
          ) : null}

          <div className="list-create-actions">
            <button type="button" className="btn-soft" onClick={() => setStep("upload")}>
              Back
            </button>
            <button type="button" className="btn-dark" onClick={goToConfirm}>
              Continue to confirm
            </button>
          </div>
        </div>
      ) : null}

      {step === "confirm" ? (
        <div className="list-create-panel">
          <div className="list-upload-head">
            <div>
              <h3>
                <span>3</span> Confirm import
              </h3>
              <p>
                Import <strong>{mappedContacts.length.toLocaleString()}</strong>{" "}
                contacts into <strong>{listName.trim()}</strong>
                {importFileName ? ` from ${importFileName}` : ""}.
              </p>
            </div>
          </div>

          <div className="crm-preview list-confirm-preview">
            <table>
              <thead>
                <tr>
                  <th>First name</th>
                  <th>Last name</th>
                  <th>Email</th>
                  <th>Company</th>
                  <th>Extra fields</th>
                </tr>
              </thead>
              <tbody>
                {previewContacts.map((row, index) => (
                  <tr key={`${row.email}-${index}`}>
                    <td>{row.firstName}</td>
                    <td>{row.lastName || "—"}</td>
                    <td>{row.email}</td>
                    <td>{row.companyName || "—"}</td>
                    <td>
                      {Object.keys(row.attributes).length === 0
                        ? "—"
                        : Object.entries(row.attributes)
                            .map(
                              ([key, value]) =>
                                `${attributeLabel(key)}: ${value}`,
                            )
                            .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mappedContacts.length > previewContacts.length ? (
              <p className="list-confirm-more">
                Showing {previewContacts.length} of {mappedContacts.length}{" "}
                contacts.
              </p>
            ) : null}
          </div>

          <div className="list-create-actions">
            <button
              type="button"
              className="btn-soft"
              onClick={() => setStep("mapping")}
              disabled={saving}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-dark"
              onClick={() => void handleCreate()}
              disabled={saving}
            >
              {saving ? "Importing…" : "Create list & import"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
