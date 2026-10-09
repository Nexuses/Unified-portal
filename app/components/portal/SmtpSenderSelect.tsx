"use client";

import { useEffect, useRef, useState } from "react";
import { SmtpProviderBadge } from "@/app/components/portal/SmtpProviderBadge";
import type { SmtpProviderId } from "@/lib/smtp-senders";

export type SmtpSenderOption = {
  id: string;
  provider: string;
  fromEmail: string;
};

export default function SmtpSenderSelect({
  senders,
  value,
  onChange,
  id,
  labelledBy,
  placeholder = "Select a sender",
  className = "",
}: {
  senders: SmtpSenderOption[];
  value: string;
  onChange: (senderId: string) => void;
  id?: string;
  labelledBy?: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = senders.find((sender) => sender.id === value) ?? senders[0] ?? null;

  useEffect(() => {
    if (!open) {
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
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`drip-sender-select ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        id={id}
        className={`drip-sender-select-trigger${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        disabled={senders.length === 0}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="drip-sender-select-value">
          <SmtpProviderBadge iconOnly providerId={selected?.provider as SmtpProviderId | undefined} />
          <span>{selected?.fromEmail || placeholder}</span>
        </span>
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
          {senders.map((sender) => {
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
          })}
        </div>
      ) : null}
    </div>
  );
}
