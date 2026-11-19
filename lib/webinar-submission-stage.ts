export type WebinarSubmissionStage = "invite_to" | "invited" | "going";

export type WebinarSubmissionStageInput = {
  source?: string | null;
  inviteSentAt?: string | null;
  inviteAcceptedAt?: string | null;
};

export function getWebinarSubmissionStage(
  submission: WebinarSubmissionStageInput
): WebinarSubmissionStage {
  if (submission.inviteAcceptedAt || submission.source === "registration") {
    return "going";
  }
  if (submission.inviteSentAt) {
    return "invited";
  }
  if (submission.source === "csv") {
    return "invite_to";
  }
  return "going";
}

export const WEBINAR_SUBMISSION_TABS: Array<{
  id: WebinarSubmissionStage;
  label: string;
}> = [
  { id: "invite_to", label: "Invite to" },
  { id: "invited", label: "Invited" },
  { id: "going", label: "Going" },
];

export type WaitlistStatus = "pending" | "confirmed" | "rejected";

export type WaitlistedSubmissionStage =
  | "invite_to"
  | "invited"
  | "waitlist"
  | "going"
  | "rejected";

export type WaitlistedSubmissionStageInput = {
  source?: string | null;
  inviteSentAt?: string | null;
  inviteAcceptedAt?: string | null;
  waitlistStatus?: WaitlistStatus | string | null;
};

export function getWaitlistedSubmissionStage(
  submission: WaitlistedSubmissionStageInput
): WaitlistedSubmissionStage {
  const status = String(submission.waitlistStatus ?? "").trim().toLowerCase();
  if (status === "rejected") {
    return "rejected";
  }
  if (status === "pending") {
    return "waitlist";
  }
  if (status === "confirmed" || submission.inviteAcceptedAt) {
    return "going";
  }
  if (submission.inviteSentAt) {
    return "invited";
  }
  if (submission.source === "csv") {
    return "invite_to";
  }
  return "waitlist";
}

export const WAITLISTED_SUBMISSION_TABS: Array<{
  id: WaitlistedSubmissionStage;
  label: string;
}> = [
  { id: "invite_to", label: "Invite to" },
  { id: "invited", label: "Invited" },
  { id: "waitlist", label: "Waitlist" },
  { id: "going", label: "Going" },
  { id: "rejected", label: "Rejected" },
];
