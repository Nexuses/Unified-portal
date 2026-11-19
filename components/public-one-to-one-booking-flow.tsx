"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ButtonLoadingContent } from "@/components/button-loader";
import { meetingDurationMinutes } from "@/lib/one-to-one-booking-slots";
import {
  EVENT_WALL_TIME_ZONE,
  eventWallToUtc,
  formatEventSlotForViewer,
  formatHeaderClock,
  toWallDateYmd,
  viewerTimeZoneLabel,
} from "@/lib/public-event-time";
import { resolveViewerTimeZone } from "@/lib/use-viewer-time-zone";

export type PublicBookingSlot = {
  slotIndex: number;
  eventDate: string;
  eventTimeStart: string;
  eventTimeEnd: string;
};

type PublicOneToOneBookingFlowProps = {
  publicId: string;
  eventName: string;
  hostName: string;
  platform: string;
  slots: PublicBookingSlot[];
  triggerVariant?: "button" | "link";
  onRegisterSuccess?: (
    bookedSlotIndex: number,
    serverBookedSlotIndexes?: number[]
  ) => void;
};

function parseYmd(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function ymdFromDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatSlotTime(
  slot: PublicBookingSlot,
  viewerTimeZone: string,
  use12Hour: boolean
) {
  const start = eventWallToUtc(slot.eventDate, slot.eventTimeStart);
  if (!start) {
    return slot.eventTimeStart;
  }
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: use12Hour,
    timeZone: viewerTimeZone,
  }).format(start);
  return `${time} ${viewerTimeZoneLabel(start, viewerTimeZone)}`;
}

function buildMonthGrid(viewMonth: Date) {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ date: Date | null; ymd: string }> = [];
  for (let i = 0; i < startOffset; i += 1) {
    cells.push({ date: null, ymd: "" });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    cells.push({ date, ymd: ymdFromDate(date) });
  }
  return cells;
}

export function PublicOneToOneBookingFlow({
  publicId,
  eventName,
  hostName,
  platform,
  slots,
  triggerVariant = "button",
  onRegisterSuccess,
}: PublicOneToOneBookingFlowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<"pick" | "register">("pick");
  const [viewMonth, setViewMonth] = useState(() => {
    const first = slots[0];
    return parseYmd(first?.eventDate ?? "") ?? new Date();
  });
  const [selectedDateYmd, setSelectedDateYmd] = useState("");
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  const [use12Hour, setUse12Hour] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    companyName: "",
  });

  const viewerTimeZone = resolveViewerTimeZone() ?? EVENT_WALL_TIME_ZONE;
  const slotsByDate = useMemo(() => {
    const map = new Map<string, PublicBookingSlot[]>();
    for (const slot of slots) {
      const key = toWallDateYmd(slot.eventDate);
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.eventTimeStart.localeCompare(b.eventTimeStart));
    }
    return map;
  }, [slots]);

  const availableDates = useMemo(() => new Set(slotsByDate.keys()), [slotsByDate]);

  const selectedDaySlots = useMemo(() => {
    if (!selectedDateYmd) {
      return [];
    }
    return slotsByDate.get(selectedDateYmd) ?? [];
  }, [selectedDateYmd, slotsByDate]);

  const durationMinutes = useMemo(() => {
    const slot = selectedDaySlots[0] ?? slots[0];
    if (!slot) {
      return 30;
    }
    return meetingDurationMinutes(slot.eventTimeStart, slot.eventTimeEnd);
  }, [selectedDaySlots, slots]);

  const monthCells = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);

  function openModal() {
    const firstDate = slots[0]?.eventDate;
    if (firstDate) {
      const ymd = toWallDateYmd(firstDate);
      setSelectedDateYmd(ymd);
      setViewMonth(parseYmd(ymd) ?? new Date());
    } else {
      setSelectedDateYmd("");
    }
    setSelectedSlotIndex(null);
    setStep("pick");
    setMessage("");
    setIsOpen(true);
  }

  function closeModal() {
    setIsOpen(false);
    setMessage("");
    setStep("pick");
  }

  useEffect(() => {
    if (!isOpen || selectedDateYmd || !slots[0]?.eventDate) {
      return;
    }
    const ymd = toWallDateYmd(slots[0].eventDate);
    setSelectedDateYmd(ymd);
    setViewMonth(parseYmd(ymd) ?? new Date());
  }, [isOpen, selectedDateYmd, slots]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedSlotIndex === null) {
      return;
    }
    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await fetch(`/api/public-events/${publicId}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          calendarSlotIndex: selectedSlotIndex,
          viewerTimeZone: resolveViewerTimeZone(),
        }),
      });

      const payload = (await response.json()) as {
        message?: string;
        bookedSlotIndexes?: number[];
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to register.");
      }

      onRegisterSuccess?.(
        selectedSlotIndex,
        Array.isArray(payload.bookedSlotIndexes) ? payload.bookedSlotIndexes : undefined
      );

      setMessage("Registered successfully.");
      setFormData({ name: "", email: "", companyName: "" });
      setTimeout(() => {
        closeModal();
      }, 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to register.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const selectedSlot =
    selectedSlotIndex !== null
      ? slots.find((slot) => slot.slotIndex === selectedSlotIndex) ?? null
      : null;

  return (
    <>
      {triggerVariant === "link" ? (
        <button
          type="button"
          onClick={openModal}
          className="font-medium text-[#7f7f7f] hover:text-[#6f6f6f]"
        >
          <span aria-hidden className="text-[#141414]">→ </span>
          <span className="underline decoration-[#cfcfcf] decoration-[1.5px] underline-offset-[3px]">
            Link
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={openModal}
          className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-black text-[15px] font-semibold text-white transition hover:bg-black/90"
        >
          Register
        </button>
      )}

      <div
        className={`fixed inset-0 z-50 transition ${
          isOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
        aria-hidden={!isOpen}
      >
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${
            isOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={closeModal}
        />
        <div
          className={`absolute inset-0 flex items-center justify-center p-4 pb-20 transition-all duration-300 ${
            isOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <div
            className={`relative w-full overflow-hidden rounded-2xl bg-white shadow-2xl transition-all duration-300 ${
              step === "pick"
                ? "max-h-[min(92vh,760px)] max-w-5xl"
                : "max-h-[min(92vh,760px)] max-w-[520px]"
            }`}
          >
            <button
              type="button"
              onClick={closeModal}
              className="absolute top-3 right-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/10 text-black hover:bg-black/15"
              aria-label="Close"
            >
              ×
            </button>

            {step === "pick" ? (
              <div className="grid max-h-[min(92vh,760px)] md:grid-cols-[minmax(220px,260px)_1fr_minmax(250px,300px)]">
                <div className="border-b border-black/10 p-5 md:border-r md:border-b-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ececec] text-sm font-semibold text-black/70">
                    {(hostName || "H").slice(0, 1).toUpperCase()}
                  </div>
                  <p className="mt-4 text-sm text-black/55">{hostName || "Event host"}</p>
                  <h3 className="mt-1 text-2xl font-semibold tracking-tight text-black">{eventName}</h3>
                  <div className="mt-5 space-y-2 text-sm text-black/65">
                    <p>{durationMinutes} min</p>
                    <p>{platform}</p>
                    <p>{formatHeaderClock(new Date(), viewerTimeZone)}</p>
                  </div>
                </div>

                <div className="border-b border-black/10 p-5 md:border-r md:border-b-0">
                  <div className="mb-4 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() =>
                        setViewMonth(
                          (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
                        )
                      }
                      className="rounded-md px-2 py-1 text-black/60 hover:bg-black/5"
                    >
                      ‹
                    </button>
                    <p className="text-sm font-semibold text-black">
                      {viewMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setViewMonth(
                          (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
                        )
                      }
                      className="rounded-md px-2 py-1 text-black/60 hover:bg-black/5"
                    >
                      ›
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-black/45">
                    {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day) => (
                      <div key={day} className="py-1">
                        {day}
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 grid grid-cols-7 gap-1">
                    {monthCells.map((cell, index) => {
                      if (!cell.date) {
                        return <div key={`empty-${index}`} className="aspect-square" />;
                      }
                      const isAvailable = availableDates.has(cell.ymd);
                      const isSelected = selectedDateYmd === cell.ymd;
                      return (
                        <button
                          key={cell.ymd}
                          type="button"
                          disabled={!isAvailable}
                          onClick={() => {
                            setSelectedDateYmd(cell.ymd);
                            setSelectedSlotIndex(null);
                          }}
                          className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm transition ${
                            isSelected
                              ? "bg-emerald-600 font-semibold text-white shadow-sm"
                              : isAvailable
                                ? "border border-emerald-300 bg-emerald-50 font-medium text-emerald-800 hover:bg-emerald-100"
                                : "cursor-not-allowed text-black/25"
                          }`}
                        >
                          <span>{cell.date.getDate()}</span>
                          {isSelected ? (
                            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-white" />
                          ) : isAvailable ? (
                            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="p-5 pr-12">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold text-black">
                      {selectedDateYmd
                        ? new Date(`${selectedDateYmd}T12:00:00`).toLocaleDateString("en-GB", {
                            weekday: "short",
                            day: "2-digit",
                          })
                        : "Select a date"}
                    </p>
                    <div className="flex overflow-hidden rounded-md border border-black/10 text-xs">
                      <button
                        type="button"
                        onClick={() => setUse12Hour(true)}
                        className={`px-2 py-1 ${use12Hour ? "bg-black text-white" : "text-black/60"}`}
                      >
                        12h
                      </button>
                      <button
                        type="button"
                        onClick={() => setUse12Hour(false)}
                        className={`px-2 py-1 ${!use12Hour ? "bg-black text-white" : "text-black/60"}`}
                      >
                        24h
                      </button>
                    </div>
                  </div>
                  <div className="max-h-[min(52vh,420px)] space-y-2 overflow-y-auto pr-1">
                    {selectedDaySlots.length === 0 ? (
                      <p className="text-sm text-black/50">No times available for this day.</p>
                    ) : (
                      selectedDaySlots.map((slot) => (
                        <button
                          key={`${slot.slotIndex}-${slot.eventTimeStart}`}
                          type="button"
                          onClick={() => {
                            setSelectedSlotIndex(slot.slotIndex);
                            setStep("register");
                          }}
                          className="flex w-full items-center justify-between rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[#2457d6] transition hover:border-black/20 hover:bg-[#fafafa]"
                        >
                          <span>{formatSlotTime(slot, viewerTimeZone, use12Hour)}</span>
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="max-h-[min(92vh,760px)] overflow-y-auto p-6 pr-14 md:p-8">
                <button
                  type="button"
                  onClick={() => setStep("pick")}
                  className="mb-4 text-sm text-black/55 hover:text-black"
                >
                  ← Back to calendar
                </button>
                <h3 className="text-3xl font-semibold tracking-tight text-black">Your Info</h3>
                {selectedSlot ? (
                  <p className="mt-2 text-sm text-black/60">
                    {formatEventSlotForViewer(
                      selectedSlot.eventDate,
                      selectedSlot.eventTimeStart,
                      selectedSlot.eventTimeEnd,
                      viewerTimeZone
                    )?.titleLine ?? selectedSlot.eventDate}{" "}
                    · {formatSlotTime(selectedSlot, viewerTimeZone, use12Hour)}{" "}
                    {formatEventSlotForViewer(
                      selectedSlot.eventDate,
                      selectedSlot.eventTimeStart,
                      selectedSlot.eventTimeEnd,
                      viewerTimeZone
                    )?.zoneSuffix ?? ""}
                  </p>
                ) : null}

                <form onSubmit={handleSubmit} className="mt-6 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-black/70">Name *</label>
                    <input
                      value={formData.name}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, name: event.target.value }))
                      }
                      required
                      className="mt-1 w-full rounded-md border border-black/10 bg-[#f0f0f0] px-3 py-2 text-sm text-black outline-none focus:border-black/30"
                      placeholder="Your Name"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-black/70">Email *</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, email: event.target.value }))
                      }
                      required
                      className="mt-1 w-full rounded-md border border-black/10 bg-[#f0f0f0] px-3 py-2 text-sm text-black outline-none focus:border-black/30"
                      placeholder="you@email.com"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-black/70">Company Name</label>
                    <input
                      value={formData.companyName}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, companyName: event.target.value }))
                      }
                      className="mt-1 w-full rounded-md border border-black/10 bg-[#f0f0f0] px-3 py-2 text-sm text-black outline-none focus:border-black/30"
                      placeholder="Company"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-black px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <ButtonLoadingContent loading={isSubmitting} loadingText="Registering...">
                      Register
                    </ButtonLoadingContent>
                  </button>
                  {message ? <p className="text-center text-sm text-black/70">{message}</p> : null}
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
