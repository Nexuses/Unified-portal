"use client";

import { useEffect, useRef, useState } from "react";

export type CloudDesktopLayout = "floating" | "maximized" | "minimized";

type Point = { x: number; y: number };

function clampPosition(x: number, y: number, width: number, height: number) {
  const pad = 8;
  const maxX = Math.max(pad, window.innerWidth - width - pad);
  const maxY = Math.max(pad, window.innerHeight - height - pad);
  return {
    x: Math.min(maxX, Math.max(pad, x)),
    y: Math.min(maxY, Math.max(pad, y)),
  };
}

export default function CloudDesktopViewer({
  desktopUrl,
  layout,
  busy,
  awaitingLoginConfirm,
  confirmLabel = "I’ve signed in — check inbox",
  onLayoutChange,
  onClose,
  onConfirmLogin,
}: {
  desktopUrl: string;
  layout: CloudDesktopLayout;
  busy: boolean;
  awaitingLoginConfirm: boolean;
  confirmLabel?: string;
  onLayoutChange: (layout: CloudDesktopLayout) => void;
  onClose: () => void;
  onConfirmLogin?: () => void;
}) {
  const maximized = layout === "maximized";
  const minimized = layout === "minimized";
  const floating = layout === "floating";
  const rootRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const [position, setPosition] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!maximized) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onLayoutChange("floating");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [maximized, onLayoutChange]);

  useEffect(() => {
    if (maximized || !position) return;
    function onResize() {
      const node = rootRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setPosition((current) => {
        if (!current) return current;
        return clampPosition(current.x, current.y, rect.width, rect.height);
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [maximized, position]);

  function onDragHandlePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (maximized) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select, label")) return;
    const node = rootRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const origin = position ?? { x: rect.left, y: rect.top };
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      moved: false,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onDragHandlePointerMove(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const node = rootRef.current;
    if (!node) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    const rect = node.getBoundingClientRect();
    setPosition(
      clampPosition(drag.originX + dx, drag.originY + dy, rect.width, rect.height),
    );
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  }

  const positioned = !maximized && position;

  return (
    <aside
      ref={rootRef}
      className={`cloud-desktop is-floating${maximized ? " is-maximized" : ""}${
        minimized ? " is-minimized" : ""
      }${dragging ? " is-dragging" : ""}`}
      aria-label="Boat computer"
      aria-modal={maximized || undefined}
      role={maximized ? "dialog" : undefined}
      style={
        positioned
          ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
          : undefined
      }
    >
      <header
        className="cloud-desktop-bar"
        onPointerDown={onDragHandlePointerDown}
        onPointerMove={onDragHandlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="cloud-desktop-bar-copy">
          <strong>
            {maximized
              ? "Computer — full screen"
              : minimized
                ? "Computer"
                : "Computer"}
          </strong>
          {floating ? (
            <span>Drag to move · preview only — full screen to control</span>
          ) : minimized ? (
            <span>Drag to move · preview</span>
          ) : awaitingLoginConfirm ? (
            <span>Sign in here, then confirm below.</span>
          ) : (
            <span>Full-screen control</span>
          )}
        </div>
        <div className="cloud-desktop-actions">
          {!minimized ? (
            <a href={desktopUrl} target="_blank" rel="noopener noreferrer">
              New tab
            </a>
          ) : null}
          {minimized ? (
            <button
              type="button"
              onClick={() => onLayoutChange("floating")}
              aria-label="Restore computer"
              title="Restore"
            >
              ↗
            </button>
          ) : null}
          {maximized ? (
            <button
              type="button"
              onClick={() => onLayoutChange("floating")}
              aria-label="Exit full screen"
              title="Exit full screen"
            >
              ↘
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onLayoutChange("maximized")}
              aria-label="Full screen"
              title="Full screen"
            >
              ⛶
            </button>
          )}
          {!minimized ? (
            <button
              type="button"
              onClick={() => onLayoutChange("minimized")}
              aria-label="Minimize computer"
              title="Minimize"
            >
              –
            </button>
          ) : null}
          <button type="button" onClick={onClose} aria-label="Hide computer" title="Hide">
            ×
          </button>
        </div>
      </header>

      <div className="cloud-desktop-stage">
        <iframe
          className="cloud-desktop-frame"
          src={desktopUrl}
          title="Cloud campaign computer"
          allow="clipboard-read; clipboard-write; fullscreen; autoplay"
          style={maximized ? undefined : { pointerEvents: "none" }}
          tabIndex={maximized ? undefined : -1}
          aria-hidden={maximized ? undefined : true}
        />
        {!maximized ? (
          <button
            type="button"
            className="cloud-desktop-preview-hit"
            onClick={() => onLayoutChange("maximized")}
            aria-label="Open computer full screen"
            title="Open full screen to control"
          />
        ) : null}
      </div>

      {awaitingLoginConfirm && onConfirmLogin && !minimized ? (
        <footer className="cloud-desktop-confirm">
          <p>
            Use the desktop above to finish Gmail or Outlook sign-in (password, OTP, phone
            confirm). When the inbox is open, confirm here to continue.
          </p>
          <button
            type="button"
            className="btn-dark"
            disabled={busy}
            onClick={() => onConfirmLogin()}
          >
            {busy ? "Checking…" : confirmLabel}
          </button>
        </footer>
      ) : null}

      {minimized && awaitingLoginConfirm && onConfirmLogin ? (
        <footer className="cloud-desktop-confirm cloud-desktop-confirm-mini">
          <button
            type="button"
            className="btn-dark"
            disabled={busy}
            onClick={() => onConfirmLogin()}
          >
            {busy ? "Checking…" : confirmLabel}
          </button>
        </footer>
      ) : null}
    </aside>
  );
}
