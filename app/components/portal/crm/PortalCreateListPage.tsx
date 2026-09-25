"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONTACT_ATTRIBUTE_LABELS,
  DEFAULT_LIST_ATTRIBUTES,
  REQUIRED_CONTACT_FIELDS,
  slugifyAttributeKey,
  type ListAttributeDef,
} from "@/lib/crm";
import { createListWithChunkedImport } from "@/lib/crm-client-import";
import {
  downloadCsv,
  guessHeaderMapping,
  mapRowsToContacts,
  parseCsv,
} from "@/lib/csv";
import { PORTAL_ROUTES, portalListRoute } from "@/lib/portal-nav";

type WizardStep = "name" | "upload" | "mapping" | "confirm";

type ExistingListRef = {
  id: string;
  name: string;
  displayId: number;
};

type ImportRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  attributes: Record<string, string>;
  inFileDuplicate: boolean;
  unsubscribed: boolean;
  existingLists: ExistingListRef[];
};

const STEP_ORDER: WizardStep[] = ["name", "upload", "mapping", "confirm"];
const CONFIRM_PAGE_SIZE = 50;

function ConfirmImportPagination({
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
    <div className="drip-pagination list-confirm-pagination">
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
  const [importProgress, setImportProgress] = useState("");
  const [error, setError] = useState("");
  const [confirmRows, setConfirmRows] = useState<ImportRow[]>([]);
  const [confirmPage, setConfirmPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupProgress, setLookupProgress] = useState({
    processed: 0,
    total: 0,
  });
  const [removeDialog, setRemoveDialog] = useState<{
    ids: string[];
    reason: "duplicates" | "other-lists" | "unsubscribed";
  } | null>(null);

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

  const duplicateCount = useMemo(
    () => confirmRows.filter((row) => row.inFileDuplicate).length,
    [confirmRows],
  );

  const alreadyInListsCount = useMemo(
    () =>
      confirmRows.filter(
        (row) => !row.inFileDuplicate && row.existingLists.length > 0,
      ).length,
    [confirmRows],
  );

  const unsubscribedCount = useMemo(
    () =>
      confirmRows.filter((row) => !row.inFileDuplicate && row.unsubscribed)
        .length,
    [confirmRows],
  );

  const importableRows = useMemo(
    () =>
      confirmRows.filter(
        (row) => !row.inFileDuplicate && selectedIds.has(row.id),
      ),
    [confirmRows, selectedIds],
  );

  const confirmTotalPages = Math.max(
    1,
    Math.ceil(confirmRows.length / CONFIRM_PAGE_SIZE),
  );
  const safeConfirmPage = Math.min(confirmPage, confirmTotalPages);
  const pagedConfirmRows = useMemo(() => {
    const start = (safeConfirmPage - 1) * CONFIRM_PAGE_SIZE;
    return confirmRows.slice(start, start + CONFIRM_PAGE_SIZE);
  }, [confirmRows, safeConfirmPage]);

  const pageSelectableRows = useMemo(
    () => pagedConfirmRows.filter((row) => !row.inFileDuplicate),
    [pagedConfirmRows],
  );

  const allPageSelectableChecked =
    pageSelectableRows.length > 0 &&
    pageSelectableRows.every((row) => selectedIds.has(row.id));

  useEffect(() => {
    if (confirmPage > confirmTotalPages) {
      setConfirmPage(confirmTotalPages);
    }
  }, [confirmPage, confirmTotalPages]);

  useEffect(() => {
    if (step !== "confirm") {
      return;
    }

    const seen = new Set<string>();
    const rows: ImportRow[] = mappedContacts.map((row, index) => {
      const email = row.email.trim().toLowerCase();
      const inFileDuplicate = seen.has(email);
      if (!inFileDuplicate) {
        seen.add(email);
      }
      return {
        id: `${email}-${index}`,
        firstName: row.firstName,
        lastName: row.lastName,
        email,
        companyName: row.companyName,
        attributes: row.attributes,
        inFileDuplicate,
        unsubscribed: false,
        existingLists: [],
      };
    });

    setConfirmRows(rows);
    setConfirmPage(1);
    setSelectedIds(
      new Set(rows.filter((row) => !row.inFileDuplicate).map((row) => row.id)),
    );

    const uniqueEmails = [...seen];
    if (uniqueEmails.length === 0) {
      setLookupLoading(false);
      setLookupProgress({ processed: 0, total: 0 });
      return;
    }

    let cancelled = false;
    setLookupLoading(true);
    setLookupProgress({ processed: 0, total: uniqueEmails.length });

    void (async () => {
      try {
        const matchMap = new Map<string, ExistingListRef[]>();
        const unsubscribedSet = new Set<string>();
        const LOOKUP_CHUNK = 500;
        for (let index = 0; index < uniqueEmails.length; index += LOOKUP_CHUNK) {
          if (cancelled) {
            return;
          }
          const emailChunk = uniqueEmails.slice(index, index + LOOKUP_CHUNK);
          try {
            const response = await fetch("/api/crm/contacts/lookup-lists", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ emails: emailChunk }),
            });
            const data = await response.json();
            if (cancelled) {
              return;
            }
            if (response.ok) {
              for (const match of (data.matches as
                | Array<{ email: string; lists: ExistingListRef[] }>
                | undefined) ?? []) {
                matchMap.set(match.email.toLowerCase(), match.lists);
              }
              for (const email of (data.unsubscribedEmails as
                | string[]
                | undefined) ?? []) {
                unsubscribedSet.add(email.toLowerCase());
              }
            }
          } catch {
            // Continue remaining chunks so progress still completes.
          }
          if (cancelled) {
            return;
          }
          setLookupProgress({
            processed: Math.min(index + emailChunk.length, uniqueEmails.length),
            total: uniqueEmails.length,
          });
        }
        if (cancelled) {
          return;
        }
        setConfirmRows((current) =>
          current.map((row) => ({
            ...row,
            existingLists: matchMap.get(row.email) ?? [],
            unsubscribed: unsubscribedSet.has(row.email),
          })),
        );
      } catch {
        // Keep confirm usable even if lookup fails.
      } finally {
        if (!cancelled) {
          setLookupProgress({
            processed: uniqueEmails.length,
            total: uniqueEmails.length,
          });
          setLookupLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, mappedContacts]);

  const sampleForHeader = (columnIndex: number) => {
    if (columnIndex < 0 || columnIndex >= csvHeaders.length) {
      return [];
    }
    return csvRows
      .map((row) => row[columnIndex] ?? "")
      .filter(Boolean)
      .slice(0, 3);
  };

  const requiredMapped = attributes
    .filter((item) => item.required)
    .every((item) => Boolean(fieldMapping[item.key]));

  function toggleRow(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAllSelectable() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelectableChecked) {
        for (const row of pageSelectableRows) {
          next.delete(row.id);
        }
        return next;
      }
      for (const row of pageSelectableRows) {
        next.add(row.id);
      }
      return next;
    });
  }

  function openRemoveDialog(
    ids: string[],
    reason: "duplicates" | "other-lists" | "unsubscribed",
  ) {
    if (ids.length === 0) {
      return;
    }
    setSelectedIds(new Set(ids));
    setRemoveDialog({ ids, reason });
  }

  function requestRemoveDuplicates() {
    openRemoveDialog(
      confirmRows.filter((row) => row.inFileDuplicate).map((row) => row.id),
      "duplicates",
    );
  }

  function requestRemoveOnOtherLists() {
    openRemoveDialog(
      confirmRows
        .filter((row) => !row.inFileDuplicate && row.existingLists.length > 0)
        .map((row) => row.id),
      "other-lists",
    );
  }

  function requestRemoveUnsubscribed() {
    openRemoveDialog(
      confirmRows
        .filter((row) => !row.inFileDuplicate && row.unsubscribed)
        .map((row) => row.id),
      "unsubscribed",
    );
  }

  function confirmRemoveRows() {
    if (!removeDialog) {
      return;
    }
    const ids = new Set(removeDialog.ids);
    const nextRows = confirmRows.filter((row) => !ids.has(row.id));
    setConfirmRows(nextRows);
    setSelectedIds(
      new Set(
        nextRows.filter((row) => !row.inFileDuplicate).map((row) => row.id),
      ),
    );
    setRemoveDialog(null);
    setConfirmPage(1);
  }

  function closeRemoveDialog() {
    setRemoveDialog(null);
  }
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
    setLookupLoading(true);
    setLookupProgress({ processed: 0, total: 0 });
    setStep("confirm");
  }

  async function handleCreate() {
    if (importableRows.length === 0) {
      setError("Select at least one contact to import.");
      return;
    }

    setSaving(true);
    setError("");
    setImportProgress("Creating list…");
    try {
      const { list } = await createListWithChunkedImport({
        name: listName.trim(),
        importFileName,
        contacts: importableRows.map((row) => ({
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          companyName: row.companyName,
          attributes: row.attributes,
        })),
        onProgress: ({ phase, done, total }) => {
          if (phase === "create") {
            setImportProgress("Creating list…");
            return;
          }
          setImportProgress(
            `Importing ${Math.min(done, total).toLocaleString()} / ${total.toLocaleString()} contacts…`,
          );
        },
      });
      if (list?.id) {
        router.push(portalListRoute(list.id));
        return;
      }
      router.push(PORTAL_ROUTES.lists);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create list");
    } finally {
      setSaving(false);
      setImportProgress("");
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
            {csvHeaders.map((header, columnIndex) => {
              const mappedTo = columnMapping[header] ?? "";
              const samples = sampleForHeader(columnIndex);
              return (
                <div
                  key={`map-col-${columnIndex}-${header}`}
                  className={`list-map-row${mappedTo ? " mapped" : ""}`}
                >
                  <strong title={header}>{header || `Column ${columnIndex + 1}`}</strong>
                  <div className="list-map-samples">
                    {samples.length === 0 ? (
                      <em>—</em>
                    ) : (
                      samples.map((sample, index) => (
                        <span key={`${columnIndex}-${index}`}>{sample}</span>
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
                <span>4</span> Confirm import
              </h3>
              {lookupLoading ? (
                <p>
                  Checking contacts against existing lists and the unsubscribe
                  list before import.
                </p>
              ) : (
                <p>
                  Import{" "}
                  <strong>{importableRows.length.toLocaleString()}</strong>{" "}
                  selected contact
                  {importableRows.length === 1 ? "" : "s"} into{" "}
                  <strong>{listName.trim()}</strong>
                  {importFileName ? ` from ${importFileName}` : ""}.
                  {duplicateCount > 0 ? (
                    <>
                      {" "}
                      <strong className="list-dup-count">
                        {duplicateCount.toLocaleString()} duplicate
                        {duplicateCount === 1 ? "" : "s"}
                      </strong>{" "}
                      in this file will not be added.
                    </>
                  ) : null}
                  {alreadyInListsCount > 0 ? (
                    <>
                      {" "}
                      {alreadyInListsCount.toLocaleString()} contact
                      {alreadyInListsCount === 1 ? " is" : "s are"} already on
                      other lists.
                    </>
                  ) : null}
                  {unsubscribedCount > 0 ? (
                    <>
                      {" "}
                      <strong className="list-unsub-count">
                        {unsubscribedCount.toLocaleString()}
                      </strong>{" "}
                      contact
                      {unsubscribedCount === 1 ? " is" : "s are"} on the
                      unsubscribe list.
                    </>
                  ) : null}
                </p>
              )}
            </div>
          </div>

          {lookupLoading ? (
            <div
              className="list-confirm-checking"
              role="status"
              aria-live="polite"
            >
              <div className="list-confirm-checking-spinner" aria-hidden />
              <div className="list-confirm-checking-copy">
                <strong>Checking contacts…</strong>
                <p>
                  Processed{" "}
                  <strong>
                    {lookupProgress.processed.toLocaleString()}
                  </strong>{" "}
                  of{" "}
                  <strong>{lookupProgress.total.toLocaleString()}</strong>{" "}
                  unique email
                  {lookupProgress.total === 1 ? "" : "s"}.
                </p>
              </div>
              <div
                className="list-confirm-checking-bar"
                aria-hidden={lookupProgress.total === 0}
              >
                <div
                  className="list-confirm-checking-bar-fill"
                  style={{
                    width:
                      lookupProgress.total > 0
                        ? `${Math.min(
                            100,
                            Math.round(
                              (lookupProgress.processed /
                                lookupProgress.total) *
                                100,
                            ),
                          )}%`
                        : "0%",
                  }}
                />
              </div>
              <p className="list-confirm-checking-hint">
                The contact list will appear when every email has been checked.
              </p>
            </div>
          ) : (
            <>
              <div className="list-confirm-toolbar">
                <div className="list-confirm-toolbar-actions">
                  {alreadyInListsCount > 0 ? (
                    <button
                      type="button"
                      className="btn-soft"
                      onClick={requestRemoveOnOtherLists}
                    >
                      Remove on other list contact (
                      {alreadyInListsCount.toLocaleString()})
                    </button>
                  ) : null}
                  {unsubscribedCount > 0 ? (
                    <button
                      type="button"
                      className="btn-soft"
                      onClick={requestRemoveUnsubscribed}
                    >
                      Remove contacts which are on unsubscribe (
                      {unsubscribedCount.toLocaleString()})
                    </button>
                  ) : null}
                  {duplicateCount > 0 ? (
                    <button
                      type="button"
                      className="btn-soft"
                      onClick={requestRemoveDuplicates}
                    >
                      Remove duplicate contact (
                      {duplicateCount.toLocaleString()})
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="crm-preview list-confirm-preview">
                <table>
                  <thead>
                    <tr>
                      <th className="list-confirm-name-col">
                        <label className="list-confirm-select-all">
                          <input
                            type="checkbox"
                            checked={allPageSelectableChecked}
                            onChange={toggleAllSelectable}
                            disabled={pageSelectableRows.length === 0}
                            aria-label="Select all on this page"
                          />
                          <span>First name</span>
                        </label>
                      </th>
                      <th>Last name</th>
                      <th>Email</th>
                      <th>Company</th>
                      <th>Already in lists</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmRows.length === 0 ? (
                      <tr>
                        <td colSpan={6}>No contacts left to import.</td>
                      </tr>
                    ) : (
                      pagedConfirmRows.map((row) => {
                        const checked = selectedIds.has(row.id);
                        return (
                          <tr
                            key={row.id}
                            className={
                              row.inFileDuplicate
                                ? "list-confirm-dup"
                                : row.unsubscribed
                                  ? "list-confirm-unsub"
                                  : row.existingLists.length > 0
                                    ? "list-confirm-existing"
                                    : undefined
                            }
                          >
                            <td className="list-confirm-name-col">
                              <label className="list-confirm-row-name">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleRow(row.id)}
                                  aria-label={`Select ${row.email}`}
                                />
                                <span>{row.firstName}</span>
                              </label>
                            </td>
                            <td>{row.lastName || "—"}</td>
                            <td>{row.email}</td>
                            <td>{row.companyName || "—"}</td>
                            <td>
                              {row.existingLists.length === 0 ? (
                                "—"
                              ) : (
                                <span className="list-confirm-lists">
                                  {row.existingLists
                                    .map(
                                      (list) =>
                                        `${list.name} (#${list.displayId})`,
                                    )
                                    .join(", ")}
                                </span>
                              )}
                            </td>
                            <td>
                              {row.inFileDuplicate ? (
                                <span className="list-status-pill dup">
                                  Duplicate
                                </span>
                              ) : row.unsubscribed ? (
                                <span className="list-status-pill unsub">
                                  Unsubscribed
                                </span>
                              ) : row.existingLists.length > 0 ? (
                                <span className="list-status-pill existing">
                                  On other list
                                </span>
                              ) : (
                                <span className="list-status-pill new">New</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <ConfirmImportPagination
                total={confirmRows.length}
                page={safeConfirmPage}
                pageSize={CONFIRM_PAGE_SIZE}
                onPage={setConfirmPage}
              />
            </>
          )}

          <div className="list-create-actions">
            <button
              type="button"
              className="btn-soft"
              onClick={() => setStep("mapping")}
              disabled={saving || lookupLoading}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-dark"
              onClick={() => void handleCreate()}
              disabled={
                saving || lookupLoading || importableRows.length === 0
              }
            >
              {saving
                ? importProgress || "Importing…"
                : lookupLoading
                  ? `Checking… ${lookupProgress.processed.toLocaleString()}/${lookupProgress.total.toLocaleString()}`
                  : `Create list & import (${importableRows.length.toLocaleString()})`}
            </button>
          </div>
        </div>
      ) : null}

      {removeDialog ? (
        <div className="crm-modal-backdrop" onClick={closeRemoveDialog}>
          <div
            className="crm-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="list-remove-contacts-title"
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="list-remove-contacts-title">Remove contacts?</h3>
                <p>
                  {removeDialog.reason === "duplicates"
                    ? `Remove ${removeDialog.ids.length.toLocaleString()} duplicate contact${
                        removeDialog.ids.length === 1 ? "" : "s"
                      } from this import? They will not be added to the list.`
                    : removeDialog.reason === "unsubscribed"
                      ? `Remove ${removeDialog.ids.length.toLocaleString()} unsubscribed contact${
                          removeDialog.ids.length === 1 ? "" : "s"
                        } from this import? They will not be added to the list.`
                      : `Remove ${removeDialog.ids.length.toLocaleString()} contact${
                          removeDialog.ids.length === 1 ? "" : "s"
                        } already on other lists from this import?`}
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                onClick={closeRemoveDialog}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="crm-modal-foot">
              <button
                type="button"
                className="btn-soft"
                onClick={closeRemoveDialog}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                onClick={confirmRemoveRows}
              >
                Remove ({removeDialog.ids.length.toLocaleString()})
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
