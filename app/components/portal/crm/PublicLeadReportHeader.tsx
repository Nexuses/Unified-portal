"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";

const NEXUSES_LOGO_URL =
  "https://cdn-nexlink.s3.us-east-2.amazonaws.com/Nexuses-full-logo-dark_8d412ea3-bf11-4fc6-af9c-bee7e51ef494.png";

type Props = {
  clientName?: string;
  clientLogoUrl?: string;
  pdfBusy?: boolean;
  onDownloadPdf: () => void;
};

export default function PublicLeadReportHeader({
  clientName,
  clientLogoUrl,
  pdfBusy = false,
  onDownloadPdf,
}: Props) {
  const name = clientName?.trim() || "Client";
  const logo = clientLogoUrl?.trim() || "";
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (!root.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="public-report-header">
      <div className="public-report-header-card">
        <div className="public-report-header-brands">
          <Image
            src={NEXUSES_LOGO_URL}
            alt="Nexuses"
            width={128}
            height={28}
            className="public-report-logo"
            style={{ width: "auto", height: 28 }}
            priority
            unoptimized
          />
          <div className="public-report-client-cluster" ref={rootRef}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="public-report-client-logo"
                src={logo}
                alt={`${name} logo`}
              />
            ) : (
              <span
                className="public-report-client-fallback"
                aria-label={`${name} logo`}
              >
                {name.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="public-lead-menu">
              <button
                type="button"
                className="public-lead-menu-trigger"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={menuId}
                onClick={() => setOpen((value) => !value)}
              >
                <span aria-hidden="true">⋮</span>
              </button>
              {open ? (
                <div
                  id={menuId}
                  className="public-lead-menu-panel"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="public-lead-menu-item"
                    disabled={pdfBusy}
                    onClick={() => {
                      setOpen(false);
                      onDownloadPdf();
                    }}
                  >
                    {pdfBusy ? "Preparing PDF…" : "Download PDF"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
