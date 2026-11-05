"use client";

import { useEffect } from "react";

type PortalToastProps = {
  message: string;
  variant?: "error" | "success" | "info";
  durationMs?: number;
  /** Stays visible until the parent unmounts or replaces the toast. */
  persistent?: boolean;
  onDone: () => void;
};

export default function PortalToast({
  message,
  variant = "error",
  durationMs,
  persistent = false,
  onDone,
}: PortalToastProps) {
  const resolvedDuration =
    durationMs ?? (variant === "error" ? 6000 : variant === "success" ? 4000 : 4000);

  useEffect(() => {
    if (persistent) {
      return;
    }
    const timer = window.setTimeout(onDone, resolvedDuration);
    return () => window.clearTimeout(timer);
  }, [persistent, resolvedDuration, onDone]);

  const toastClass =
    variant === "success"
      ? "drip-error-toast success"
      : variant === "info"
        ? "drip-error-toast info"
        : "drip-error-toast";

  return (
    <div
      className={toastClass}
      role={variant === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <div className="drip-error-toast-body">
        <span className="drip-error-toast-icon" aria-hidden="true">
          {variant === "info" ? (
            <span className="lr-loader-spinner lr-toast-spinner" />
          ) : variant === "success" ? (
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="currentColor" />
              <path
                d="M7.5 12.5 10.5 15.5 16.5 9"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="currentColor" />
              <path d="M12 10.5v6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="7.4" r="1.15" fill="#fff" />
            </svg>
          )}
        </span>
        <span className="drip-error-toast-text">{message}</span>
      </div>
      {persistent ? (
        <div className="drip-error-toast-progress is-active" aria-hidden="true">
          <span className="is-indeterminate" />
        </div>
      ) : (
        <div className="drip-error-toast-progress" aria-hidden="true">
          <span style={{ animationDuration: `${resolvedDuration}ms` }} />
        </div>
      )}
    </div>
  );
}
