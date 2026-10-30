"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PortalToast from "@/app/components/portal/PortalToast";
import EnrichPeopleBrowser, {
  type EnrichListOption,
  type EnrichSelectionContext,
} from "@/app/components/portal/crm/people/EnrichPeopleBrowser";
import {
  mapDataToolRecordToContact,
  formatEnrichRecordField,
  ENRICH_RESULT_COLUMNS,
  type DataToolRecord,
} from "@/lib/datatool";
import {
  appendContactsInChunks,
  createListWithChunkedImport,
  type ChunkedImportProgress,
} from "@/lib/crm-client-import";
import type { CrmList } from "@/lib/crm";
import { downloadCsv } from "@/lib/csv";
import { portalListRoute } from "@/lib/portal-nav";
import { AI_PENDING_FILTERS_KEY } from "@/lib/people/ai-search";
import {
  ENRICH_APPLY_FILTERS_EVENT,
  ENRICH_MAX_SAVE,
  ENRICH_MAX_SAVE_MESSAGE,
} from "@/lib/people/enrich-people";
import type { DataCreditStatus } from "@/lib/projects";

const ENRICH_HISTORY_KEY = "portal-enrich-history";

type EnrichHistoryEntry = {
  id: string;
  listName: string;
  listId: string;
  savedAt: string;
  contactCount: number;
  filtersSummary: string;
};

type ExistingListRef = {
  id: string;
  name: string;
  displayId: number;
};

type DuplicateMatch = {
  recordId: string;
  email: string;
  name: string;
  lists: ExistingListRef[];
};

function loadEnrichHistory(): EnrichHistoryEntry[] {
  try {
    const raw = localStorage.getItem(ENRICH_HISTORY_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as EnrichHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEnrichHistory(entries: EnrichHistoryEntry[]) {
  try {
    localStorage.setItem(ENRICH_HISTORY_KEY, JSON.stringify(entries.slice(0, 50)));
  } catch {
    // Ignore quota / private mode.
  }
}

function recordLabel(record: DataToolRecord) {
  const name = [record.first_name, record.last_name]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return name || String(record.email ?? "") || record.id;
}

/** Full records for the given ids, in the same order. */
async function fetchEnrichRecords(ids: string[]): Promise<DataToolRecord[]> {
  const response = await fetch("/api/crm/enrich/people/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to load contacts");
  }
  return (Array.isArray(data.records) ? data.records : []).map(
    (record: DataToolRecord) => ({ ...record, type: "people" }),
  );
}

function shouldOpenHistory() {
  if (new URLSearchParams(window.location.search).get("view") !== "history") {
    return false;
  }
  try {
    return !sessionStorage.getItem(AI_PENDING_FILTERS_KEY);
  } catch {
    return true;
  }
}

async function reserveCredits(amount: number) {
  const response = await fetch("/api/crm/enrich/credits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Could not reserve data credits");
  }
  return data as { status: DataCreditStatus; reservationId: string };
}

async function refundCredits(reservationId: string) {
  try {
    await fetch(`/api/crm/enrich/credits?reservationId=${encodeURIComponent(reservationId)}`, {
      method: "DELETE",
    });
  } catch {
    // Reservation expires on its own if the refund cannot be sent.
  }
}

function notEnoughCreditsMessage(remaining: number) {
  return remaining === 0
    ? "No data credits left this month."
    : `Only ${remaining.toLocaleString()} data credits left this month — save ${remaining.toLocaleString()} or fewer contacts.`;
}

function formatResetDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function PortalEnrichPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"home" | "browse">("browse");
  const [history, setHistory] = useState<EnrichHistoryEntry[]>([]);
  const [lists, setLists] = useState<EnrichListOption[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [listActionBusy, setListActionBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [flash, setFlash] = useState("");
  const [actionError, setActionError] = useState("");
  const [credits, setCredits] = useState<DataCreditStatus | null>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveStep, setSaveStep] = useState<"count" | "name">("count");
  const [saveCandidates, setSaveCandidates] = useState<DataToolRecord[]>([]);
  const [saveRecords, setSaveRecords] = useState<DataToolRecord[]>([]);
  const [saveDesiredCount, setSaveDesiredCount] = useState(1);
  const [saveSummary, setSaveSummary] = useState("");
  const [listName, setListName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<ChunkedImportProgress | null>(null);
  const [saveError, setSaveError] = useState("");
  const [loadingSave, setLoadingSave] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);

  useEffect(() => {
    // Client-only sources: localStorage history, URL / AI handoff for the initial view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(loadEnrichHistory());
    if (shouldOpenHistory()) {
      setPhase("home");
    }
  }, []);

  useEffect(() => {
    const showBrowser = () => setPhase("browse");
    window.addEventListener(ENRICH_APPLY_FILTERS_EVENT, showBrowser);
    return () => window.removeEventListener(ENRICH_APPLY_FILTERS_EVENT, showBrowser);
  }, []);

  const refreshCredits = useCallback(async () => {
    try {
      const response = await fetch("/api/crm/enrich/credits", { cache: "no-store" });
      if (response.ok) setCredits((await response.json()) as DataCreditStatus);
    } catch {
      // Server still enforces credits on save.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshCredits();
  }, [refreshCredits]);

  const refreshLists = useCallback(async () => {
    try {
      const response = await fetch("/api/crm/lists", { cache: "no-store" });
      const data = await response.json();
      if (response.ok && Array.isArray(data)) {
        setLists(
          (data as CrmList[]).map((list) => ({
            id: list.id,
            name: list.name,
            recordCount: Number(list.contactCount || 0),
          })),
        );
      }
    } catch {
      // List actions stay optional if this fails.
    } finally {
      setListsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (phase === "browse") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void refreshLists();
    }
  }, [phase, refreshLists]);

  function openBrowser() {
    setPhase("browse");
    router.replace("/portal/crm/enrich");
  }

  function backToHistory() {
    setPhase("home");
    router.replace("/portal/crm/enrich?view=history");
  }

  function addHistory(entry: Omit<EnrichHistoryEntry, "id" | "savedAt">) {
    setHistory((current) => {
      const next = [
        { ...entry, id: `${Date.now()}`, savedAt: new Date().toISOString() },
        ...current.filter((row) => row.listId !== entry.listId),
      ];
      saveEnrichHistory(next);
      return next;
    });
  }

  function deleteHistoryEntry(id: string) {
    const nextHistory = history.filter((entry) => entry.id !== id);
    setHistory(nextHistory);
    saveEnrichHistory(nextHistory);
  }

  async function exportCsv(ids: string[]) {
    if (ids.length === 0 || exporting) return;
    setExporting(true);
    setActionError("");
    try {
      const rows = await fetchEnrichRecords(ids);
      downloadCsv(
        `enrich-${new Date().toISOString().slice(0, 10)}.csv`,
        ENRICH_RESULT_COLUMNS.map((column) => column.label),
        rows.map((record) =>
          ENRICH_RESULT_COLUMNS.map((column) => formatEnrichRecordField(record, column.key)),
        ),
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function addToExistingList(listId: string, ids: string[]) {
    if (ids.length === 0 || listActionBusy) return;
    if (ids.length > ENRICH_MAX_SAVE) {
      setActionError(ENRICH_MAX_SAVE_MESSAGE);
      return;
    }
    if (credits && ids.length > credits.remaining) {
      setActionError(notEnoughCreditsMessage(credits.remaining));
      return;
    }
    setListActionBusy(true);
    setActionError("");
    try {
      const records = await fetchEnrichRecords(ids);
      const contacts = records
        .map(mapDataToolRecordToContact)
        .filter((row) => row.email && row.firstName && row.companyName);
      if (contacts.length === 0) {
        throw new Error("Selected rows need email, name, and company to save into a list.");
      }
      const { reservationId, status } = await reserveCredits(contacts.length);
      setCredits(status);
      let appended: Awaited<ReturnType<typeof appendContactsInChunks>>;
      try {
        appended = await appendContactsInChunks({ listId, contacts });
      } catch (err) {
        await refundCredits(reservationId);
        throw err;
      }
      const { list, importSummary } = appended;
      const target = lists.find((row) => row.id === listId);
      const name = list?.name ?? target?.name ?? "list";
      addHistory({
        listName: name,
        listId,
        contactCount: contacts.length,
        filtersSummary: "Added from Enrich",
      });
      setFlash(
        `Added ${contacts.length.toLocaleString()} contact${contacts.length === 1 ? "" : "s"} to “${name}”` +
          (importSummary.skipped
            ? ` (${importSummary.skipped.toLocaleString()} skipped)`
            : ""),
      );
      await refreshLists();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to add to list");
    } finally {
      setListActionBusy(false);
      void refreshCredits();
    }
  }

  async function lookupDuplicatesForRecords(records: DataToolRecord[]) {
    setCheckingDuplicates(true);
    setDuplicates([]);
    const emails = [
      ...new Set(
        records.map((record) => String(record.email ?? "").trim().toLowerCase()).filter(Boolean),
      ),
    ];
    try {
      if (emails.length === 0) return;
      const matchMap = new Map<string, ExistingListRef[]>();
      const LOOKUP_CHUNK = 500;
      for (let index = 0; index < emails.length; index += LOOKUP_CHUNK) {
        const emailChunk = emails.slice(index, index + LOOKUP_CHUNK);
        const response = await fetch("/api/crm/contacts/lookup-lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: emailChunk }),
        });
        const data = await response.json();
        if (!response.ok) continue;
        for (const match of (data.matches as
          | Array<{ email: string; lists: ExistingListRef[] }>
          | undefined) ?? []) {
          matchMap.set(match.email.toLowerCase(), match.lists);
        }
      }
      const nextDuplicates: DuplicateMatch[] = [];
      for (const record of records) {
        const email = String(record.email ?? "").trim().toLowerCase();
        const matched = email ? matchMap.get(email) ?? [] : [];
        if (matched.length === 0) continue;
        nextDuplicates.push({
          recordId: record.id,
          email,
          name: recordLabel(record),
          lists: matched,
        });
      }
      setDuplicates(nextDuplicates);
    } catch {
      // Keep save usable if lookup fails.
    } finally {
      setCheckingDuplicates(false);
    }
  }

  async function openSaveModal(context: EnrichSelectionContext, name?: string) {
    if (loadingSave) return;
    if (context.ids.length > ENRICH_MAX_SAVE) {
      setActionError(ENRICH_MAX_SAVE_MESSAGE);
      return;
    }
    if (credits && context.ids.length > credits.remaining) {
      setActionError(notEnoughCreditsMessage(credits.remaining));
      return;
    }
    setLoadingSave(true);
    setActionError("");
    let loaded: DataToolRecord[];
    try {
      loaded = await fetchEnrichRecords(context.ids);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to load contacts");
      setLoadingSave(false);
      return;
    }
    setLoadingSave(false);

    const withEmail = loaded.filter((record) => String(record.email ?? "").trim().length > 0);
    if (withEmail.length === 0) {
      setActionError("None of these contacts have an email address.");
      return;
    }

    const creditCap = credits ? credits.remaining : ENRICH_MAX_SAVE;
    const maxSavable = Math.min(withEmail.length, ENRICH_MAX_SAVE, Math.max(0, creditCap));
    if (maxSavable === 0) {
      setActionError("No data credits left this month.");
      return;
    }

    const stamp = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
    setSaveCandidates(withEmail);
    setSaveRecords([]);
    setSaveDesiredCount(maxSavable);
    setSaveSummary(context.filtersSummary);
    setListName(name?.trim() || `Enriched ${stamp}`);
    setSaveError("");
    setSaveProgress(null);
    setDuplicates([]);
    setSaveStep("count");
    setSaveOpen(true);
  }

  const saveCountLimit = Math.min(
    saveCandidates.length,
    ENRICH_MAX_SAVE,
    credits ? Math.max(0, credits.remaining) : ENRICH_MAX_SAVE,
  );

  function clampSaveDesiredCount(raw: number) {
    if (!Number.isFinite(raw) || raw < 1) return 1;
    return Math.min(Math.floor(raw), Math.max(1, saveCountLimit));
  }

  function continueSaveToNameStep() {
    const desired = clampSaveDesiredCount(saveDesiredCount);
    const chosen = saveCandidates.slice(0, desired);
    setSaveDesiredCount(desired);
    setSaveRecords(chosen);
    setSaveStep("name");
    void lookupDuplicatesForRecords(chosen);
  }

  function closeSaveModal() {
    if (saving) return;
    setSaveOpen(false);
    setSaveStep("count");
    setSaveCandidates([]);
    setSaveRecords([]);
    setDuplicates([]);
    setSaveError("");
    setSaveProgress(null);
  }

  function removeDuplicateFromSave(recordId: string) {
    setSaveRecords((current) => current.filter((record) => record.id !== recordId));
    setDuplicates((current) => current.filter((row) => row.recordId !== recordId));
  }

  function removeAllDuplicatesFromSave() {
    const dupIds = new Set(duplicates.map((row) => row.recordId));
    setSaveRecords((current) => current.filter((record) => !dupIds.has(record.id)));
    setDuplicates([]);
  }

  async function saveToList() {
    const name = listName.trim();
    if (!name || saving) {
      return;
    }
    const contacts = saveRecords
      .map(mapDataToolRecordToContact)
      .filter((row) => row.email && row.firstName && row.companyName);

    if (contacts.length === 0) {
      setSaveError("Selected rows need email, name, and company to save into a list.");
      return;
    }

    setSaving(true);
    setSaveError("");
    let reservationId = "";
    try {
      const reservation = await reserveCredits(contacts.length);
      reservationId = reservation.reservationId;
      setCredits(reservation.status);
      const { list } = await createListWithChunkedImport({
        name,
        contacts,
        importFileName: "data-tool-enrich",
        onProgress: setSaveProgress,
      });
      reservationId = "";
      const listId = list?.id || "";
      if (listId) {
        addHistory({
          listName: name,
          listId,
          contactCount: contacts.length,
          filtersSummary: saveSummary,
        });
      }
      closeSaveModal();
      if (listId) {
        router.push(portalListRoute(listId));
      }
    } catch (err) {
      if (reservationId) await refundCredits(reservationId);
      setSaveError(err instanceof Error ? err.message : "Failed to save list");
    } finally {
      setSaving(false);
      void refreshCredits();
    }
  }

  return (
    <div className={`enrich-page${phase === "browse" ? " enrich-page-browse" : ""}`}>
      <div className="crm-page-head">
        <div>
          <h2>Enrich</h2>
          <p className="desc">
            Search the people database with filters or AI, review matches, and save full
            contact details into CRM lists.
          </p>
        </div>
        <div className="enrich-head-actions">
        {credits ? (
          <div
            className={`enrich-credits${credits.remaining === 0 ? " is-empty" : ""}`}
            title={`${credits.used.toLocaleString()} of ${credits.limit.toLocaleString()} used this month`}
          >
            <span className="enrich-credits-label">Data credits</span>
            <strong>
              {credits.remaining.toLocaleString()}
              <span> / {credits.limit.toLocaleString()}</span>
            </strong>
            <span className="enrich-credits-reset">Resets {formatResetDate(credits.resetsAt)}</span>
          </div>
        ) : null}
        {phase === "home" ? (
          <button type="button" className="btn-dark" onClick={openBrowser}>
            + Enrich
          </button>
        ) : (
          <button type="button" className="btn-soft" onClick={backToHistory}>
            History
          </button>
        )}
        </div>
      </div>

      {phase === "home" ? (
        <section className="enrich-history">
          {history.length === 0 ? (
            <div className="enrich-empty">
              No enrich history yet. Click <strong>+ Enrich</strong> to search
              the people database and save contacts to a list.
            </div>
          ) : (
            <div className="enrich-table-wrap">
              <table className="data-table enrich-table enrich-history-table">
                <thead>
                  <tr>
                    <th>List</th>
                    <th>Contacts</th>
                    <th>Filters</th>
                    <th>Saved</th>
                    <th className="enrich-actions-col" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <button
                          type="button"
                          className="btn-link-purple enrich-history-link"
                          onClick={() => router.push(portalListRoute(entry.listId))}
                        >
                          <span className="enrich-cell-text" title={entry.listName}>
                            {entry.listName}
                          </span>
                        </button>
                      </td>
                      <td>{entry.contactCount.toLocaleString()}</td>
                      <td>
                        <span className="enrich-meta enrich-cell-text" title={entry.filtersSummary}>
                          {entry.filtersSummary}
                        </span>
                      </td>
                      <td>
                        {new Date(entry.savedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="enrich-actions-col">
                        <button
                          type="button"
                          className="enrich-icon-delete"
                          onClick={() => deleteHistoryEntry(entry.id)}
                          aria-label={`Delete ${entry.listName} from history`}
                          title="Delete"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 6h18" />
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="enrich-browse">
          {actionError ? (
            <PortalToast key={actionError} message={actionError} onDone={() => setActionError("")} />
          ) : flash ? (
            <PortalToast key={flash} variant="success" message={flash} onDone={() => setFlash("")} />
          ) : null}
          {loadingSave ? <div className="enrich-flash">Loading contacts…</div> : null}
          <EnrichPeopleBrowser
            listOptions={lists}
            listsLoading={listsLoading}
            listActionBusy={listActionBusy || loadingSave}
            exporting={exporting}
            onSaveToNewList={openSaveModal}
            onAddToList={addToExistingList}
            onExport={exportCsv}
            creditsRemaining={credits ? credits.remaining : null}
          />
        </section>
      )}

      {saveOpen ? (
        <div className="crm-modal-backdrop" onClick={closeSaveModal}>
          <div
            className="crm-modal enrich-save-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="enrich-save-title"
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="enrich-save-title">Save to list</h3>
                <p>
                  {saveStep === "count"
                    ? "Choose how many contacts to save. We only save contacts that have an email."
                    : `Create a CRM list with ${saveRecords.length.toLocaleString()} contact${saveRecords.length === 1 ? "" : "s"} that have an email.`}
                </p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                onClick={closeSaveModal}
                aria-label="Close"
                disabled={saving}
              >
                ×
              </button>
            </div>

            {saveStep === "count" ? (
              <>
                <div className="crm-modal-body">
                  <div className="enrich-save-hint">
                    <strong>{saveCandidates.length.toLocaleString()}</strong> contact
                    {saveCandidates.length === 1 ? "" : "s"} have an email and can be saved.
                    Contacts without an email are skipped.
                  </div>
                  <div className="crm-field">
                    <label htmlFor="enrich-save-count">How many contacts do you want to save?</label>
                    <input
                      id="enrich-save-count"
                      type="number"
                      min={1}
                      max={Math.max(1, saveCountLimit)}
                      value={saveDesiredCount}
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw === "") {
                          setSaveDesiredCount(1);
                          return;
                        }
                        setSaveDesiredCount(clampSaveDesiredCount(Number(raw)));
                      }}
                      onBlur={() => setSaveDesiredCount((n) => clampSaveDesiredCount(n))}
                      autoFocus
                    />
                  </div>
                  {credits ? (
                    <p className="enrich-dup-status">
                      Data credits remaining: {credits.remaining.toLocaleString()}
                    </p>
                  ) : null}
                  {saveError ? <div className="crm-error">{saveError}</div> : null}
                </div>
                <div className="crm-modal-foot">
                  <button type="button" className="btn-link-purple" onClick={closeSaveModal}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-dark"
                    onClick={continueSaveToNameStep}
                    disabled={saveCountLimit === 0}
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
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

                  {checkingDuplicates ? (
                    <p className="enrich-dup-status">Checking for existing emails…</p>
                  ) : null}

                  {!checkingDuplicates && duplicates.length > 0 ? (
                    <div className="enrich-dup-panel">
                      <div className="enrich-dup-panel-head">
                        <div>
                          <strong>{duplicates.length} already in your lists</strong>
                          <p>
                            These emails already belong to other CRM lists. Remove them before
                            saving, or keep them to add again.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn-soft enrich-danger-btn"
                          onClick={removeAllDuplicatesFromSave}
                          disabled={saving}
                        >
                          Remove all
                        </button>
                      </div>
                      <ul className="enrich-dup-list">
                        {duplicates.map((row) => (
                          <li key={row.recordId}>
                            <div>
                              <div className="enrich-name">{row.name}</div>
                              <div className="enrich-meta">{row.email}</div>
                              <div className="enrich-meta">
                                In{" "}
                                {row.lists
                                  .map((list) => `${list.name} (#${list.displayId})`)
                                  .join(", ")}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn-soft enrich-danger-btn"
                              onClick={() => removeDuplicateFromSave(row.recordId)}
                              disabled={saving}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {!checkingDuplicates && duplicates.length === 0 && saveRecords.length > 0 ? (
                    <p className="enrich-dup-status ok">
                      No selected emails are already on other lists.
                    </p>
                  ) : null}

                  {saving && saveProgress ? (
                    <p className="enrich-dup-status">
                      Saving {saveProgress.done.toLocaleString()} of{" "}
                      {saveProgress.total.toLocaleString()}…
                    </p>
                  ) : null}

                  {saveError ? <div className="crm-error">{saveError}</div> : null}
                </div>
                <div className="crm-modal-foot">
                  <button
                    type="button"
                    className="btn-link-purple"
                    onClick={() => {
                      if (!saving) setSaveStep("count");
                    }}
                    disabled={saving}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn-dark"
                    onClick={() => void saveToList()}
                    disabled={
                      saving || !listName.trim() || saveRecords.length === 0 || checkingDuplicates
                    }
                  >
                    {saving
                      ? "Saving…"
                      : `Save ${saveRecords.length.toLocaleString()} contact${saveRecords.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
