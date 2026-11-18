/** Stable ICS UID stored on the submission when an invite is sent. */
export function buildCalendarInviteUid(publicId: string, submissionId: string) {
  const base = publicId.trim() || "event";
  const id = submissionId.trim();
  return `${base}-${id}`.replace(/[^a-zA-Z0-9@._-]/g, "");
}
