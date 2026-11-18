"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ButtonLoadingContent } from "@/components/button-loader";
import { resolveViewerTimeZone } from "@/lib/use-viewer-time-zone";

type PublicRegisterSheetProps = {
  publicId: string;
  triggerVariant?: "button" | "link";
  calendarSlotIndex?: number;
  calendarOptions?: Array<{ slotIndex: number; label: string }>;
  hideSlotPicker?: boolean;
  waitlistMode?: boolean;
  onRegisterSuccess?: (
    bookedSlotIndex: number,
    serverBookedSlotIndexes?: number[]
  ) => void;
};

export function PublicRegisterSheet({
  publicId,
  triggerVariant = "button",
  calendarSlotIndex = 0,
  calendarOptions = [],
  hideSlotPicker = false,
  waitlistMode = false,
  onRegisterSuccess,
}: PublicRegisterSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSlotDropdownOpen, setIsSlotDropdownOpen] = useState(false);
  const [message, setMessage] = useState("");
  const slotDropdownRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    companyName: "",
    phone: "",
    selectedCalendarSlotIndex: calendarSlotIndex,
  });
  useEffect(() => {
    setFormData((prev) => ({ ...prev, selectedCalendarSlotIndex: calendarSlotIndex }));
  }, [calendarSlotIndex]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!slotDropdownRef.current) return;
      if (!slotDropdownRef.current.contains(event.target as Node)) {
        setIsSlotDropdownOpen(false);
      }
    }
    if (isSlotDropdownOpen) {
      window.addEventListener("mousedown", handleClickOutside);
    }
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [isSlotDropdownOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await fetch(`/api/public-events/${publicId}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          calendarSlotIndex: formData.selectedCalendarSlotIndex,
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

      const bookedSlotIndex = formData.selectedCalendarSlotIndex;
      onRegisterSuccess?.(
        bookedSlotIndex,
        Array.isArray(payload.bookedSlotIndexes) ? payload.bookedSlotIndexes : undefined
      );

      setMessage(
        payload.message ??
          (waitlistMode
            ? "You're on the waitlist. We'll email you when your seat is confirmed."
            : "Registered successfully.")
      );
      setFormData({
        name: "",
        email: "",
        companyName: "",
        phone: "",
        selectedCalendarSlotIndex: calendarSlotIndex,
      });
      setTimeout(() => {
        setIsOpen(false);
        setMessage("");
      }, waitlistMode ? 2200 : 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to register.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {triggerVariant === "link" ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
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
          onClick={() => setIsOpen(true)}
          className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-black text-[15px] font-semibold text-white transition hover:bg-black/90"
        >
          {waitlistMode ? "Join waitlist" : "Register"}
        </button>
      )}

      <div
        className={`fixed inset-0 z-50 transition ${
          isOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
        aria-hidden={!isOpen}
      >
        <div
          className={`absolute inset-0 bg-white transition-opacity duration-300 dark:bg-black ${
            isOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          className={`relative flex h-full w-full items-start justify-center px-5 pt-24 transition-all duration-300 ${
            isOpen ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
          }`}
        >
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-[#7f7f7f] text-sm text-white dark:bg-white/20 dark:text-white"
            aria-label="Close registration form"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="none"
              className="h-4 w-4"
            >
              <path
                d="M5 5L15 15M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="w-full max-w-[480px] p-6">
            <h3 className="mb-4 text-3xl font-semibold tracking-tight text-black dark:text-white">
              Your Info
            </h3>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-black/70 dark:text-white/70">Name *</label>
                <input
                  value={formData.name}
                  onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
                  required
                  className="mt-1 w-full rounded-md border border-black/10 bg-[#f0f0f0] px-3 py-2 text-sm text-black outline-none focus:border-black/30 dark:border-white/20 dark:bg-white/10 dark:text-white dark:placeholder:text-white/45 dark:focus:border-white/45"
                  placeholder="Your Name"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-black/70 dark:text-white/70">Email *</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(event) => setFormData((prev) => ({ ...prev, email: event.target.value }))}
                  required
                  className="mt-1 w-full rounded-md border border-black/10 bg-[#f0f0f0] px-3 py-2 text-sm text-black outline-none focus:border-black/30 dark:border-white/20 dark:bg-white/10 dark:text-white dark:placeholder:text-white/45 dark:focus:border-white/45"
                  placeholder="you@email.com"
                />
              </div>
              {!hideSlotPicker ? (
              <div>
                <label className="text-xs font-medium text-black/70 dark:text-white/70">
                  Select calendar invite
                </label>
                <div className="relative mt-1" ref={slotDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsSlotDropdownOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between rounded-md border border-black/10 bg-[#f0f0f0] px-3 py-2 text-left text-sm text-black outline-none transition hover:bg-[#ececea] focus-visible:border-black/30 dark:border-white/20 dark:bg-white/10 dark:text-white"
                  >
                    <span className="block min-w-0 flex-1 truncate whitespace-nowrap">
                      {(calendarOptions.find(
                        (option) => option.slotIndex === formData.selectedCalendarSlotIndex
                      )?.label ??
                        calendarOptions[0]?.label ??
                        "Slot 1")}
                    </span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="none"
                      className={`h-4 w-4 shrink-0 text-black/55 transition-transform dark:text-white/60 ${
                        isSlotDropdownOpen ? "rotate-180" : ""
                      }`}
                      aria-hidden="true"
                    >
                      <path
                        d="M5 7.5L10 12.5L15 7.5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  {isSlotDropdownOpen ? (
                    <div
                      className={`absolute top-full z-30 mt-1 w-full rounded-md border border-black/10 bg-white p-1 shadow-lg dark:border-white/20 dark:bg-[#151515] ${
                        (calendarOptions.length > 0 ? calendarOptions.length : 1) > 5
                          ? "max-h-[min(18rem,calc(100vh-12rem))] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
                          : ""
                      }`}
                    >
                      {(calendarOptions.length > 0
                        ? calendarOptions
                        : [{ slotIndex: calendarSlotIndex, label: "Slot 1" }]
                      ).map((option) => (
                        <button
                          key={`slot-item-${option.slotIndex}`}
                          type="button"
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              selectedCalendarSlotIndex: option.slotIndex,
                            }));
                            setIsSlotDropdownOpen(false);
                          }}
                          className={`block w-full rounded px-2 py-2 text-left text-sm transition ${
                            formData.selectedCalendarSlotIndex === option.slotIndex
                              ? "bg-black text-white"
                              : "text-black hover:bg-black/5 dark:text-white dark:hover:bg-white/10"
                          }`}
                        >
                          <span className="block truncate whitespace-nowrap">{option.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              ) : null}
              <div>
                <label className="text-xs font-medium text-black/70 dark:text-white/70">
                  Company Name{waitlistMode ? " *" : ""}
                </label>
                <input
                  value={formData.companyName}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, companyName: event.target.value }))
                  }
                  required={waitlistMode}
                  className="mt-1 w-full rounded-md border border-black/10 bg-[#f0f0f0] px-3 py-2 text-sm text-black outline-none focus:border-black/30 dark:border-white/20 dark:bg-white/10 dark:text-white dark:placeholder:text-white/45 dark:focus:border-white/45"
                  placeholder="Company"
                />
              </div>
              {waitlistMode ? (
                <div>
                  <label className="text-xs font-medium text-black/70 dark:text-white/70">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, phone: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-black/10 bg-[#f0f0f0] px-3 py-2 text-sm text-black outline-none focus:border-black/30 dark:border-white/20 dark:bg-white/10 dark:text-white dark:placeholder:text-white/45 dark:focus:border-white/45"
                    placeholder="+91 98765 43210"
                  />
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-black px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black"
              >
                <ButtonLoadingContent
                  loading={isSubmitting}
                  loadingText={waitlistMode ? "Joining..." : "Registering..."}
                >
                  {waitlistMode ? "Join waitlist" : "Register"}
                </ButtonLoadingContent>
              </button>

              {message ? (
                <p className="text-center text-sm text-black/70 dark:text-white/75">{message}</p>
              ) : null}
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
