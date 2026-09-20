"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  mapDataToolRecordToContact,
  ENRICH_EMPLOYEE_SIZE_LABELS,
  ENRICH_REVENUE_RANGE_LABELS,
  type DataToolRecord,
  type EnrichOptions,
  type EnrichSearchFilters,
} from "@/lib/datatool";
import { portalListRoute } from "@/lib/portal-nav";

type FilterKey = keyof EnrichSearchFilters;

type WizardStep = {
  key: FilterKey;
  stepLabel: string;
  title: string;
  hint: string;
  placeholder: string;
  /** Fixed ranges — do not load/search from Data Tool API. */
  fixedOptions?: string[];
};

const WIZARD_STEPS: WizardStep[] = [
  {
    key: "titles",
    stepLabel: "01 · Position",
    title: "Position / Job Title",
    hint: "Only titles that exist in your Data Portal",
    placeholder: "Search job titles…",
  },
  {
    key: "managementLevels",
    stepLabel: "02 · Management",
    title: "Management Level",
    hint: "Only seniority values that exist in your Data Portal",
    placeholder: "Search management levels…",
  },
  {
    key: "employeeSizes",
    stepLabel: "03 · Company size",
    title: "Employee Size",
    hint: "Select one or more headcount ranges",
    placeholder: "Search employee ranges…",
    fixedOptions: [...ENRICH_EMPLOYEE_SIZE_LABELS],
  },
  {
    key: "industryKeywords",
    stepLabel: "04 · Industry",
    title: "Industry & Keywords",
    hint: "Only industries that exist in your Data Portal",
    placeholder: "Search industries…",
  },
  {
    key: "revenueRanges",
    stepLabel: "05 · Revenue",
    title: "Revenue Range",
    hint: "Select one or more revenue ranges",
    placeholder: "Search revenue ranges…",
    fixedOptions: [...ENRICH_REVENUE_RANGE_LABELS],
  },
  {
    key: "technologies",
    stepLabel: "06 · Technologies",
    title: "Technologies Used",
    hint: "Only technologies that exist in your Data Portal",
    placeholder: "Search technologies…",
  },
  {
    key: "personLocations",
    stepLabel: "07 · Person location",
    title: "Person Location",
    hint: "Only person locations that exist in your Data Portal",
    placeholder: "Search person locations…",
  },
  {
    key: "companyLocations",
    stepLabel: "08 · Company location",
    title: "Company / Contact Location",
    hint: "Only company locations that exist in your Data Portal",
    placeholder: "Search company locations…",
  },
];

const EMPTY_FILTERS: EnrichSearchFilters = {
  titles: [],
  managementLevels: [],
  employeeSizes: [],
  industryKeywords: [],
  revenueRanges: [],
  technologies: [],
  personLocations: [],
  companyLocations: [],
};

const EMPTY_OPTIONS: EnrichOptions = {
  titles: [],
  managementLevels: [],
  employeeSizes: [...ENRICH_EMPLOYEE_SIZE_LABELS],
  industryKeywords: [],
  revenueRanges: [...ENRICH_REVENUE_RANGE_LABELS],
  technologies: [],
  personLocations: [],
  companyLocations: [],
  scanned: 0,
  total: 0,
};

function recordLabel(record: DataToolRecord) {
  const name = [record.first_name, record.last_name]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return name || String(record.email ?? "Unknown");
}

function EnrichMultiSelect({
  options,
  value,
  onChange,
  placeholder,
  loading,
  onSearchApi,
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  loading?: boolean;
  onSearchApi?: (query: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!onSearchApi) {
      return;
    }
    const trimmed = query.trim();
    // Only hit the API once the user is actually searching.
    if (trimmed.length < 2) {
      return;
    }
    const handle = window.setTimeout(() => {
      onSearchApi(trimmed);
    }, 320);
    return () => window.clearTimeout(handle);
  }, [query, onSearchApi]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return options;
    }
    return options.filter((option) => option.toLowerCase().includes(needle));
  }, [options, query]);

  function toggle(option: string) {
    if (value.includes(option)) {
      onChange(value.filter((item) => item !== option));
      return;
    }
    onChange([...value, option]);
  }

  function remove(option: string) {
    onChange(value.filter((item) => item !== option));
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !query && value.length > 0) {
      onChange(value.slice(0, -1));
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="enrich-ms" ref={rootRef}>
      <div
        className={`enrich-ms-control${open ? " open" : ""}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        <div className="enrich-ms-chips">
          {value.map((item) => (
            <button
              key={item}
              type="button"
              className="enrich-ms-chip"
              onClick={(event) => {
                event.stopPropagation();
                remove(item);
              }}
            >
              <span>{item}</span>
              <span aria-hidden="true">×</span>
            </button>
          ))}
          <input
            className="enrich-ms-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={value.length === 0 ? placeholder : "Search more…"}
          />
        </div>
      </div>

      {open ? (
        <div className="enrich-ms-menu" role="listbox" aria-multiselectable>
          {loading ? (
            <div className="enrich-ms-empty">Loading options from Data Tool…</div>
          ) : filtered.length === 0 ? (
            <div className="enrich-ms-empty">
              {query.trim()
                ? "No matching values in Data Tool for this search."
                : "No values found in Data Tool yet."}
            </div>
          ) : (
            filtered.slice(0, 200).map((option) => {
              const selected = value.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`enrich-ms-option${selected ? " selected" : ""}`}
                  onClick={() => toggle(option)}
                >
                  <span className="enrich-ms-check">{selected ? "✓" : ""}</span>
                  <span>{option}</span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function PortalEnrichPage() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [filters, setFilters] = useState<EnrichSearchFilters>(EMPTY_FILTERS);
  const [options, setOptions] = useState<EnrichOptions>(EMPTY_OPTIONS);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [phase, setPhase] = useState<"wizard" | "results">("wizard");

  const [records, setRecords] = useState<DataToolRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [matched, setMatched] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [listName, setListName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const step = WIZARD_STEPS[stepIndex];
  const selectedForStep = filters[step.key] || [];
  const optionsForStep = step.fixedOptions || options[step.key] || [];

  const selectedRecords = useMemo(
    () => records.filter((record) => selectedIds.has(record.id)),
    [records, selectedIds],
  );

  const allVisibleSelected =
    records.length > 0 && records.every((record) => selectedIds.has(record.id));

  const loadOptions = useCallback(async (q?: string) => {
    setOptionsLoading(true);
    setOptionsError("");
    try {
      const query = q?.trim()
        ? `?q=${encodeURIComponent(q.trim())}`
        : "";
      const response = await fetch(`/api/crm/enrich/options${query}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load options");
      }
      const incoming = {
        titles: Array.isArray(data.titles) ? data.titles : [],
        managementLevels: Array.isArray(data.managementLevels)
          ? data.managementLevels
          : [],
        employeeSizes: [...ENRICH_EMPLOYEE_SIZE_LABELS],
        industryKeywords: Array.isArray(data.industryKeywords)
          ? data.industryKeywords
          : [],
        revenueRanges: [...ENRICH_REVENUE_RANGE_LABELS],
        technologies: Array.isArray(data.technologies) ? data.technologies : [],
        personLocations: Array.isArray(data.personLocations)
          ? data.personLocations
          : [],
        companyLocations: Array.isArray(data.companyLocations)
          ? data.companyLocations
          : [],
        scanned: Number(data.scanned || 0),
        total: Number(data.total || 0),
      } satisfies EnrichOptions;

      setOptions((current) => {
        if (!q?.trim()) {
          return incoming;
        }
        const merge = (a: string[], b: string[]) =>
          [...new Set([...a, ...b])].sort((left, right) =>
            left.localeCompare(right, undefined, { sensitivity: "base" }),
          );
        return {
          titles: merge(current.titles, incoming.titles),
          managementLevels: merge(
            current.managementLevels,
            incoming.managementLevels,
          ),
          employeeSizes: [...ENRICH_EMPLOYEE_SIZE_LABELS],
          industryKeywords: merge(
            current.industryKeywords,
            incoming.industryKeywords,
          ),
          revenueRanges: [...ENRICH_REVENUE_RANGE_LABELS],
          technologies: merge(current.technologies, incoming.technologies),
          personLocations: merge(
            current.personLocations,
            incoming.personLocations,
          ),
          companyLocations: merge(
            current.companyLocations,
            incoming.companyLocations,
          ),
          scanned: Math.max(current.scanned, incoming.scanned),
          total: Math.max(current.total, incoming.total),
        };
      });
    } catch (err) {
      setOptionsError(
        err instanceof Error ? err.message : "Failed to load options",
      );
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const onSearchApi = useCallback(
    (query: string) => {
      void loadOptions(query);
    },
    [loadOptions],
  );

  function setStepValues(next: string[]) {
    setFilters((current) => ({
      ...current,
      [step.key]: next,
    }));
  }

  async function runSearch(nextPage = 1) {
    setSearching(true);
    setError("");
    try {
      const response = await fetch("/api/crm/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...filters, page: nextPage, limit: 50 }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Search failed");
      }
      const nextRecords = Array.isArray(data.records)
        ? (data.records as DataToolRecord[])
        : [];
      setRecords(nextRecords);
      setPage(Number(data.page || nextPage));
      setTotal(Number(data.total || 0));
      setMatched(Number(data.matched ?? nextRecords.length));
      setSelectedIds(new Set());
      setPhase("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setRecords([]);
      setSelectedIds(new Set());
      setPhase("results");
    } finally {
      setSearching(false);
    }
  }

  function goNext() {
    if (stepIndex < WIZARD_STEPS.length - 1) {
      setStepIndex((current) => current + 1);
      return;
    }
    void runSearch(1);
  }

  function goBack() {
    if (phase === "results") {
      setPhase("wizard");
      setError("");
      return;
    }
    if (stepIndex > 0) {
      setStepIndex((current) => current - 1);
    }
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(records.map((record) => record.id)));
  }

  function toggleOne(id: string) {
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

  function openSaveModal() {
    if (selectedRecords.length === 0) {
      return;
    }
    const stamp = new Date().toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    setListName(`Enriched ${stamp}`);
    setSaveError("");
    setSaveOpen(true);
  }

  async function saveToList() {
    const name = listName.trim();
    if (!name || saving) {
      return;
    }
    const contacts = selectedRecords
      .map(mapDataToolRecordToContact)
      .filter((row) => row.email && row.firstName && row.companyName);

    if (contacts.length === 0) {
      setSaveError(
        "Selected rows need email, name, and company to save into a list.",
      );
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch("/api/crm/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          contacts,
          importFileName: "data-tool-enrich",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to save list");
      }
      const listId = String(data.list?.id || "");
      setSaveOpen(false);
      if (listId) {
        router.push(portalListRoute(listId));
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save list");
    } finally {
      setSaving(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 50));
  const hasAnyFilter = Object.values(filters).some(
    (value) => Array.isArray(value) && value.length > 0,
  );
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;

  return (
    <div className="enrich-page">
      <div className="crm-page-head">
        <div>
          <h2>Enrich</h2>
          <p className="desc">
            Step through filters from your Data Tool, multi-select values, then
            save matches into a CRM list.
          </p>
        </div>
      </div>

      {phase === "wizard" ? (
        <section className="enrich-wizard">
          <div className="enrich-wizard-progress">
            {WIZARD_STEPS.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={`enrich-wizard-dot${index === stepIndex ? " active" : ""}${index < stepIndex ? " done" : ""}`}
                onClick={() => setStepIndex(index)}
                title={item.title}
              >
                {index + 1}
              </button>
            ))}
          </div>

          <div className="enrich-wizard-card">
            <div className="enrich-section-label">{step.stepLabel}</div>
            <h3 className="enrich-wizard-title">{step.title}</h3>
            <p className="enrich-field-hint">{step.hint}</p>

            {optionsError ? <div className="crm-error">{optionsError}</div> : null}

            <EnrichMultiSelect
              key={step.key}
              options={optionsForStep}
              value={selectedForStep}
              onChange={setStepValues}
              placeholder={step.placeholder}
              loading={step.fixedOptions ? false : optionsLoading}
              onSearchApi={step.fixedOptions ? undefined : onSearchApi}
            />

            {selectedForStep.length > 0 ? (
              <p className="enrich-selected-count">
                {selectedForStep.length} selected
              </p>
            ) : (
              <p className="enrich-selected-count muted">
                Optional — you can skip and continue
              </p>
            )}

            <div className="enrich-wizard-actions">
              <button
                type="button"
                className="btn-soft"
                onClick={goBack}
                disabled={stepIndex === 0 || searching}
              >
                Back
              </button>
              <div className="enrich-wizard-actions-right">
                {!isLastStep ? (
                  <button
                    type="button"
                    className="btn-soft"
                    onClick={() => setStepIndex((current) => current + 1)}
                    disabled={searching}
                  >
                    Skip
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-dark"
                  onClick={goNext}
                  disabled={searching || (isLastStep && !hasAnyFilter)}
                >
                  {searching
                    ? "Searching…"
                    : isLastStep
                      ? "Search Data Tool"
                      : "Next"}
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="enrich-results">
          <div className="enrich-results-head">
            <div>
              <h3>Results</h3>
              <p>
                {matched} matched on this page
                {total > 0 ? ` · ${total.toLocaleString()} in Data Tool` : ""}
                {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
              </p>
            </div>
            <div className="enrich-results-actions">
              <button
                type="button"
                className="btn-soft"
                onClick={goBack}
                disabled={searching}
              >
                Edit filters
              </button>
              <button
                type="button"
                className="btn-dark"
                disabled={selectedIds.size === 0 || searching}
                onClick={openSaveModal}
              >
                Save to list
              </button>
            </div>
          </div>

          {error ? <div className="crm-error">{error}</div> : null}

          {records.length === 0 ? (
            <div className="enrich-empty">
              No people matched these filters. Go back and adjust selections.
            </div>
          ) : (
            <>
              <div className="enrich-table-wrap">
                <table className="data-table enrich-table">
                  <thead>
                    <tr>
                      <th className="enrich-check-col">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={toggleSelectAllVisible}
                          aria-label="Select all visible"
                        />
                      </th>
                      <th>Name</th>
                      <th>Title</th>
                      <th>Company</th>
                      <th>Email</th>
                      <th>Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record.id}>
                        <td className="enrich-check-col">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(record.id)}
                            onChange={() => toggleOne(record.id)}
                            aria-label={`Select ${recordLabel(record)}`}
                          />
                        </td>
                        <td>
                          <div className="enrich-name">{recordLabel(record)}</div>
                          {record.seniority ? (
                            <div className="enrich-meta">{record.seniority}</div>
                          ) : null}
                        </td>
                        <td>{record.title || "—"}</td>
                        <td>
                          <div>{record.company_name || "—"}</div>
                          {record.employees ? (
                            <div className="enrich-meta">
                              {record.employees} employees
                            </div>
                          ) : null}
                        </td>
                        <td>{record.email || "—"}</td>
                        <td>
                          {record.contact_country ||
                            record.company_country ||
                            "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 ? (
                <div className="enrich-pager">
                  <button
                    type="button"
                    className="btn-soft"
                    disabled={page <= 1 || searching}
                    onClick={() => void runSearch(page - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn-soft"
                    disabled={page >= totalPages || searching}
                    onClick={() => void runSearch(page + 1)}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}

      {saveOpen ? (
        <div className="crm-modal-backdrop" onClick={() => setSaveOpen(false)}>
          <div
            className="crm-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="enrich-save-title"
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="enrich-save-title">Save to list</h3>
                <p>
                  Create a new CRM list with {selectedRecords.length} selected
                  contact
                  {selectedRecords.length === 1 ? "" : "s"} from Data Tool.
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                onClick={() => setSaveOpen(false)}
                aria-label="Close"
                disabled={saving}
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body">
              <div className="crm-field">
                <label htmlFor="enrich-list-name">List name</label>
                <input
                  id="enrich-list-name"
                  value={listName}
                  onChange={(event) => setListName(event.target.value)}
                  placeholder="e.g. SaaS VPs US"
                  disabled={saving}
                  autoFocus
                />
              </div>
              {saveError ? <div className="crm-error">{saveError}</div> : null}
            </div>
            <div className="crm-modal-foot">
              <button
                type="button"
                className="btn-link-purple"
                onClick={() => setSaveOpen(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                onClick={() => void saveToList()}
                disabled={saving || !listName.trim()}
              >
                {saving ? "Saving…" : "Save list"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
