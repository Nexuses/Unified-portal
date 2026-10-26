/** Ported from leadreport-ai for matching pipeline UI. */

export const LEAD_STATUS_ORDER = [
  "warm",
  "hot",
  "meeting_scheduled",
  "meeting_rescheduled",
  "meeting_done",
  "contact_later",
  "client_manage",
  "client_unavailable",
  "client_rejected",
  "lost",
] as const;

export type LeadStatus = (typeof LEAD_STATUS_ORDER)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  hot: "Hot",
  warm: "Warm",
  meeting_scheduled: "Meeting Scheduled",
  meeting_rescheduled: "Meeting Rescheduled",
  meeting_done: "Meeting Done",
  contact_later: "Contact Later",
  client_manage: "Client Manage",
  client_unavailable: "Client Unavailable",
  client_rejected: "Client Rejected",
  lost: "Lost",
};

export const LEAD_STATUS_UI: Record<
  LeadStatus,
  {
    textClass: string;
    badgeClass: string;
    activeSegmentClass: string;
    inactiveSegmentClass: string;
  }
> = {
  hot: {
    textClass: "lr-st-hot",
    badgeClass: "lr-bdg-hot",
    activeSegmentClass: "lr-seg-hot-on",
    inactiveSegmentClass: "lr-seg-hot-off",
  },
  warm: {
    textClass: "lr-st-warm",
    badgeClass: "lr-bdg-warm",
    activeSegmentClass: "lr-seg-warm-on",
    inactiveSegmentClass: "lr-seg-warm-off",
  },
  meeting_scheduled: {
    textClass: "lr-st-ms",
    badgeClass: "lr-bdg-ms",
    activeSegmentClass: "lr-seg-ms-on",
    inactiveSegmentClass: "lr-seg-ms-off",
  },
  meeting_rescheduled: {
    textClass: "lr-st-mr",
    badgeClass: "lr-bdg-mr",
    activeSegmentClass: "lr-seg-mr-on",
    inactiveSegmentClass: "lr-seg-mr-off",
  },
  meeting_done: {
    textClass: "lr-st-md",
    badgeClass: "lr-bdg-md",
    activeSegmentClass: "lr-seg-md-on",
    inactiveSegmentClass: "lr-seg-md-off",
  },
  contact_later: {
    textClass: "lr-st-cl",
    badgeClass: "lr-bdg-cl",
    activeSegmentClass: "lr-seg-cl-on",
    inactiveSegmentClass: "lr-seg-cl-off",
  },
  client_manage: {
    textClass: "lr-st-cm",
    badgeClass: "lr-bdg-cm",
    activeSegmentClass: "lr-seg-cm-on",
    inactiveSegmentClass: "lr-seg-cm-off",
  },
  client_unavailable: {
    textClass: "lr-st-cu",
    badgeClass: "lr-bdg-cu",
    activeSegmentClass: "lr-seg-cu-on",
    inactiveSegmentClass: "lr-seg-cu-off",
  },
  client_rejected: {
    textClass: "lr-st-cr",
    badgeClass: "lr-bdg-cr",
    activeSegmentClass: "lr-seg-cr-on",
    inactiveSegmentClass: "lr-seg-cr-off",
  },
  lost: {
    textClass: "lr-st-lost",
    badgeClass: "lr-bdg-lost",
    activeSegmentClass: "lr-seg-lost-on",
    inactiveSegmentClass: "lr-seg-lost-off",
  },
};

const LABEL_TO_STATUS: Record<string, LeadStatus> = Object.fromEntries(
  LEAD_STATUS_ORDER.map((status) => [LEAD_STATUS_LABELS[status].toLowerCase(), status]),
) as Record<string, LeadStatus>;

export function normalizeLeadStatus(status?: string): LeadStatus {
  if (!status) return "warm";
  const raw = status.trim().toLowerCase().replace(/\s+/g, "_");
  if (LEAD_STATUS_ORDER.includes(raw as LeadStatus)) {
    return raw as LeadStatus;
  }
  const byLabel = LABEL_TO_STATUS[status.trim().toLowerCase()];
  return byLabel || "warm";
}

export function getLeadStatusLabel(status?: string): string {
  return LEAD_STATUS_LABELS[normalizeLeadStatus(status)];
}

/** Pipeline ring score (0–100) derived from lead stage. */
export const LEAD_STATUS_SCORE: Record<LeadStatus, number> = {
  warm: 40,
  hot: 60,
  meeting_scheduled: 70,
  meeting_rescheduled: 65,
  meeting_done: 100,
  contact_later: 50,
  client_manage: 90,
  client_unavailable: 30,
  client_rejected: 15,
  lost: 0,
};

export function scoreForLeadStatus(status?: string): number {
  return LEAD_STATUS_SCORE[normalizeLeadStatus(status)];
}

/** Overall qualification stars (0–5) derived from lead stage. */
export function starsForLeadStatus(status?: string): number {
  return Math.max(
    0,
    Math.min(5, Math.round(scoreForLeadStatus(status) / 20)),
  );
}
