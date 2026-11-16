"use client";

import { useEffect, useRef, useState } from "react";

export type CloudDesktopLayout = "floating" | "maximized" | "minimized";

type Point = { x: number; y: number };
type Size = { w: number; h: number };

const MIN_W = 300;
const MIN_H = 210;
const SIZE_KEY = "cloud-desktop-size-v2";
type ResizeEdge = "e" | "s" | "se";

function loadSize(): Size | null {
  try {
    const raw = window.localStorage.getItem(SIZE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Size>;
    if (typeof parsed.w === "number" && typeof parsed.h === "number") {
      return { w: Math.max(MIN_W, parsed.w), h: Math.max(MIN_H, parsed.h) };
    }
  } catch {
    /* storage unavailable */
  }
  return null;
}

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
  const [size, setSize] = useState<Size | null>(() =>
    typeof window === "undefined" ? null : loadSize(),
  );
  const resizeRef = useRef<{
    pointerId: number;
    edge: ResizeEdge;
    startX: number;
    startY: number;
    originW: number;
    originH: number;
  } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Full screen is view-only until the user explicitly takes control, so the
  // embedded desktop never mirrors their mouse and keyboard by accident.
  const [controlling, setControlling] = useState(false);
  const interactive = maximized && controlling;

  function changeLayout(next: CloudDesktopLayout) {
    if (next !== "maximized") setControlling(false);
    onLayoutChange(next);
  }

  useEffect(() => {
    if (interactive) iframeRef.current?.focus();
  }, [interactive]);

  useEffect(() => {
    if (!maximized) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // First Escape releases control, the next one leaves full screen.
        if (controlling) setControlling(false);
        else onLayoutChange("floating");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [maximized, controlling, onLayoutChange]);

  useEffect(() => {
    if (!floating) return;
    function onResize() {
      setSize((current) =>
        current
          ? {
              w: Math.min(current.w, Math.max(MIN_W, window.innerWidth - 16)),
              h: Math.min(current.h, Math.max(MIN_H, window.innerHeight - 16)),
            }
          : current,
      );
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [floating]);

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

  function onResizePointerDown(event: React.PointerEvent<HTMLElement>) {
    const edge = (event.currentTarget.dataset.edge || "se") as ResizeEdge;
    if (!floating || event.button !== 0) return;
    const node = rootRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    // Anchor to top-left so the handles grow the window the way the cursor moves.
    setPosition((current) => current ?? { x: rect.left, y: rect.top });
    setSize((current) => current ?? { w: rect.width, h: rect.height });
    resizeRef.current = {
      pointerId: event.pointerId,
      edge,
      startX: event.clientX,
      startY: event.clientY,
      originW: rect.width,
      originH: rect.height,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function onResizePointerMove(event: React.PointerEvent<HTMLElement>) {
    const drag = resizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = rootRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    const maxW = Math.max(MIN_W, window.innerWidth - left - 8);
    const maxH = Math.max(MIN_H, window.innerHeight - top - 8);
    const dx = drag.edge === "s" ? 0 : event.clientX - drag.startX;
    const dy = drag.edge === "e" ? 0 : event.clientY - drag.startY;
    setSize({
      w: Math.min(maxW, Math.max(MIN_W, drag.originW + dx)),
      h: Math.min(maxH, Math.max(MIN_H, drag.originH + dy)),
    });
  }

  function endResize(event: React.PointerEvent<HTMLElement>) {
    const drag = resizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    try {
      window.localStorage.setItem(
        SIZE_KEY,
        JSON.stringify({ w: Math.round(rect.width), h: Math.round(rect.height) }),
      );
    } catch {
      /* storage unavailable */
    }
  }

  const positioned = !maximized && position;
  const sized = floating && size;

  return (
    <aside
      ref={rootRef}
      className={`cloud-desktop is-floating${maximized ? " is-maximized" : ""}${
        minimized ? " is-minimized" : ""
      }${dragging ? " is-dragging" : ""}`}
      aria-label="Boat computer"
      aria-modal={maximized || undefined}
      role={maximized ? "dialog" : undefined}
      style={{
        ...(positioned
          ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
          : {}),
        ...(sized ? { width: size.w, height: size.h } : {}),
      }}
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
            <span>Drag to move · drag the corner to resize · view only</span>
          ) : minimized ? (
            <span>Drag to move · preview</span>
          ) : interactive ? (
            <span>You are controlling the computer — release control when done.</span>
          ) : awaitingLoginConfirm ? (
            <span>View only. Take control to sign in, then confirm below.</span>
          ) : (
            <span>View only — your mouse and keyboard are not sent to the computer.</span>
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
              onClick={() => changeLayout("floating")}
              aria-label="Restore computer"
              title="Restore"
            >
              ↗
            </button>
          ) : null}
          {maximized ? (
            <button
              type="button"
              className={`cloud-desktop-control${interactive ? " is-on" : ""}`}
              onClick={() => setControlling((current) => !current)}
              style={{ width: "auto", height: "auto", padding: "5px 11px", fontSize: 12 }}
            >
              {interactive ? "Release control" : "Take control"}
            </button>
          ) : null}
          {maximized ? (
            <button
              type="button"
              onClick={() => changeLayout("floating")}
              aria-label="Exit full screen"
              title="Exit full screen"
            >
              ↘
            </button>
          ) : (
            <button
              type="button"
              onClick={() => changeLayout("maximized")}
              aria-label="Full screen"
              title="Full screen"
            >
              ⛶
            </button>
          )}
          {!minimized ? (
            <button
              type="button"
              onClick={() => changeLayout("minimized")}
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
          ref={iframeRef}
          className="cloud-desktop-frame"
          src={desktopUrl}
          title="Cloud campaign computer"
          allow="clipboard-read; clipboard-write; fullscreen; autoplay"
          style={interactive ? undefined : { pointerEvents: "none" }}
          tabIndex={interactive ? undefined : -1}
          aria-hidden={interactive ? undefined : true}
        />
        {maximized && !interactive ? (
          <div className="cloud-desktop-viewonly">
            <button type="button" className="btn-dark" onClick={() => setControlling(true)}>
              Take control
            </button>
          </div>
        ) : null}
        {!maximized ? (
          <button
            type="button"
            className="cloud-desktop-preview-hit"
            onClick={() => changeLayout("maximized")}
            aria-label="Open computer full screen"
            title="Open full screen"
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
      {floating
        ? (["e", "s", "se"] as const).map((edge) => (
            <div
              key={edge}
              data-edge={edge}
              className={`cloud-desktop-resize cloud-desktop-resize-${edge}`}
              role="separator"
              aria-label="Resize computer preview"
              onPointerDown={onResizePointerDown}
              onPointerMove={onResizePointerMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
            />
          ))
        : null}
    </aside>
  );
}
