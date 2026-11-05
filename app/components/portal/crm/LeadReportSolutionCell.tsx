"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";

type LeadReportSolutionCellProps = {
  /** Current solution name ("" when the lead has none). */
  value: string;
  options: string[];
  saving?: boolean;
  /** Saves a single solution name, or "" to clear it. */
  onSave: (next: string) => void;
};

function cleanSolutionName(value: string) {
  // Solution names are stored comma-joined, so a name never contains separators.
  return value
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter(Boolean)[0] ?? "";
}

/**
 * Single solution per lead, edited inline in the lead reports table.
 * Enter commits, Escape cancels, empty input clears the solution.
 */
export default function LeadReportSolutionCell({
  value,
  options,
  saving = false,
  onSave,
}: LeadReportSolutionCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const current = value.trim();
  const suggestions = options.filter(
    (option) => option.toLowerCase() !== current.toLowerCase(),
  );

  function beginEdit() {
    setDraft(current);
    setEditing(true);
  }

  function commitDraft() {
    const name = cleanSolutionName(draft);
    setEditing(false);
    setDraft("");
    if (name === current) return;
    onSave(name);
  }

  if (editing) {
    return (
      <div className="lr-solution-cell">
        <input
          ref={inputRef}
          className="lr-solution-input"
          value={draft}
          list={listId}
          placeholder="Solution name…"
          aria-label="Solution"
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
              setDraft("");
            }
          }}
          onBlur={commitDraft}
        />
        <datalist id={listId}>
          {suggestions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </div>
    );
  }

  return (
    <div className="lr-solution-cell">
      {current ? (
        <span className="lr-solution-chip" title={current}>
          <span className="lr-solution-chip-text">{current}</span>
          <button
            type="button"
            className="lr-solution-chip-edit"
            aria-label={`Edit solution ${current}`}
            title="Edit solution"
            disabled={saving}
            onMouseDown={(event) => event.preventDefault()}
            onClick={beginEdit}
          >
            <Pencil aria-hidden="true" />
          </button>
          <button
            type="button"
            className="lr-solution-chip-remove"
            aria-label={`Remove solution ${current}`}
            title="Remove solution"
            disabled={saving}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSave("")}
          >
            <X aria-hidden="true" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="lr-solution-add"
          disabled={saving}
          onClick={beginEdit}
        >
          <Plus aria-hidden="true" />
          {saving ? "Saving…" : "Add solution"}
        </button>
      )}
    </div>
  );
}
