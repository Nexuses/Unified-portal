"use client";

import { Filter, X } from "lucide-react";
import {
  COLUMN_FILTER_OPERATORS,
  columnFilterRuleLabel,
  createColumnFilterRule,
  operatorNeedsValue,
  type ColumnFilterLogic,
  type ColumnFilterOperator,
  type ColumnFilterRule,
  type ColumnFilterState,
} from "@/lib/people/column-filters";

type ColumnFiltersBarProps = {
  state: ColumnFilterState;
  columnLabels: Record<string, string>;
  onChange: (next: ColumnFilterState) => void;
};

export default function ColumnFiltersBar({
  state,
  columnLabels,
  onChange,
}: ColumnFiltersBarProps) {
  if (state.rules.length === 0) return null;

  function setLogic(logic: ColumnFilterLogic) {
    onChange({ ...state, logic });
  }

  function removeRule(id: string) {
    onChange({
      ...state,
      rules: state.rules.filter((rule) => rule.id !== id),
    });
  }

  function clearAll() {
    onChange({ logic: state.logic, rules: [] });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-2">
      <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Filter className="h-3.5 w-3.5" />
        Table filters
      </span>
      {state.rules.length > 1 ? (
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setLogic("and")}
            className={`rounded-md px-2 py-1 font-medium ${
              state.logic === "and"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Match all (AND)
          </button>
          <button
            type="button"
            onClick={() => setLogic("or")}
            className={`rounded-md px-2 py-1 font-medium ${
              state.logic === "or"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Match any (OR)
          </button>
        </div>
      ) : null}
      {state.rules.map((rule) => (
        <span
          key={rule.id}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-800"
        >
          <span className="truncate">
            {columnFilterRuleLabel(rule, columnLabels[rule.columnId])}
          </span>
          <button
            type="button"
            onClick={() => removeRule(rule.id)}
            className="rounded-full p-0.5 hover:bg-blue-100"
            aria-label="Remove table filter"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={clearAll}
        className="text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        Clear table filters
      </button>
    </div>
  );
}

type ColumnFilterEditorProps = {
  columnId: string;
  columnHeader: string;
  existing?: ColumnFilterRule | null;
  onApply: (rule: ColumnFilterRule) => void;
  onClose: () => void;
};

export function ColumnFilterEditor({
  columnId,
  columnHeader,
  existing,
  onApply,
  onClose,
}: ColumnFilterEditorProps) {
  const initialOperator = existing?.operator ?? "contains";
  const initialValue = existing?.value ?? "";

  return (
    <form
      className="absolute right-0 z-50 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
      data-column-filter-editor
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const operator = (
          form.elements.namedItem("operator") as HTMLSelectElement
        ).value as ColumnFilterOperator;
        const value = (form.elements.namedItem("value") as HTMLInputElement)
          ?.value;
        if (operatorNeedsValue(operator) && !value?.trim()) return;
        onApply(
          existing
            ? { ...existing, operator, value: value?.trim() ?? "" }
            : createColumnFilterRule(columnId, operator, value?.trim() ?? "")
        );
        onClose();
      }}
    >
      <p className="mb-2 text-xs font-semibold text-slate-800">
        Filter · {columnHeader}
      </p>
      <label className="mb-1 block text-[11px] font-medium text-slate-500">
        Operator
      </label>
      <select
        name="operator"
        defaultValue={initialOperator}
        className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        onChange={(e) => {
          const needs = operatorNeedsValue(
            e.target.value as ColumnFilterOperator
          );
          const valueInput = e.currentTarget.form?.elements.namedItem(
            "value"
          ) as HTMLInputElement | null;
          if (valueInput) {
            valueInput.disabled = !needs;
            valueInput.parentElement!.style.display = needs ? "block" : "none";
          }
        }}
      >
        {COLUMN_FILTER_OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
      <div
        style={{
          display: operatorNeedsValue(initialOperator) ? "block" : "none",
        }}
      >
        <label className="mb-1 block text-[11px] font-medium text-slate-500">
          Value
        </label>
        <input
          name="value"
          type="text"
          defaultValue={initialValue}
          disabled={!operatorNeedsValue(initialOperator)}
          className="mb-3 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
          placeholder="Type a value…"
          autoFocus
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-md px-2.5 py-1 text-xs font-semibold bg-(--purple) text-white hover:bg-[#5b2fd0]"
        >
          Apply
        </button>
      </div>
    </form>
  );
}
