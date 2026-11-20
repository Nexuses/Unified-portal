"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ButtonLoadingContent } from "@/components/button-loader";
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
import { buildSubmissionsExportCsv, downloadCsvFile } from "@/lib/csv-registrants";
import { portalListRoute } from "@/lib/portal-nav";
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
  source: "csv" | "registration" | "list" | null;
  sourceListId?: string | null;
  sourceListName?: string | null;
  botClick?: boolean;
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

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7 7.4 19a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

type EventSubmissionsBoardProps = {
  eventId: string;
  eventName: string;
  eventFormat: EventFormat;
  registrationListId?: string;
};

export function EventSubmissionsBoard({
  eventId,
  eventName,
  eventFormat: initialEventFormat,
  registrationListId,
}: EventSubmissionsBoardProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [activeEventFormat, setActiveEventFormat] = useState<EventFormat>(initialEventFormat);
  const [uploadMessage, setUploadMessage] = useState("");
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
  const [crmLists, setCrmLists] = useState<Array<{ id: string; name: string; contactCount: number }>>([]);
  const [selectedListId, setSelectedListId] = useState("");
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const listPickerRef = useRef<HTMLDivElement>(null);
  const [importingList, setImportingList] = useState(false);
  const [showBotClicks, setShowBotClicks] = useState(false);
  const [submissionsPage, setSubmissionsPage] = useState(1);
  const [notice, setNotice] = useState("");
  const [nowTs, setNowTs] = useState(() => Date.now());
  const SUBMISSIONS_PAGE_SIZE = 50;

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
    void fetch("/api/crm/lists")
      .then(async (response) => {
        if (!response.ok) return [];
        const payload = (await response.json()) as Array<{
          id?: string;
          name?: string;
          contactCount?: number;
        }>;
        return Array.isArray(payload) ? payload : [];
      })
      .then((lists) => {
        if (cancelled) return;
        setCrmLists(
          lists
            .filter((list) => list.id && list.name)
            .map((list) => ({
              id: list.id as string,
              name: list.name as string,
              contactCount: list.contactCount ?? 0,
            })),
        );
      })
      .catch(() => {
        if (!cancelled) setCrmLists([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!listMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!listPickerRef.current?.contains(event.target as Node)) {
        setListMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [listMenuOpen]);

  useEffect(() => {
    setSubmissionsPage(1);
  }, [
    webinarSubmissionTab,
    waitlistedSubmissionTab,
    showBotClicks,
    activeCalendarTab,
    eventId,
  ]);

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

  async function importSelectedList() {
    if (!selectedListId) return;
    setImportingList(true);
    setError("");
    setUploadMessage("");
    try {
      const response = await fetch(`/api/events/${eventId}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId: selectedListId, slotIndex: 0 }),
      });
      const payload = (await response.json()) as {
        message?: string;
        insertedCount?: number;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Could not add that list.");
      }
      await loadSubmissionsForEvent(eventId);
      setWebinarSubmissionTab("invite_to");
      setWaitlistedSubmissionTab("invite_to");
      setIsCalendarSelectionView(false);
      setUploadMessage(payload.message ?? "List added.");
    } catch (listError) {
      setError(listError instanceof Error ? listError.message : "Could not add that list.");
    } finally {
      setImportingList(false);
    }
  }

  const filteredCrmLists = useMemo(() => {
    const query = listSearch.trim().toLowerCase();
    if (!query) return crmLists;
    return crmLists.filter((list) => list.name.toLowerCase().includes(query));
  }, [crmLists, listSearch]);

  const selectedList = crmLists.find((list) => list.id === selectedListId) ?? null;

  function renderBotToggle() {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={showBotClicks}
        className={`drip-report-table-toggle drip-report-bot-nav-toggle${showBotClicks ? " is-on" : ""}`}
        onClick={() => setShowBotClicks((value) => !value)}
        title={
          showBotClicks
            ? "Bot clicks included in Going count and list"
            : "Bot clicks hidden from Going count and list"
        }
      >
        <span className="drip-report-table-switch" aria-hidden="true" />
        Show bot clicks
      </button>
    );
  }

  function renderListImport() {
    return (
      <>
        <div className="drip-toolbar event-list-toolbar">
          <div className="crm-list-picker" ref={listPickerRef}>
            <button
              type="button"
              className={`crm-list-picker-trigger${listMenuOpen ? " is-open" : ""}`}
              aria-label="From a CRM list"
              aria-expanded={listMenuOpen}
              disabled={importingList}
              onClick={() => setListMenuOpen((open) => !open)}
            >
              <span>
                {selectedList
                  ? `${selectedList.name} (${selectedList.contactCount})`
                  : "Choose a list"}
              </span>
              <span aria-hidden>▾</span>
            </button>
            {listMenuOpen ? (
              <div className="crm-list-picker-menu" role="listbox">
                <label className="crm-list-picker-search">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    value={listSearch}
                    onChange={(event) => setListSearch(event.target.value)}
                    placeholder="Search lists"
                    autoFocus
                  />
                </label>
                {crmLists.length === 0 ? (
                  <p className="crm-list-picker-empty">No lists yet.</p>
                ) : filteredCrmLists.length === 0 ? (
                  <p className="crm-list-picker-empty">No lists match your search.</p>
                ) : (
                  filteredCrmLists.map((list) => (
                    <button
                      key={list.id}
                      type="button"
                      role="option"
                      aria-selected={list.id === selectedListId}
                      className={list.id === selectedListId ? "is-selected" : ""}
                      onClick={() => {
                        setSelectedListId(list.id);
                        setListMenuOpen(false);
                        setListSearch("");
                      }}
                    >
                      <span>{list.name}</span>
                      <span>{list.contactCount}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="btn-dark"
            disabled={!selectedListId || importingList}
            onClick={() => void importSelectedList()}
          >
            {importingList ? "Adding..." : "Add list"}
          </button>
        </div>
        {uploadMessage ? <p className="crm-summary">{uploadMessage}</p> : null}
      </>
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
      counts[tab.id] = submissions.filter((submission) => {
        if (getWebinarSubmissionStage(submission) !== tab.id) {
          return false;
        }
        // Match Going table: hide honeypot hits when "Show bot clicks" is off.
        if (!showBotClicks && tab.id === "going" && submission.botClick) {
          return false;
        }
        return true;
      }).length;
      return counts;
    },
    { invite_to: 0, invited: 0, going: 0 } as Record<WebinarSubmissionStage, number>
  );
  const waitlistedStageCounts = WAITLISTED_SUBMISSION_TABS.reduce(
    (counts, tab) => {
      counts[tab.id] = submissions.filter((submission) => {
        if (getWaitlistedSubmissionStage(submission) !== tab.id) {
          return false;
        }
        if (!showBotClicks && tab.id === "going" && submission.botClick) {
          return false;
        }
        return true;
      }).length;
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
  const goingTab =
    (isActiveWebinar && webinarSubmissionTab === "going") ||
    (isActiveWaitlisted && waitlistedSubmissionTab === "going");
  const displayedSubmissions =
    goingTab && !showBotClicks
      ? tableSubmissions.filter((submission) => !submission.botClick)
      : tableSubmissions;
  const submissionsTotalPages = Math.max(
    1,
    Math.ceil(displayedSubmissions.length / SUBMISSIONS_PAGE_SIZE),
  );
  const currentSubmissionsPage = Math.min(submissionsPage, submissionsTotalPages);
  const pagedSubmissions = displayedSubmissions.slice(
    (currentSubmissionsPage - 1) * SUBMISSIONS_PAGE_SIZE,
    currentSubmissionsPage * SUBMISSIONS_PAGE_SIZE,
  );
  const submissionsRangeStart =
    displayedSubmissions.length === 0
      ? 0
      : (currentSubmissionsPage - 1) * SUBMISSIONS_PAGE_SIZE + 1;
  const submissionsRangeEnd = Math.min(
    currentSubmissionsPage * SUBMISSIONS_PAGE_SIZE,
    displayedSubmissions.length,
  );
  const inviteHistory = submissions.reduce<
    Array<{ key: string; name: string; added: number; sent: number; clicks: number }>
  >((rows, submission) => {
    const key = submission.sourceListId || submission.source || "other";
    const name =
      submission.sourceListName ||
      (submission.source === "list"
        ? "List"
        : submission.source === "csv"
          ? "CSV upload"
          : "Registration");
    const existing = rows.find((row) => row.key === key);
    const sent = submission.inviteSentAt ? 1 : 0;
    const clicks = submission.botClick ? 1 : 0;
    if (existing) {
      existing.added += 1;
      existing.sent += sent;
      existing.clicks += clicks;
      return rows;
    }
    rows.push({ key, name, added: 1, sent, clicks });
    return rows;
  }, []);
  const pendingInviteSubmission = pendingInviteId
    ? submissions.find((submission) => submission.id === pendingInviteId)
    : null;
  const pendingBulkInviteTargets = pendingBulkInviteTab
    ? submissions.filter((submission) => {
        if (submission.source === "csv") return false;
        return isActiveWaitlisted
          ? getWaitlistedSubmissionStage(submission) === pendingBulkInviteTab
          : getWebinarSubmissionStage(submission) === pendingBulkInviteTab;
      })
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

  return (
    <div className="event-portal-page">
      <div className="crm-page-head drip-page-head">
        <div className="drip-detail-title-wrap">
          <Link
            href="/portal/marketing/events"
            onClick={(event) => {
              event.preventDefault();
              goBack();
            }}
            className="drip-back"
            aria-label="Back to events"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <div>
            <h2 title={eventName}>{eventName}</h2>
            <p>Submissions · {eventFormatLabel(activeEventFormat)}</p>
          </div>
        </div>
        <div className="crm-actions">
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
                  className="btn-soft"
                >
                  Calendars
                </button>
              ) : null}
              <button
                type="button"
                onClick={openReminderSettingsView}
                disabled={filteredSubmissions.length === 0 || isCalendarSelectionView}
                className="btn-soft"
              >
                Reminder settings
              </button>
              {!isCalendarSelectionView && !isReminderSettingsView && !isExpiredCalendarView ? (
                <button
                  type="button"
                  onClick={exportSubmissionsCsv}
                  disabled={(isActiveSharedSession ? submissions : tableSubmissions).length === 0}
                  className="btn-soft"
                >
                  Export CSV
                </button>
              ) : null}
              {registrationListId ? (
                <Link
                  href={portalListRoute(registrationListId)}
                  className="btn-soft"
                >
                  Registration list
                </Link>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <div className="event-portal-body">

      {notice ? <p className="crm-summary">{notice}</p> : null}
      {error ? <p className="crm-error">{error}</p> : null}

      {isLoading && isCalendarSelectionView ? (
        <SubmissionsCalendarCardsSkeleton />
      ) : isLoading ? (
        <SubmissionsTableSkeleton showCsvSection={false} />
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
          <div className="drip-settings-section">
            <div className="drip-settings-item">
              <div className="drip-settings-row">
                <button
                  type="button"
                  role="switch"
                  aria-checked={reminderDayEnabled}
                  aria-label="1 day before event"
                  onClick={() => setReminderDayEnabled((prev) => !prev)}
                  className={`drip-toggle${reminderDayEnabled ? " on" : ""}`}
                >
                  {reminderDayEnabled ? (
                    <svg className="drip-toggle-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : null}
                  <span className="drip-toggle-knob" />
                </button>
                <span className="drip-settings-label">1 day before event</span>
              </div>
            </div>
            <div className="drip-settings-item">
              <div className="drip-settings-row">
                <button
                  type="button"
                  role="switch"
                  aria-checked={reminderHourEnabled}
                  aria-label="1 hour before event"
                  onClick={() => setReminderHourEnabled((prev) => !prev)}
                  className={`drip-toggle${reminderHourEnabled ? " on" : ""}`}
                >
                  {reminderHourEnabled ? (
                    <svg className="drip-toggle-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : null}
                  <span className="drip-toggle-knob" />
                </button>
                <span className="drip-settings-label">1 hour before event</span>
              </div>
            </div>
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
        <div className="drip-shell">
          {isActiveWaitlisted ? (
            <>
              <div className="drip-report-tabs-row">
                <div className="drip-report-tabs">
                  {WAITLISTED_SUBMISSION_TABS.map((tab) => {
                    const isActive = waitlistedSubmissionTab === tab.id;
                    const count = waitlistedStageCounts[tab.id];
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setWaitlistedSubmissionTab(tab.id);
                          setSubmissionsPage(1);
                        }}
                        className={isActive ? "active" : ""}
                      >
                        {tab.label}
                        <span className="drip-report-table-count">{count}</span>
                      </button>
                    );
                  })}
                </div>
                {waitlistedSubmissionTab === "going" ? renderBotToggle() : null}
              </div>

              {waitlistedSubmissionTab === "invite_to" ? renderListImport() : null}

              <p className="drip-create-copy">
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
              <div className="drip-report-tabs-row">
                <div className="drip-report-tabs">
                  {WEBINAR_SUBMISSION_TABS.map((tab) => {
                    const isActive = webinarSubmissionTab === tab.id;
                    const count = webinarStageCounts[tab.id];
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setWebinarSubmissionTab(tab.id);
                          setSubmissionsPage(1);
                        }}
                        className={isActive ? "active" : ""}
                      >
                        {tab.label}
                        <span className="drip-report-table-count">{count}</span>
                      </button>
                    );
                  })}
                </div>
                {webinarSubmissionTab === "going" ? renderBotToggle() : null}
              </div>

              {webinarSubmissionTab === "invite_to" ? renderListImport() : null}

              <p className="drip-create-copy">
                {webinarSubmissionTab === "invite_to"
                  ? "Send invites to move contacts into Invited."
                  : webinarSubmissionTab === "invited"
                    ? "Contacts who received an invite. Resend invite reminders from here."
                    : "Registered attendees and contacts who accepted their invite."}
              </p>
            </>
          ) : (
            <p className="drip-create-copy">
              Reminder settings apply only to the selected calendar tab.
            </p>
          )}

          <div className="drip-report-people-head">
            <h3 className="drip-report-audience-title">People</h3>
            {((isActiveWebinar &&
              (webinarSubmissionTab === "invite_to" || webinarSubmissionTab === "invited")) ||
              (isActiveWaitlisted &&
                (waitlistedSubmissionTab === "invite_to" ||
                  waitlistedSubmissionTab === "invited"))) &&
            tableSubmissions.some((submission) => submission.source !== "csv") ? (
              <div className="drip-report-people-tools">
                <button
                  type="button"
                  className="btn-dark"
                  onClick={() => {
                    const tab = isActiveWaitlisted ? waitlistedSubmissionTab : webinarSubmissionTab;
                    if (tab === "invite_to" || tab === "invited") {
                      openBulkInviteComposer(tab);
                    }
                  }}
                  disabled={isDeletingAllInvites}
                >
                  {(isActiveWaitlisted ? waitlistedSubmissionTab : webinarSubmissionTab) ===
                  "invite_to"
                    ? "Invite all"
                    : "Resend all"}
                </button>
                <button
                  type="button"
                  className="btn-soft"
                  onClick={() => void deleteAllInviteTabContacts()}
                  disabled={isDeletingAllInvites || deletingSubmissionId !== null}
                >
                  <ButtonLoadingContent loading={isDeletingAllInvites} loadingText="Deleting...">
                    Delete all
                  </ButtonLoadingContent>
                </button>
              </div>
            ) : null}
          </div>
          <div className="data-table-wrap">
            <table className="data-table drip-report-table event-submissions-people-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Company</th>
                  <th>
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
                  </th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
            {pagedSubmissions.map((submission) => (
              <tr key={submission.id}>
                <td data-label="Name">{submission.name}</td>
                <td data-label="Email">{submission.email}</td>
                <td data-label="Company">
                  {submission.companyName || "—"}
                  {isActiveWaitlisted && submission.phone ? (
                    <div className="event-invite-meta">{submission.phone}</div>
                  ) : null}
                </td>
                <td
                  data-label={
                    isActiveWaitlisted
                      ? waitlistedSubmissionTab === "waitlist"
                        ? "Actions"
                        : waitlistedSubmissionTab === "invite_to" ||
                            waitlistedSubmissionTab === "invited"
                          ? "Invite"
                          : "Status"
                      : isActiveWebinar && webinarSubmissionTab === "going"
                        ? "Status"
                        : "Invite"
                  }
                >
                  {isActiveWaitlisted && waitlistedSubmissionTab === "waitlist" ? (
                    <div className="event-submissions-actions">
                      <button
                        type="button"
                        onClick={() => void confirmWaitlistSeat(submission.id)}
                        disabled={
                          confirmingSubmissionId === submission.id ||
                          rejectingSubmissionId === submission.id
                        }
                        className="btn-dark"
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
                        className="btn-soft"
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
                    <span className="event-going-status">
                      <span className="sub-badge">
                        {submission.inviteAcceptedAt ? "Confirmed" : "Seat confirmed"}
                      </span>
                      {submission.botClick ? <span className="event-bot-pill">Bot click</span> : null}
                    </span>
                  ) : isActiveWaitlisted && waitlistedSubmissionTab === "rejected" ? (
                    <span className="drip-report-status">Rejected</span>
                  ) : isActiveWaitlisted &&
                    (waitlistedSubmissionTab === "invite_to" ||
                      waitlistedSubmissionTab === "invited") ? (
                    submission.source === "csv" ? (
                      <span className="drip-status">CSV upload</span>
                    ) : (
                    <div className="event-submissions-actions">
                      <button
                        type="button"
                        onClick={() => openInviteComposer(submission.id)}
                        disabled={sendingInviteId === submission.id}
                        className="btn-soft"
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
                        <span className="event-invite-meta">
                          {formatInviteSentAt(submission.inviteSentAt)}
                        </span>
                      ) : null}
                    </div>
                    )
                  ) : isActiveWebinar && webinarSubmissionTab === "going" ? (
                    <span className="event-going-status">
                      <span className="sub-badge">
                        {submission.inviteAcceptedAt ? "Confirmed" : "Registered"}
                      </span>
                      {submission.botClick ? <span className="event-bot-pill">Bot click</span> : null}
                    </span>
                  ) : submission.source === "csv" ? (
                    <span className="drip-status">CSV upload</span>
                  ) : (
                    <div className="event-submissions-actions">
                      <button
                        type="button"
                        onClick={() => openInviteComposer(submission.id)}
                        disabled={sendingInviteId === submission.id}
                        className="btn-soft"
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
                        <span className="event-invite-meta">
                          {formatInviteSentAt(submission.inviteSentAt)}
                        </span>
                      ) : null}
                    </div>
                  )}
                </td>
                <td data-label="Remove">
                  <button
                    type="button"
                    onClick={() => void removeSubmission(submission.id)}
                    disabled={deletingSubmissionId === submission.id}
                    className="icon-btn event-remove-btn"
                    aria-label={`Remove ${submission.name}`}
                    title="Remove"
                  >
                    <ButtonLoadingContent
                      loading={deletingSubmissionId === submission.id}
                      loadingText=""
                    >
                      <TrashIcon />
                    </ButtonLoadingContent>
                  </button>
                </td>
              </tr>
            ))}
            {displayedSubmissions.length === 0 ? (
              <tr>
                <td colSpan={5} className="drip-empty">
                {isActiveWaitlisted
                  ? waitlistedSubmissionTab === "invite_to"
                    ? "No contacts to invite yet. Add a list to get started."
                    : waitlistedSubmissionTab === "invited"
                      ? "No invited contacts yet."
                      : waitlistedSubmissionTab === "waitlist"
                        ? "No waitlisted registrations yet."
                        : waitlistedSubmissionTab === "going"
                          ? "No confirmed seats yet."
                          : "No rejected registrations."
                  : isActiveWebinar
                    ? webinarSubmissionTab === "invite_to"
                      ? "No contacts to invite yet. Add a list to get started."
                      : webinarSubmissionTab === "invited"
                        ? "No invited contacts yet."
                        : "No one is going yet."
                    : "No submissions for this event calendar yet."}
                </td>
              </tr>
            ) : null}
              </tbody>
            </table>
          </div>
          {displayedSubmissions.length > SUBMISSIONS_PAGE_SIZE ? (
            <div className="drip-pagination">
              <span className="drip-page-range">
                {submissionsRangeStart}-{submissionsRangeEnd} of{" "}
                {displayedSubmissions.length.toLocaleString()}
              </span>
              <div className="drip-page-controls">
                <select
                  value={currentSubmissionsPage}
                  onChange={(event) => setSubmissionsPage(Number(event.target.value))}
                  aria-label="Page"
                >
                  {Array.from({ length: submissionsTotalPages }, (_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {index + 1}
                    </option>
                  ))}
                </select>
                <span>of {submissionsTotalPages} pages</span>
                <button
                  type="button"
                  className="drip-page-arrow"
                  disabled={currentSubmissionsPage <= 1}
                  onClick={() => setSubmissionsPage((page) => Math.max(1, page - 1))}
                  aria-label="Previous page"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="drip-page-arrow"
                  disabled={currentSubmissionsPage >= submissionsTotalPages}
                  onClick={() =>
                    setSubmissionsPage((page) => Math.min(submissionsTotalPages, page + 1))
                  }
                  aria-label="Next page"
                >
                  ›
                </button>
              </div>
            </div>
          ) : null}
          <div className="event-invite-history">
            <div className="event-invite-history-head">
              <h3>Invite history</h3>
            </div>
            <div className="data-table-wrap">
              <table className="data-table drip-report-table">
                <thead>
                  <tr>
                    <th>List</th>
                    <th>Added</th>
                    <th>Sent</th>
                    <th>Bot clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {inviteHistory.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="drip-empty">
                        No invite batches yet.
                      </td>
                    </tr>
                  ) : (
                    inviteHistory.map((row) => (
                      <tr key={row.key}>
                        <td data-label="List">{row.name}</td>
                        <td data-label="Added" className="drip-report-table-num">
                          {row.added}
                        </td>
                        <td data-label="Sent" className="drip-report-table-num">
                          {row.sent}
                        </td>
                        <td data-label="Bot clicks" className="drip-report-table-num">
                          {row.clicks}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
