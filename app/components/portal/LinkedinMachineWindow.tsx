"use client";

import { useEffect, useRef, useState } from "react";

type Layout = "floating" | "maximized" | "minimized";
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

export default function LinkedinMachineWindow({
  desktopUrl,
  onClose,
}: {
  desktopUrl: string;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [layout, setLayout] = useState<Layout>("floating");
  const [position, setPosition] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const maximized = layout === "maximized";
  const minimized = layout === "minimized";

  useEffect(() => {
    if (!maximized) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setLayout("floating");
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [maximized]);

  function onPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (maximized || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".li-vm-actions button, .li-vm-actions a")) return;
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

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const node = rootRef.current;
    if (!node) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    const rect = node.getBoundingClientRect();
    setPosition(clampPosition(drag.originX + dx, drag.originY + dy, rect.width, rect.height));
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
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
      className={`li-vm${maximized ? " is-max" : ""}${minimized ? " is-min" : ""}${
        dragging ? " is-dragging" : ""
      }`}
      aria-label="LinkedIn virtual machine"
      style={
        positioned
          ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
          : undefined
      }
    >
      <header
        className="li-vm-bar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <strong>LinkedIn</strong>
        <div className="li-vm-actions">
          {minimized ? (
            <button type="button" aria-label="Restore" title="Restore" onClick={() => setLayout("floating")}>
              ↗
            </button>
          ) : (
            <button
              type="button"
              aria-label={maximized ? "Exit full screen" : "Full screen"}
              title={maximized ? "Exit full screen" : "Full screen"}
              onClick={() => setLayout(maximized ? "floating" : "maximized")}
            >
              {maximized ? "↘" : "⛶"}
            </button>
          )}
          {!minimized ? (
            <button type="button" aria-label="Minimize" title="Minimize" onClick={() => setLayout("minimized")}>
              –
            </button>
          ) : null}
          <button type="button" aria-label="Close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      <div className="li-vm-stage">
        <iframe
          className="li-vm-frame"
          src={desktopUrl}
          title="LinkedIn virtual machine"
          allow="clipboard-read; clipboard-write; fullscreen; autoplay"
        />
        {!maximized ? (
          <button
            type="button"
            className="li-vm-drag"
            aria-label="Drag to move, or click for full screen"
            title="Drag to move · click for full screen"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              setLayout("maximized");
            }}
          />
        ) : null}
      </div>
    </aside>
  );
}
