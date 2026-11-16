"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
};

type Pending = ConfirmOptions & { message: string; resolve: (ok: boolean) => void };

/**
 * In-page replacement for window.confirm (native dialogs are blocked in some embedded
 * browsers, which made actions like Delete silently do nothing).
 * Usage: const [confirm, dialog] = useConfirmDialog(); if (await confirm("Delete?")) …; render {dialog}.
 */
export function useConfirmDialog() {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback(
    (message: string, options: ConfirmOptions = {}) =>
      new Promise<boolean>((resolve) => setPending({ ...options, message, resolve })),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, close]);

  const dialog = pending ? (
    <div className="confirm-overlay" role="presentation" onClick={() => close(false)}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <strong id="confirm-title">{pending.title || "Are you sure?"}</strong>
        <p>{pending.message}</p>
        <div className="confirm-actions">
          <button type="button" className="btn-soft btn-sm" onClick={() => close(false)}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn-dark btn-sm${pending.danger ? " is-danger" : ""}`}
            onClick={() => close(true)}
          >
            {pending.confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return [confirm, dialog] as const;
}
