"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ButtonLoadingContent } from "@/components/button-loader";
import {
  CsvImportMappingPanel,
  createInitialCsvMapping,
} from "@/components/csv-import-mapping-panel";
import { InviteCustomMessageEditor } from "@/components/invite-custom-message-editor";
import {
  InviteScheduleFields,
  getDefaultInviteScheduleFields,
  type InviteDeliveryMode,
} from "@/components/invite-schedule-fields";
import {
  SubmissionsCalendarCardsSkeleton,
  SubmissionsTableSkeleton,
} from "@/components/skeleton";
import {
  buildSubmissionsExportCsv,
  downloadCsvFile,
  mapCsvToRegistrants,
  parseCsvFile,
  type CsvColumnMapping,
  type ParsedCsvFile,
} from "@/lib/csv-registrants";
import {
  type EventFormat,
  eventFormatLabel,
  isSharedSessionFormat,
  isWaitlistedWebinarFormat,
  isWebinarFormat,
} from "@/lib/event-format";
import { toWallDateYmd } from "@/lib/public-event-time";
import { readApiJson } from "@/lib/read-api-json";
import { formatScheduledInviteDateTime } from "@/lib/scheduled-invite-time";
import {
  WAITLISTED_SUBMISSION_TABS,
  WEBINAR_SUBMISSION_TABS,
  getWaitlistedSubmissionStage,
  getWebinarSubmissionStage,
  type WaitlistStatus,
  type WaitlistedSubmissionStage,
  type WebinarSubmissionStage,
} from "@/lib/webinar-submission-stage";

type SubmissionItem = {
  id: string;
  name: string;
  email: string;
  companyName: string;
  phone: string;
  calendarSlotIndex: number;
  calendarEventDate: string;
  calendarEventTimeStart: string;
  calendarEventTimeEnd: string;
  calendarPlatform: string;
  createdAt: string;
  inviteSentAt: string | null;
  inviteAcceptedAt: string | null;
  source: "csv" | "registration" | null;
  waitlistStatus: WaitlistStatus | null;
  waitlistConfirmedAt: string | null;
  waitlistRejectedAt: string | null;
  remindersEnabled: boolean;
  reminderDayEnabled: boolean;
  reminderHourEnabled: boolean;
};

type EventCalendarItem = {
  slotIndex: number;
  eventDate: string;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: string;
};

type EventSubmissionsBoardProps = {
  eventId: string;
  eventName: string;
  eventFormat: EventFormat;
};

export function EventSubmissionsBoard({
  eventId,
  eventName,
  eventFormat: initialEventFormat,
}: EventSubmissionsBoardProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [activeEventFormat, setActiveEventFormat] = useState<EventFormat>(initialEventFormat);
  const [isUploadingCsv, setIsUploadingCsv] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [csvUploadIsWarning, setCsvUploadIsWarning] = useState(false);
  const [pendingCsvImport, setPendingCsvImport] = useState<{
    fileName: string;
    parsed: ParsedCsvFile;
    mapping: CsvColumnMapping;
  } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [calendarItems, setCalendarItems] = useState<EventCalendarItem[]>([]);
  const [expiredCalendarItems, setExpiredCalendarItems] = useState<EventCalendarItem[]>([]);
  const [activeCalendarTab, setActiveCalendarTab] = useState(0);
  const [isCalendarSelectionView, setIsCalendarSelectionView] = useState(true);
  const [isExpiredCalendarView, setIsExpiredCalendarView] = useState(false);
  const [sendingInviteId, setSendingInviteId] = useState<string | null>(null);
  const [deletingSubmissionId, setDeletingSubmissionId] = useState<string | null>(null);
  const [isDeletingAllInvites, setIsDeletingAllInvites] = useState(false);
  const [isSchedulingReminders, setIsSchedulingReminders] = useState(false);
  const [isReminderSettingsView, setIsReminderSettingsView] = useState(false);
  const [reminderDayEnabled, setReminderDayEnabled] = useState(true);
  const [reminderHourEnabled, setReminderHourEnabled] = useState(true);
  const [pendingInviteId, setPendingInviteId] = useState<string | null>(null);
  const [pendingBulkInviteTab, setPendingBulkInviteTab] = useState<
    "invite_to" | "invited" | null
  >(null);
  const [pendingInviteMessage, setPendingInviteMessage] = useState("");
  const defaultInviteSchedule = getDefaultInviteScheduleFields();
  const [pendingInviteDeliveryMode, setPendingInviteDeliveryMode] =
    useState<InviteDeliveryMode>("now");
  const [pendingInviteScheduledDate, setPendingInviteScheduledDate] = useState(
    defaultInviteSchedule.date
  );
  const [pendingInviteScheduledTime, setPendingInviteScheduledTime] = useState(
    defaultInviteSchedule.time
  );
  const [isSchedulingInvites, setIsSchedulingInvites] = useState(false);
  const [isSendingBulkInvites, setIsSendingBulkInvites] = useState(false);
  const [activeExpiredSignature, setActiveExpiredSignature] = useState("");
  const [webinarSubmissionTab, setWebinarSubmissionTab] =
    useState<WebinarSubmissionStage>("invite_to");
  const [waitlistedSubmissionTab, setWaitlistedSubmissionTab] =
    useState<WaitlistedSubmissionStage>("invite_to");
  const [confirmingSubmissionId, setConfirmingSubmissionId] = useState<string | null>(null);
  const [rejectingSubmissionId, setRejectingSubmissionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nowTs, setNowTs] = useState(() => Date.now());

  const normalizeTime = (value?: string) => String(value ?? "").trim().slice(0, 5);
  const normalizePlatform = (value?: string) => String(value ?? "").trim().toLowerCase();
  const slotSignature = (slot: {
    eventDate?: string;
    eventTimeStart?: string;
    eventTimeEnd?: string;
    platform?: string;
  }) =>
    `${toWallDateYmd(slot.eventDate)}::${normalizeTime(slot.eventTimeStart)}::${normalizeTime(
      slot.eventTimeEnd
    )}::${normalizePlatform(slot.platform)}`;
  const slotSignatureNoPlatform = (slot: {
    eventDate?: string;
    eventTimeStart?: string;
    eventTimeEnd?: string;
  }) =>
    `${toWallDateYmd(slot.eventDate)}::${normalizeTime(slot.eventTimeStart)}::${normalizeTime(
      slot.eventTimeEnd
    )}`;

  const loadSubmissionsForEvent = useCallback(
    async (targetEventId: string) => {
      const response = await fetch(`/api/events/${targetEventId}/submissions`);
      const payload = (await response.json()) as {
        submissions?: SubmissionItem[];
        calendars?: EventCalendarItem[];
        expiredCalendars?: EventCalendarItem[];
        eventFormat?: EventFormat;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "Could not fetch submissions.");
      }

      const format = payload.eventFormat ?? initialEventFormat;
      const calendars = payload.calendars ?? [];
      setActiveEventFormat(format);
      setSubmissions(payload.submissions ?? []);
      setCalendarItems(calendars);
      setExpiredCalendarItems(payload.expiredCalendars ?? []);
      return { format, calendarCount: calendars.length };
    },
    [initialEventFormat]
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTs(Date.now());
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      setIsLoading(true);
      setError("");
      setNotice("");
      setUploadMessage("");
      setActiveEventFormat(initialEventFormat);
      setIsCalendarSelectionView(!isSharedSessionFormat(initialEventFormat));
      setSubmissions([]);
      setCalendarItems([]);
      setExpiredCalendarItems([]);

      try {
        const { format, calendarCount } = await loadSubmissionsForEvent(eventId);
        if (cancelled) {
          return;
        }
        setActiveCalendarTab(0);
        setWebinarSubmissionTab("invite_to");
        setWaitlistedSubmissionTab("invite_to");
        const showCalendarPicker = !isSharedSessionFormat(format) && calendarCount > 1;
        setIsCalendarSelectionView(showCalendarPicker);
        setIsExpiredCalendarView(false);
        setIsReminderSettingsView(false);
      } catch (fetchError) {
        if (!cancelled) {
          setError(
            fetchError instanceof Error ? fetchError.message : "Could not fetch submissions."
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [eventId, initialEventFormat, loadSubmissionsForEvent]);

  useEffect(() => {
    if (isCalendarSelectionView || isReminderSettingsView || isExpiredCalendarView) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadSubmissionsForEvent(eventId).catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [
    eventId,
    isCalendarSelectionView,
    isReminderSettingsView,
    isExpiredCalendarView,
    loadSubmissionsForEvent,
  ]);

  function goBack() {
    router.push("/portal/marketing/events");
  }

  async function handleCsvFileSelected(file: File) {
    setError("");
    setUploadMessage("");
    setCsvUploadIsWarning(false);
    try {
      const text = await file.text();
      const parsed = parseCsvFile(text);
      if (parsed.rows.length === 0) {
        throw new Error("CSV file has no data rows.");
      }
      setPendingCsvImport({
        fileName: file.name,
        parsed,
        mapping: createInitialCsvMapping(parsed),
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to read CSV.");
    } finally {
      if (csvInputRef.current) {
        csvInputRef.current.value = "";
      }
    }
  }

  function cancelCsvImport() {
    setPendingCsvImport(null);
  }

  async function importMappedCsv() {
    if (!pendingCsvImport) {
      return;
    }
    setIsUploadingCsv(true);
    setError("");
    setUploadMessage("");
    setCsvUploadIsWarning(false);
    try {
      const rows = mapCsvToRegistrants(pendingCsvImport.parsed.rows, pendingCsvImport.mapping);
      if (rows.length === 0) {
        throw new Error("No valid rows found. Map Name and Email columns.");
      }
      const response = await fetch(`/api/events/${eventId}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIndex: 0, rows }),
      });
      const payload = (await response.json()) as {
        message?: string;
        insertedCount?: number;
        skippedDuplicateCount?: number;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to upload CSV.");
      }
      await loadSubmissionsForEvent(eventId);
      setWebinarSubmissionTab("invite_to");
      setWaitlistedSubmissionTab("invite_to");
      setIsCalendarSelectionView(false);
      setPendingCsvImport(null);
      if ((payload.insertedCount ?? 0) === 0 && (payload.skippedDuplicateCount ?? 0) > 0) {
        setCsvUploadIsWarning(true);
        setUploadMessage(payload.message ?? "Contacts already exist in this event.");
      } else {
        setCsvUploadIsWarning(false);
        setUploadMessage(
          payload.insertedCount
            ? `Imported ${payload.insertedCount} contact${payload.insertedCount === 1 ? "" : "s"}.`
            : (payload.message ?? "Import complete.")
        );
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to import CSV.");
    } finally {
      setIsUploadingCsv(false);
    }
  }

  function renderCsvUploadSection() {
    return (
      <div className="mb-4 rounded-xl border border-black/10 bg-[#fafaf8] p-4">
        <p className="text-sm font-medium text-black">Upload contacts (CSV)</p>
        <p className="mt-1 text-xs text-black/55">
          Choose a CSV file, map columns to Name, Email, and Company Name, then import. Contacts
          appear in Invite to until you send them an invite.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleCsvFileSelected(file);
              }
            }}
          />
          <button
            type="button"
            disabled={isUploadingCsv}
            onClick={() => csvInputRef.current?.click()}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-black px-4 text-xs font-medium text-white hover:bg-black/90 disabled:opacity-60"
          >
            <ButtonLoadingContent loading={isUploadingCsv} loadingText="Importing...">
              Choose CSV file
            </ButtonLoadingContent>
          </button>
        </div>
        {pendingCsvImport ? (
          <CsvImportMappingPanel
            fileName={pendingCsvImport.fileName}
            parsed={pendingCsvImport.parsed}
            mapping={pendingCsvImport.mapping}
            isImporting={isUploadingCsv}
            onMappingChange={(mapping) =>
              setPendingCsvImport((prev) => (prev ? { ...prev, mapping } : null))
            }
            onCancel={cancelCsvImport}
            onImport={() => void importMappedCsv()}
          />
        ) : null}
        {uploadMessage ? (
          <p
            className={`mt-2 text-xs ${csvUploadIsWarning ? "text-amber-800" : "text-emerald-700"}`}
          >
            {uploadMessage}
          </p>
        ) : null}
      </div>
    );
  }

  function formatInviteSentAt(value: string | null) {
    if (!value) {
      return "";
    }
    const sentAt = new Date(value);
    if (Number.isNaN(sentAt.getTime())) {
      return "just now";
    }
    const diffMs = nowTs - sentAt.getTime();
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diffMs < minute) {
      return "just now";
    }
    if (diffMs < hour) {
      const minutes = Math.floor(diffMs / minute);
      return `${minutes} min${minutes > 1 ? "s" : ""} ago`;
    }
    if (diffMs < day) {
      const hours = Math.floor(diffMs / hour);
      return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    }
    const days = Math.floor(diffMs / day);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  }

  function resetInviteScheduleFields() {
    const defaults = getDefaultInviteScheduleFields();
    setPendingInviteDeliveryMode("now");
    setPendingInviteScheduledDate(defaults.date);
    setPendingInviteScheduledTime(defaults.time);
  }

  function openInviteComposer(submissionId: string) {
    setPendingInviteId(submissionId);
    setPendingBulkInviteTab(null);
    setPendingInviteMessage("");
    resetInviteScheduleFields();
    setNotice("");
    setError("");
  }

  function openBulkInviteComposer(tab: "invite_to" | "invited") {
    setPendingBulkInviteTab(tab);
    setPendingInviteId(null);
    setPendingInviteMessage("");
    resetInviteScheduleFields();
    setNotice("");
    setError("");
  }

  function cancelInviteComposer() {
    setPendingInviteId(null);
    setPendingBulkInviteTab(null);
    setPendingInviteMessage("");
    resetInviteScheduleFields();
  }

  async function scheduleInvites(input: {
    tab?: "invite_to" | "invited";
    submissionIds?: string[];
    customMessage: string;
    useEventBanner: boolean;
  }) {
    setIsSchedulingInvites(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/events/${eventId}/submissions/schedule-invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tab: input.tab,
          submissionIds: input.submissionIds,
          scheduledDate: pendingInviteScheduledDate,
          scheduledTime: pendingInviteScheduledTime,
          customMessage: input.customMessage,
          useEventBanner: input.useEventBanner,
        }),
      });
      const payload = await readApiJson<{
        message?: string;
        scheduledAt?: string;
        submissionCount?: number;
      }>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to schedule invites.");
      }

      const when = payload.scheduledAt
        ? formatScheduledInviteDateTime(payload.scheduledAt)
        : "the selected time";
      setNotice(
        payload.message ??
          `Invites scheduled for ${payload.submissionCount ?? 0} contact(s) on ${when} IST.`
      );
      cancelInviteComposer();
    } catch (scheduleError) {
      setError(
        scheduleError instanceof Error ? scheduleError.message : "Failed to schedule invites."
      );
    } finally {
      setIsSchedulingInvites(false);
    }
  }

  async function sendInvite(
    submissionId: string,
    customMessage: string,
    useEventBanner: boolean
  ) {
    setSendingInviteId(submissionId);
    setError("");
    try {
      const response = await fetch(`/api/events/${eventId}/submissions/${submissionId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customMessage, useEventBanner }),
      });
      const payload = await readApiJson<{ message?: string; inviteSentAt?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to send invite.");
      }

      setSubmissions((prev) =>
        prev.map((submission) =>
          submission.id === submissionId
            ? {
                ...submission,
                inviteSentAt: payload.inviteSentAt ?? new Date().toISOString(),
              }
            : submission
        )
      );
      if (
        (isWebinarFormat(activeEventFormat) && webinarSubmissionTab === "invite_to") ||
        (isWaitlistedWebinarFormat(activeEventFormat) && waitlistedSubmissionTab === "invite_to")
      ) {
        if (isWaitlistedWebinarFormat(activeEventFormat)) {
          setWaitlistedSubmissionTab("invited");
        } else {
          setWebinarSubmissionTab("invited");
        }
      }
      cancelInviteComposer();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Failed to send invite.");
    } finally {
      setSendingInviteId(null);
    }
  }

  async function sendBulkInvites(customMessage: string, useEventBanner: boolean) {
    if (!pendingBulkInviteTab) {
      return;
    }

    const targets = submissions.filter((submission) =>
      isWaitlistedWebinarFormat(activeEventFormat)
        ? getWaitlistedSubmissionStage(submission) === pendingBulkInviteTab
        : getWebinarSubmissionStage(submission) === pendingBulkInviteTab
    );
    if (targets.length === 0) {
      cancelInviteComposer();
      return;
    }

    setIsSendingBulkInvites(true);
    setError("");
    let successCount = 0;
    let failCount = 0;

    for (const submission of targets) {
      try {
        const response = await fetch(
          `/api/events/${eventId}/submissions/${submission.id}/invite`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customMessage, useEventBanner }),
          }
        );
        const payload = await readApiJson<{ message?: string; inviteSentAt?: string }>(response);
        if (!response.ok) {
          throw new Error(payload.message ?? "Failed to send invite.");
        }

        successCount += 1;
        setSubmissions((prev) =>
          prev.map((item) =>
            item.id === submission.id
              ? {
                  ...item,
                  inviteSentAt: payload.inviteSentAt ?? new Date().toISOString(),
                }
              : item
          )
        );
      } catch {
        failCount += 1;
      }
    }

    if (pendingBulkInviteTab === "invite_to" && successCount > 0) {
      if (isWaitlistedWebinarFormat(activeEventFormat)) {
        setWaitlistedSubmissionTab("invited");
      } else {
        setWebinarSubmissionTab("invited");
      }
    }

    if (failCount > 0) {
      setError(`Sent ${successCount} invite${successCount === 1 ? "" : "s"}, ${failCount} failed.`);
    }

    cancelInviteComposer();
    setIsSendingBulkInvites(false);
  }

  async function removeSubmission(submissionId: string) {
    setDeletingSubmissionId(submissionId);
    setError("");
    try {
      const response = await fetch(`/api/events/${eventId}/submissions/${submissionId}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to remove submission.");
      }
      setSubmissions((prev) => prev.filter((item) => item.id !== submissionId));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to remove submission.");
    } finally {
      setDeletingSubmissionId(null);
    }
  }

  async function deleteAllInviteTabContacts() {
    const tab = isActiveWaitlisted ? waitlistedSubmissionTab : webinarSubmissionTab;
    if (tab !== "invite_to" && tab !== "invited") {
      return;
    }
    const targets = tableSubmissions;
    if (targets.length === 0) {
      return;
    }

    const label = tab === "invite_to" ? "Invite to" : "Invited";
    const confirmed = window.confirm(
      `Delete all ${targets.length} contact${targets.length === 1 ? "" : "s"} from ${label}? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    setIsDeletingAllInvites(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/events/${eventId}/submissions/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionIds: targets.map((item) => item.id),
        }),
      });
      const payload = (await response.json()) as { message?: string; deletedCount?: number };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to remove contacts.");
      }

      const deletedIds = new Set(targets.map((item) => item.id));
      setSubmissions((prev) => prev.filter((item) => !deletedIds.has(item.id)));
      setNotice(
        payload.message ??
          `Removed ${payload.deletedCount ?? targets.length} contact${
            (payload.deletedCount ?? targets.length) === 1 ? "" : "s"
          }.`
      );
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to remove contacts.");
    } finally {
      setIsDeletingAllInvites(false);
    }
  }

  async function confirmWaitlistSeat(submissionId: string) {
    setConfirmingSubmissionId(submissionId);
    setError("");
    try {
      const response = await fetch(`/api/events/${eventId}/submissions/${submissionId}/confirm`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        message?: string;
        waitlistConfirmedAt?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to confirm seat.");
      }
      setSubmissions((prev) =>
        prev.map((item) =>
          item.id === submissionId
            ? {
                ...item,
                waitlistStatus: "confirmed",
                waitlistConfirmedAt: payload.waitlistConfirmedAt ?? new Date().toISOString(),
                waitlistRejectedAt: null,
              }
            : item
        )
      );
      setWaitlistedSubmissionTab("going");
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Failed to confirm seat.");
    } finally {
      setConfirmingSubmissionId(null);
    }
  }

  async function rejectWaitlistSeat(submissionId: string) {
    setRejectingSubmissionId(submissionId);
    setError("");
    try {
      const response = await fetch(`/api/events/${eventId}/submissions/${submissionId}/reject`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        message?: string;
        waitlistRejectedAt?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to reject registrant.");
      }
      setSubmissions((prev) =>
        prev.map((item) =>
          item.id === submissionId
            ? {
                ...item,
                waitlistStatus: "rejected",
                waitlistRejectedAt: payload.waitlistRejectedAt ?? new Date().toISOString(),
                waitlistConfirmedAt: null,
                inviteAcceptedAt: null,
              }
            : item
        )
      );
      setWaitlistedSubmissionTab("rejected");
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "Failed to reject registrant.");
    } finally {
      setRejectingSubmissionId(null);
    }
  }

  async function scheduleReminders() {
    const isWebinar = isSharedSessionFormat(activeEventFormat);
    setIsSchedulingReminders(true);
    setError("");
    try {
      const response = await fetch(`/api/events/${eventId}/submissions/schedule-reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayEnabled: reminderDayEnabled,
          hourEnabled: reminderHourEnabled,
          slotIndex: isWebinar ? 0 : activeCalendarTab,
        }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to schedule reminders.");
      }
      setSubmissions((prev) =>
        prev.map((submission) => {
          const matchesTab = isWebinar
            ? true
            : (submission.calendarSlotIndex ?? 0) === activeCalendarTab;
          if (!matchesTab) {
            return submission;
          }
          return {
            ...submission,
            remindersEnabled: reminderDayEnabled || reminderHourEnabled,
            reminderDayEnabled,
            reminderHourEnabled,
          };
        })
      );
    } catch (scheduleError) {
      setError(
        scheduleError instanceof Error ? scheduleError.message : "Failed to schedule reminders."
      );
    } finally {
      setIsSchedulingReminders(false);
    }
  }

  function openReminderSettingsView() {
    const pool = isSharedSessionFormat(activeEventFormat)
      ? isWaitlistedWebinarFormat(activeEventFormat)
        ? submissions.filter((s) => getWaitlistedSubmissionStage(s) === "going")
        : submissions
      : submissions.filter((s) => (s.calendarSlotIndex ?? 0) === activeCalendarTab);
    const withReminders = pool.find((s) => s.remindersEnabled);
    const base = withReminders ?? pool[0];
    setReminderDayEnabled(base?.reminderDayEnabled ?? true);
    setReminderHourEnabled(base?.reminderHourEnabled ?? true);
    setIsExpiredCalendarView(false);
    setIsReminderSettingsView(true);
  }

  function openCalendarSubmissions(slotIndex: number) {
    setActiveCalendarTab(slotIndex);
    setIsCalendarSelectionView(false);
    setIsExpiredCalendarView(false);
    setActiveExpiredSignature("");
    setIsReminderSettingsView(false);
  }

  const selectedCalendar = calendarItems.find((item) => item.slotIndex === activeCalendarTab);
  const selectedSignature = selectedCalendar ? slotSignature(selectedCalendar) : "";
  const hasExpiredSelection = activeExpiredSignature.trim().length > 0;

  const filteredSubmissions = isSharedSessionFormat(activeEventFormat)
    ? submissions
    : submissions.filter((submission) => {
        const submissionSignature = slotSignature({
          eventDate: submission.calendarEventDate,
          eventTimeStart: submission.calendarEventTimeStart,
          eventTimeEnd: submission.calendarEventTimeEnd,
          platform: submission.calendarPlatform,
        });
        const submissionNoPlatform = slotSignatureNoPlatform({
          eventDate: submission.calendarEventDate,
          eventTimeStart: submission.calendarEventTimeStart,
          eventTimeEnd: submission.calendarEventTimeEnd,
        });
        if (hasExpiredSelection) {
          const selectedNoPlatform = activeExpiredSignature.split("::").slice(0, 3).join("::");
          return (
            submissionSignature === activeExpiredSignature ||
            submissionNoPlatform === selectedNoPlatform
          );
        }
        const bySignature = selectedSignature && submissionSignature === selectedSignature;
        const byNoPlatform =
          selectedSignature &&
          submissionNoPlatform === selectedSignature.split("::").slice(0, 3).join("::");
        if (bySignature || byNoPlatform) {
          return true;
        }
        if (!selectedSignature) {
          return (submission.calendarSlotIndex ?? 0) === activeCalendarTab;
        }
        return false;
      });
  const isActiveWebinar = isWebinarFormat(activeEventFormat);
  const isActiveWaitlisted = isWaitlistedWebinarFormat(activeEventFormat);
  const isActiveSharedSession = isSharedSessionFormat(activeEventFormat);
  const webinarStageCounts = WEBINAR_SUBMISSION_TABS.reduce(
    (counts, tab) => {
      counts[tab.id] = submissions.filter(
        (submission) => getWebinarSubmissionStage(submission) === tab.id
      ).length;
      return counts;
    },
    { invite_to: 0, invited: 0, going: 0 } as Record<WebinarSubmissionStage, number>
  );
  const waitlistedStageCounts = WAITLISTED_SUBMISSION_TABS.reduce(
    (counts, tab) => {
      counts[tab.id] = submissions.filter(
        (submission) => getWaitlistedSubmissionStage(submission) === tab.id
      ).length;
      return counts;
    },
    { waitlist: 0, going: 0, rejected: 0, invite_to: 0, invited: 0 } as Record<
      WaitlistedSubmissionStage,
      number
    >
  );
  const webinarTabSubmissions = isActiveWebinar
    ? submissions.filter(
        (submission) => getWebinarSubmissionStage(submission) === webinarSubmissionTab
      )
    : [];
  const waitlistedTabSubmissions = isActiveWaitlisted
    ? submissions.filter(
        (submission) => getWaitlistedSubmissionStage(submission) === waitlistedSubmissionTab
      )
    : [];
  const tableSubmissions = isActiveWebinar
    ? webinarTabSubmissions
    : isActiveWaitlisted
      ? waitlistedTabSubmissions
      : filteredSubmissions;
  const pendingInviteSubmission = pendingInviteId
    ? submissions.find((submission) => submission.id === pendingInviteId)
    : null;
  const pendingBulkInviteTargets = pendingBulkInviteTab
    ? submissions.filter((submission) =>
        isActiveWaitlisted
          ? getWaitlistedSubmissionStage(submission) === pendingBulkInviteTab
          : getWebinarSubmissionStage(submission) === pendingBulkInviteTab
      )
    : [];

  function exportSubmissionsCsv() {
    const exportSource = isActiveSharedSession ? submissions : tableSubmissions;
    const statusOrder: Record<string, number> = {
      Going: 0,
      Waitlist: 1,
      Rejected: 2,
      Invited: 1,
      "Invite to": 2,
    };

    const rows = exportSource
      .map((submission) => {
        const stage = isActiveWaitlisted
          ? getWaitlistedSubmissionStage(submission)
          : isActiveWebinar
            ? getWebinarSubmissionStage(submission)
            : null;
        const stageLabel = isActiveWaitlisted
          ? (WAITLISTED_SUBMISSION_TABS.find((tab) => tab.id === stage)?.label ?? stage ?? "")
          : isActiveWebinar
            ? (WEBINAR_SUBMISSION_TABS.find((tab) => tab.id === stage)?.label ?? stage ?? "")
            : "";
        return {
          name: submission.name,
          email: submission.email,
          companyName: submission.companyName,
          status: stageLabel,
          inviteSentAt: submission.inviteSentAt
            ? new Date(submission.inviteSentAt).toLocaleString("en-GB")
            : "",
        };
      })
      .sort((a, b) => {
        if (!isActiveSharedSession) {
          return 0;
        }
        return (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
      });

    const csv = buildSubmissionsExportCsv(rows, {
      includeStatus: isActiveSharedSession,
      includeInviteSentAt: isActiveSharedSession,
    });

    const safeName = eventName
      .trim()
      .toLowerCase()
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const filename = isActiveSharedSession
      ? `${safeName || "event"}-all-submissions.csv`
      : `${safeName || "event"}-submissions.csv`;
    downloadCsvFile(filename, csv);
  }

  const submissionTableGridClass =
    isActiveWaitlisted && waitlistedSubmissionTab === "waitlist"
      ? "grid grid-cols-[minmax(140px,1.3fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(220px,auto)_28px] gap-x-4"
      : isActiveSharedSession &&
          ((isActiveWebinar && webinarSubmissionTab === "going") ||
            (isActiveWaitlisted &&
              (waitlistedSubmissionTab === "going" || waitlistedSubmissionTab === "rejected")))
        ? "grid grid-cols-[minmax(140px,1.3fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(92px,auto)_28px] gap-x-4"
        : (isActiveWebinar && webinarSubmissionTab === "invited") ||
            (isActiveWaitlisted && waitlistedSubmissionTab === "invited")
          ? "grid grid-cols-[minmax(140px,1.3fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(220px,auto)_28px] gap-x-4"
          : "grid grid-cols-[minmax(140px,1.3fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(168px,auto)_28px] gap-x-4";

  return (
    <section className="rounded-3xl border border-black/10 bg-white p-7 shadow-[0_25px_80px_-60px_rgba(0,0,0,0.55)]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/portal/marketing/events"
            onClick={(event) => {
              event.preventDefault();
              goBack();
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-black/55 transition hover:text-black"
          >
            <span aria-hidden>←</span>
            <span>All events</span>
          </Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-black">
            {eventName}{" "}
            <span className="font-normal text-black/55">Submissions</span>
          </h1>
          <span className="mt-2 inline-flex rounded-full border border-black/10 bg-[#fafaf8] px-3 py-1 text-xs font-medium text-black/60">
            {eventFormatLabel(activeEventFormat)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isReminderSettingsView ? (
            <>
              {!isCalendarSelectionView && !isActiveSharedSession ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsReminderSettingsView(false);
                    setActiveExpiredSignature("");
                    setIsExpiredCalendarView(false);
                    setIsCalendarSelectionView(true);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/20 bg-white text-black/70 transition hover:bg-black/5"
                  aria-label="Back to calendars"
                  title="Back to calendars"
                >
                  <span aria-hidden>←</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={openReminderSettingsView}
                disabled={filteredSubmissions.length === 0 || isCalendarSelectionView}
                className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition ${
                  (isActiveSharedSession ? submissions : filteredSubmissions).some(
                    (item) => item.remindersEnabled
                  )
                    ? "border-black/25 bg-white text-black/75 hover:bg-black/5"
                    : "border-black/20 bg-white text-black/70 hover:bg-black/5"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <span className="whitespace-nowrap">Reminder Settings</span>
              </button>
              {!isCalendarSelectionView && !isReminderSettingsView && !isExpiredCalendarView ? (
                <button
                  type="button"
                  onClick={exportSubmissionsCsv}
                  disabled={(isActiveSharedSession ? submissions : tableSubmissions).length === 0}
                  className="inline-flex h-8 items-center rounded-full border border-black/20 bg-white px-3 text-xs font-medium text-black/70 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Export CSV
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {notice ? <p className="mb-3 text-sm text-emerald-700">{notice}</p> : null}
      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      {isLoading && isCalendarSelectionView ? (
        <SubmissionsCalendarCardsSkeleton />
      ) : isLoading ? (
        <SubmissionsTableSkeleton
          showCsvSection={
            isActiveWebinar || (isActiveWaitlisted && waitlistedSubmissionTab === "invite_to")
          }
        />
      ) : isCalendarSelectionView ? (
        <div>
          {calendarItems.length === 0 ? (
            <p className="text-sm text-black/55">No booked slots yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {calendarItems.map((calendar) => (
                <button
                  key={`calendar-card-${calendar.slotIndex}`}
                  type="button"
                  onClick={() => openCalendarSubmissions(calendar.slotIndex)}
                  className="rounded-xl border border-black/12 bg-[#fafaf8] p-4 text-left transition hover:border-black/25 hover:bg-[#f6f6f4]"
                >
                  <p className="text-sm font-semibold text-black">
                    {isActiveSharedSession ? "Webinar session" : "Booked slot"}
                  </p>
                  <p className="mt-2 text-sm text-black/75">
                    {calendar.eventDate} • {calendar.eventTimeStart} - {calendar.eventTimeEnd}
                  </p>
                  <p className="mt-1 text-xs text-black/55">{calendar.platform}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : isExpiredCalendarView ? (
        <div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {expiredCalendarItems.map((calendar) => {
              const expiredSignature = slotSignature(calendar);
              const hasBookedSubmissions = submissions.some((submission) => {
                const full = slotSignature({
                  eventDate: submission.calendarEventDate,
                  eventTimeStart: submission.calendarEventTimeStart,
                  eventTimeEnd: submission.calendarEventTimeEnd,
                  platform: submission.calendarPlatform,
                });
                if (full === expiredSignature) {
                  return true;
                }
                return (
                  slotSignatureNoPlatform({
                    eventDate: submission.calendarEventDate,
                    eventTimeStart: submission.calendarEventTimeStart,
                    eventTimeEnd: submission.calendarEventTimeEnd,
                  }) === expiredSignature.split("::").slice(0, 3).join("::")
                );
              });
              return (
                <button
                  key={`expired-calendar-card-${calendar.slotIndex}-${calendar.eventDate}-${calendar.eventTimeStart}`}
                  type="button"
                  onClick={() => {
                    setActiveExpiredSignature(expiredSignature);
                    setIsExpiredCalendarView(false);
                    setIsCalendarSelectionView(false);
                    setIsReminderSettingsView(false);
                  }}
                  className={`rounded-xl border p-4 text-left transition ${
                    hasBookedSubmissions
                      ? "border-red-300 bg-red-50/80 hover:border-red-400 hover:bg-red-50"
                      : "border-amber-300 bg-amber-50/80 hover:border-amber-400 hover:bg-amber-50"
                  }`}
                >
                  <p className="text-sm font-semibold text-black">
                    Expired Slot {hasBookedSubmissions ? "• Booked" : "• Not booked"}
                  </p>
                  <p className="mt-2 text-sm text-black/75">
                    {calendar.eventDate} • {calendar.eventTimeStart} - {calendar.eventTimeEnd}
                  </p>
                  <p className="mt-1 text-xs text-black/55">{calendar.platform}</p>
                </button>
              );
            })}
            {expiredCalendarItems.length === 0 ? (
              <p className="text-sm text-black/55">No expired slots.</p>
            ) : null}
          </div>
        </div>
      ) : isReminderSettingsView ? (
        <div className="rounded-xl border border-black/10 bg-[#fafaf8] p-4">
          <p className="text-sm text-black/65">Choose reminder timings and turn toggles on/off.</p>
          <p className="mt-1 text-xs text-black/50">
            {isActiveWaitlisted
              ? "These settings apply to confirmed seats only."
              : isActiveWebinar
                ? "These settings apply to all webinar registrants for this event."
                : "These settings update only the currently selected calendar tab."}
          </p>
          <div className="mt-4 space-y-3">
            <label className="flex items-center justify-between rounded-lg border border-black/10 bg-white px-3 py-2.5">
              <span className="text-sm font-medium text-black">1 day before event</span>
              <button
                type="button"
                role="switch"
                aria-checked={reminderDayEnabled}
                onClick={() => setReminderDayEnabled((prev) => !prev)}
                className={`inline-flex h-7 w-12 items-center rounded-full p-1 transition ${
                  reminderDayEnabled ? "bg-black/55" : "bg-black/20"
                }`}
              >
                <span
                  className={`h-5 w-5 rounded-full bg-white transition ${
                    reminderDayEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </label>

            <label className="flex items-center justify-between rounded-lg border border-black/10 bg-white px-3 py-2.5">
              <span className="text-sm font-medium text-black">1 hour before event</span>
              <button
                type="button"
                role="switch"
                aria-checked={reminderHourEnabled}
                onClick={() => setReminderHourEnabled((prev) => !prev)}
                className={`inline-flex h-7 w-12 items-center rounded-full p-1 transition ${
                  reminderHourEnabled ? "bg-black/55" : "bg-black/20"
                }`}
              >
                <span
                  className={`h-5 w-5 rounded-full bg-white transition ${
                    reminderHourEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </label>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setIsReminderSettingsView(false)}
              className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium text-black/70 hover:bg-black/5"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => void scheduleReminders()}
              disabled={isSchedulingReminders}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              <ButtonLoadingContent loading={isSchedulingReminders} loadingText="Saving...">
                Save reminder settings
              </ButtonLoadingContent>
            </button>
          </div>
        </div>
      ) : pendingBulkInviteTab && pendingBulkInviteTargets.length > 0 ? (
        <div className="rounded-xl border border-black/10 bg-[#fafaf8] p-4">
          <p className="text-sm font-medium text-black">
            {pendingBulkInviteTab === "invite_to" ? "Invite all" : "Resend all"}
          </p>
          <p className="mt-1 text-xs text-black/55">
            {pendingBulkInviteTargets.length} contact
            {pendingBulkInviteTargets.length === 1 ? "" : "s"} in{" "}
            {pendingBulkInviteTab === "invite_to" ? "Invite to" : "Invited"}
          </p>
          <label className="mt-4 block text-[11px] font-medium uppercase tracking-wide text-black/55">
            Email message
          </label>
          <InviteCustomMessageEditor
            editorKey={`bulk-${pendingBulkInviteTab}`}
            value={pendingInviteMessage}
            onChange={setPendingInviteMessage}
            placeholder="Edit the reminder message sent in every email."
          />
          <InviteScheduleFields
            mode={pendingInviteDeliveryMode}
            onModeChange={setPendingInviteDeliveryMode}
            scheduledDate={pendingInviteScheduledDate}
            scheduledTime={pendingInviteScheduledTime}
            onScheduledDateChange={setPendingInviteScheduledDate}
            onScheduledTimeChange={setPendingInviteScheduledTime}
          />
          <div className="mt-5 flex items-center justify-between">
            <button
              type="button"
              onClick={cancelInviteComposer}
              disabled={isSendingBulkInvites || isSchedulingInvites}
              className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium text-black/70 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() =>
                pendingInviteDeliveryMode === "schedule"
                  ? void scheduleInvites({
                      tab: pendingBulkInviteTab,
                      customMessage: pendingInviteMessage,
                      useEventBanner: false,
                    })
                  : void sendBulkInvites(pendingInviteMessage, false)
              }
              disabled={isSendingBulkInvites || isSchedulingInvites}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              <ButtonLoadingContent
                loading={isSendingBulkInvites || isSchedulingInvites}
                loadingText={
                  pendingInviteDeliveryMode === "schedule" ? "Scheduling..." : "Sending..."
                }
              >
                {pendingInviteDeliveryMode === "schedule" ? "Schedule all" : "Confirm & Send all"}
              </ButtonLoadingContent>
            </button>
          </div>
        </div>
      ) : pendingInviteId && pendingInviteSubmission ? (
        <div className="rounded-xl border border-black/10 bg-[#fafaf8] p-4">
          <p className="text-sm font-medium text-black">
            {pendingInviteSubmission.inviteSentAt ? "Resend invite" : "Send invite"}
          </p>
          <p className="mt-1 text-xs text-black/55">
            To: {pendingInviteSubmission.name} ({pendingInviteSubmission.email})
          </p>
          <label className="mt-4 block text-[11px] font-medium uppercase tracking-wide text-black/55">
            Email message
          </label>
          <InviteCustomMessageEditor
            editorKey={`single-${pendingInviteId}`}
            value={pendingInviteMessage}
            onChange={setPendingInviteMessage}
            placeholder="Edit the reminder message sent in the email."
          />
          <InviteScheduleFields
            mode={pendingInviteDeliveryMode}
            onModeChange={setPendingInviteDeliveryMode}
            scheduledDate={pendingInviteScheduledDate}
            scheduledTime={pendingInviteScheduledTime}
            onScheduledDateChange={setPendingInviteScheduledDate}
            onScheduledTimeChange={setPendingInviteScheduledTime}
          />
          <div className="mt-5 flex items-center justify-between">
            <button
              type="button"
              onClick={cancelInviteComposer}
              disabled={sendingInviteId === pendingInviteId || isSchedulingInvites}
              className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium text-black/70 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() =>
                pendingInviteDeliveryMode === "schedule"
                  ? void scheduleInvites({
                      submissionIds: [pendingInviteId],
                      customMessage: pendingInviteMessage,
                      useEventBanner: false,
                    })
                  : void sendInvite(pendingInviteId, pendingInviteMessage, false)
              }
              disabled={sendingInviteId === pendingInviteId || isSchedulingInvites}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              <ButtonLoadingContent
                loading={sendingInviteId === pendingInviteId || isSchedulingInvites}
                loadingText={
                  pendingInviteDeliveryMode === "schedule" ? "Scheduling..." : "Sending..."
                }
              >
                {pendingInviteDeliveryMode === "schedule" ? "Schedule invite" : "Confirm & Send"}
              </ButtonLoadingContent>
            </button>
          </div>
        </div>
      ) : (
        <div>
          {isActiveWaitlisted ? (
            <>
              <div className="mb-4 flex flex-wrap gap-2 border-b border-black/10 pb-3">
                {WAITLISTED_SUBMISSION_TABS.map((tab) => {
                  const isActive = waitlistedSubmissionTab === tab.id;
                  const count = waitlistedStageCounts[tab.id];
                  const isGoingTab = tab.id === "going";
                  const isRejectedTab = tab.id === "rejected";
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setWaitlistedSubmissionTab(tab.id)}
                      className={`inline-flex h-9 items-center gap-2 rounded-full border px-4 text-xs font-medium transition ${
                        isActive
                          ? isGoingTab
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : isRejectedTab
                              ? "border-red-600 bg-red-600 text-white"
                              : "border-black bg-black text-white"
                          : isGoingTab
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                            : isRejectedTab
                              ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
                              : "border-black/15 bg-white text-black/70 hover:bg-black/5"
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          isActive
                            ? "bg-white/20 text-white"
                            : isGoingTab
                              ? "bg-emerald-100 text-emerald-700"
                              : isRejectedTab
                                ? "bg-red-100 text-red-700"
                                : "bg-black/6 text-black/55"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {waitlistedSubmissionTab === "invite_to" ? renderCsvUploadSection() : null}

              <p className="mb-3 text-[11px] text-black/55">
                {waitlistedSubmissionTab === "invite_to"
                  ? "Send invites to move contacts into Invited."
                  : waitlistedSubmissionTab === "invited"
                    ? "Contacts who received an invite. Resend invite reminders from here."
                    : waitlistedSubmissionTab === "waitlist"
                      ? "Pending public registrations. Confirm a seat to send the confirmation email, or reject."
                      : waitlistedSubmissionTab === "going"
                        ? "Confirmed attendees (admin confirmed or invite accepted)."
                        : "Registrants who were not selected for a seat."}
              </p>
            </>
          ) : isActiveWebinar ? (
            <>
              <div className="mb-4 flex flex-wrap gap-2 border-b border-black/10 pb-3">
                {WEBINAR_SUBMISSION_TABS.map((tab) => {
                  const isActive = webinarSubmissionTab === tab.id;
                  const count = webinarStageCounts[tab.id];
                  const isGoingTab = tab.id === "going";
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setWebinarSubmissionTab(tab.id)}
                      className={`inline-flex h-9 items-center gap-2 rounded-full border px-4 text-xs font-medium transition ${
                        isActive
                          ? isGoingTab
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "border-black bg-black text-white"
                          : isGoingTab
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                            : "border-black/15 bg-white text-black/70 hover:bg-black/5"
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          isActive
                            ? isGoingTab
                              ? "bg-white/20 text-white"
                              : "bg-white/15 text-white"
                            : isGoingTab
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-black/6 text-black/55"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {webinarSubmissionTab === "invite_to" ? renderCsvUploadSection() : null}

              <p className="mb-3 text-[11px] text-black/55">
                {webinarSubmissionTab === "invite_to"
                  ? "Send invites to move contacts into Invited."
                  : webinarSubmissionTab === "invited"
                    ? "Contacts who received an invite. Resend invite reminders from here."
                    : "Registered attendees and contacts who accepted their invite."}
              </p>
            </>
          ) : (
            <p className="mb-3 text-[11px] text-black/55">
              Reminder settings apply only to the selected calendar tab.
            </p>
          )}

          <div className="rounded-xl border border-black/10">
            <div
              className={`${submissionTableGridClass} border-b border-black/10 bg-[#f7f7f5] px-4 py-2.5 text-[11px] font-semibold tracking-wide text-black/55 uppercase`}
            >
              <p>Name</p>
              <p>Email</p>
              <p>{isActiveWaitlisted ? "Company / Phone" : "Company"}</p>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span>
                  {isActiveWaitlisted
                    ? waitlistedSubmissionTab === "waitlist"
                      ? "Actions"
                      : waitlistedSubmissionTab === "invite_to" ||
                          waitlistedSubmissionTab === "invited"
                        ? "Invite"
                        : "Status"
                    : isActiveWebinar
                      ? webinarSubmissionTab === "going"
                        ? "Status"
                        : "Invite"
                      : "Invite"}
                </span>
                {((isActiveWebinar &&
                  (webinarSubmissionTab === "invite_to" || webinarSubmissionTab === "invited")) ||
                  (isActiveWaitlisted &&
                    (waitlistedSubmissionTab === "invite_to" ||
                      waitlistedSubmissionTab === "invited"))) &&
                tableSubmissions.length > 0 ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const tab = isActiveWaitlisted
                          ? waitlistedSubmissionTab
                          : webinarSubmissionTab;
                        if (tab === "invite_to" || tab === "invited") {
                          openBulkInviteComposer(tab);
                        }
                      }}
                      disabled={isDeletingAllInvites}
                      className="inline-flex h-6 items-center rounded-md border border-black bg-black px-2 text-[10px] font-medium normal-case tracking-normal text-white hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {(isActiveWaitlisted ? waitlistedSubmissionTab : webinarSubmissionTab) ===
                      "invite_to"
                        ? "Invite all"
                        : "Resend all"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteAllInviteTabContacts()}
                      disabled={isDeletingAllInvites || deletingSubmissionId !== null}
                      className="inline-flex h-6 items-center rounded-md border border-red-200 bg-white px-2 text-[10px] font-medium normal-case tracking-normal text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ButtonLoadingContent
                        loading={isDeletingAllInvites}
                        loadingText="Deleting..."
                      >
                        Delete all
                      </ButtonLoadingContent>
                    </button>
                  </div>
                ) : null}
              </div>
              <p className="text-right"> </p>
            </div>
            {tableSubmissions.map((submission) => (
              <div
                key={submission.id}
                className={`${submissionTableGridClass} items-center border-b border-black/8 px-4 py-3 text-sm text-black/80 last:border-b-0`}
              >
                <p className="truncate pr-1 text-[13px] font-medium text-black">
                  {submission.name}
                </p>
                <p className="truncate pr-2 text-[13px] text-black/70">{submission.email}</p>
                <div className="min-w-0 pr-2">
                  <p className="truncate text-[13px] text-black/70">
                    {submission.companyName || "-"}
                  </p>
                  {isActiveWaitlisted && submission.phone ? (
                    <p className="truncate text-[11px] text-black/50">{submission.phone}</p>
                  ) : null}
                </div>
                <div className="min-w-0">
                  {isActiveWaitlisted && waitlistedSubmissionTab === "waitlist" ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void confirmWaitlistSeat(submission.id)}
                        disabled={
                          confirmingSubmissionId === submission.id ||
                          rejectingSubmissionId === submission.id
                        }
                        className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-emerald-600 bg-emerald-600 px-2.5 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ButtonLoadingContent
                          loading={confirmingSubmissionId === submission.id}
                          loadingText="Confirming..."
                        >
                          Confirm
                        </ButtonLoadingContent>
                      </button>
                      <button
                        type="button"
                        onClick={() => void rejectWaitlistSeat(submission.id)}
                        disabled={
                          confirmingSubmissionId === submission.id ||
                          rejectingSubmissionId === submission.id
                        }
                        className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-red-200 px-2.5 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ButtonLoadingContent
                          loading={rejectingSubmissionId === submission.id}
                          loadingText="Rejecting..."
                        >
                          Reject
                        </ButtonLoadingContent>
                      </button>
                    </div>
                  ) : isActiveWaitlisted && waitlistedSubmissionTab === "going" ? (
                    <span className="text-[11px] font-medium leading-snug text-emerald-700">
                      {submission.inviteAcceptedAt ? "Reconfirmed" : "Seat confirmed"}
                    </span>
                  ) : isActiveWaitlisted && waitlistedSubmissionTab === "rejected" ? (
                    <span className="text-[11px] font-medium leading-snug text-red-700">
                      Rejected
                    </span>
                  ) : isActiveWaitlisted &&
                    (waitlistedSubmissionTab === "invite_to" ||
                      waitlistedSubmissionTab === "invited") ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openInviteComposer(submission.id)}
                        disabled={sendingInviteId === submission.id}
                        className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-black/20 px-2.5 text-[11px] font-medium text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ButtonLoadingContent
                          loading={sendingInviteId === submission.id}
                          loadingText="Sending..."
                        >
                          {waitlistedSubmissionTab === "invited"
                            ? "Resend"
                            : submission.inviteSentAt
                              ? "Invite Sent"
                              : "Send Invite"}
                        </ButtonLoadingContent>
                      </button>
                      {submission.inviteSentAt ? (
                        <span className="whitespace-nowrap text-[10px] text-black/45">
                          {formatInviteSentAt(submission.inviteSentAt)}
                        </span>
                      ) : null}
                    </div>
                  ) : isActiveWebinar && webinarSubmissionTab === "going" ? (
                    <span className="text-[11px] font-medium leading-snug text-emerald-700">
                      {submission.inviteAcceptedAt ? "Reconfirmed" : "Registered"}
                    </span>
                  ) : (
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openInviteComposer(submission.id)}
                        disabled={sendingInviteId === submission.id}
                        className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-black/20 px-2.5 text-[11px] font-medium text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ButtonLoadingContent
                          loading={sendingInviteId === submission.id}
                          loadingText="Sending..."
                        >
                          {isActiveWebinar && webinarSubmissionTab === "invited"
                            ? "Resend"
                            : submission.inviteSentAt
                              ? "Invite Sent"
                              : "Send Invite"}
                        </ButtonLoadingContent>
                      </button>
                      {submission.inviteSentAt ? (
                        <span className="whitespace-nowrap text-[10px] text-black/45">
                          {formatInviteSentAt(submission.inviteSentAt)}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void removeSubmission(submission.id)}
                  disabled={deletingSubmissionId === submission.id}
                  className="justify-self-end inline-flex h-7 w-7 items-center justify-center rounded-full text-black/45 hover:bg-black/5 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`Remove ${submission.name}`}
                  title="Remove submission"
                >
                  <ButtonLoadingContent loading={deletingSubmissionId === submission.id} iconOnly>
                    <span className="block text-base leading-none">×</span>
                  </ButtonLoadingContent>
                </button>
              </div>
            ))}
            {tableSubmissions.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-black/55">
                {isActiveWaitlisted
                  ? waitlistedSubmissionTab === "invite_to"
                    ? "No contacts to invite yet. Upload a CSV to get started."
                    : waitlistedSubmissionTab === "invited"
                      ? "No invited contacts yet."
                      : waitlistedSubmissionTab === "waitlist"
                        ? "No waitlisted registrations yet."
                        : waitlistedSubmissionTab === "going"
                          ? "No confirmed seats yet."
                          : "No rejected registrations."
                  : isActiveWebinar
                    ? webinarSubmissionTab === "invite_to"
                      ? "No contacts to invite yet. Upload a CSV to get started."
                      : webinarSubmissionTab === "invited"
                        ? "No invited contacts yet."
                        : "No one is going yet."
                    : "No submissions for this event calendar yet."}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
