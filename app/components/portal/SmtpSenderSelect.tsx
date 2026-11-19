"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SmtpProviderBadge } from "@/app/components/portal/SmtpProviderBadge";
import { isConnectedSender, type SmtpProviderId } from "@/lib/smtp-senders";

export type SmtpSenderOption = {
  id: string;
  provider: string;
  fromEmail: string;
  connection?: { status?: "connected" | "disconnected" };
};

export default function SmtpSenderSelect({
  senders,
  value,
  onChange,
  id,
  labelledBy,
  placeholder = "Select a sender",
  className = "",
  allowEmpty = false,
  emptyLabel = "No sender",
  disabled = false,
}: {
  senders: SmtpSenderOption[];
  value: string;
  onChange: (senderId: string) => void;
  id?: string;
  labelledBy?: string;
  placeholder?: string;
  className?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const options = senders.filter((sender) => isConnectedSender(sender));
  const selected = options.find((sender) => sender.id === value) ?? null;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter(
      (sender) =>
        sender.fromEmail.toLowerCase().includes(query) ||
        sender.provider.toLowerCase().includes(query),
    );
  }, [options, search]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const triggerLabel = selected?.fromEmail
    ? selected.fromEmail
    : allowEmpty && !value
      ? emptyLabel
      : placeholder;

  return (
    <div className={`drip-sender-select ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        id={id}
        className={`drip-sender-select-trigger${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        disabled={disabled || (!allowEmpty && options.length === 0)}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="drip-sender-select-value">
          {selected ? (
            <SmtpProviderBadge
              iconOnly
              providerId={selected.provider as SmtpProviderId | undefined}
            />
          ) : null}
          <span>{triggerLabel}</span>
        </span>
        {selected ? (
          <span
            className={`vs-connection ${selected.connection?.status === "connected" ? "is-connected" : "is-disconnected"}`}
          >
            {selected.connection?.status === "connected" ? "Connected" : "Disconnected"}
          </span>
        ) : null}
        <svg
          className="drip-sender-select-caret"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="drip-sender-select-menu" role="listbox">
          <label className="drip-sender-select-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search senders"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </label>
          {allowEmpty ? (
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className={`drip-sender-select-option${!value ? " selected" : ""}`}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <span>{emptyLabel}</span>
              {!value ? (
                <svg
                  className="drip-sender-select-check"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : null}
            </button>
          ) : null}
          {options.length === 0 ? (
            <p className="drip-sender-select-empty">No connected senders.</p>
          ) : filtered.length === 0 ? (
            <p className="drip-sender-select-empty">No senders match your search.</p>
          ) : (
            filtered.map((sender) => {
              const isSelected = sender.id === value;
              return (
                <button
                  key={sender.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`drip-sender-select-option${isSelected ? " selected" : ""}`}
                  onClick={() => {
                    onChange(sender.id);
                    setOpen(false);
                  }}
                >
                  <SmtpProviderBadge iconOnly providerId={sender.provider as SmtpProviderId} />
                  <span>{sender.fromEmail}</span>
                  {isSelected ? (
                    <svg
                      className="drip-sender-select-check"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      aria-hidden="true"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
