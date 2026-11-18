import type { ObjectId } from "mongodb";
import { PORTAL_ROUTES } from "@/lib/portal-nav";
import { raiseProjectAlert, resolveProjectAlert, resolveProjectAlerts } from "@/lib/portal-alerts-server";

/** Bell alerts for cloud campaigns: a stopped campaign, a signed-out sender, stuck follow-ups. */
export type CloudStopKind = "signed_out" | "error" | "schedule";

function campaignHref(campaignId: string) {
  return `${PORTAL_ROUTES.cloud}/${encodeURIComponent(campaignId)}`;
}

const stoppedKey = (campaignId: string) => `cloud:${campaignId}:stopped`;
const followupKey = (campaignId: string) => `cloud:${campaignId}:followups`;

/** A campaign stopped on its own (sender signed out, an error, or nothing left to send in the schedule). */
export async function alertCampaignStopped(input: {
  projectId: ObjectId;
  campaignId: string;
  name: string;
  kind: CloudStopKind;
  /** Row that will be sent first on Resume (0-based). */
  nextRow: number;
  total: number;
  sender?: string;
  message: string;
}) {
  const row = `row ${input.nextRow + 1}${input.total ? ` of ${input.total}` : ""}`;
  const title =
    input.kind === "signed_out"
      ? `Sender signed out · ${input.name}`
      : input.kind === "schedule"
        ? `Campaign waiting · ${input.name}`
        : `Campaign stopped · ${input.name}`;
  const body =
    input.kind === "signed_out"
      ? `${input.sender || "The sender"} was signed out, so sending stopped at ${row}. Sign in again, then Resume — it picks up from ${row}.`
      : `Sending stopped at ${row}: ${input.message.slice(0, 220)} Resume picks up from ${row}.`;
  await raiseProjectAlert({
    projectId: input.projectId,
    key: stoppedKey(input.campaignId),
    severity: input.kind === "schedule" ? "warning" : "error",
    title,
    body,
    href: campaignHref(input.campaignId),
  });
}

export async function resolveCampaignStopped(projectId: ObjectId, campaignId: string) {
  await resolveProjectAlert(projectId, stoppedKey(campaignId));
}

/** Follow-ups can't go out (sender signed out) or one failed. */
export async function alertFollowups(input: {
  projectId: ObjectId;
  campaignId: string;
  name: string;
  signedOut: boolean;
  message: string;
}) {
  await raiseProjectAlert({
    projectId: input.projectId,
    key: followupKey(input.campaignId),
    severity: input.signedOut ? "error" : "warning",
    title: input.signedOut ? `Follow-ups paused · ${input.name}` : `Follow-up failed · ${input.name}`,
    body: input.signedOut
      ? "The sender was signed out, so follow-ups are waiting. Sign in again (step 2) and they continue on their own."
      : input.message.slice(0, 300),
    href: campaignHref(input.campaignId),
  });
}

export async function resolveFollowupAlert(projectId: ObjectId, campaignId: string) {
  await resolveProjectAlert(projectId, followupKey(campaignId));
}

export async function resolveCampaignAlerts(projectId: ObjectId, campaignId: string) {
  await resolveProjectAlerts(projectId, `cloud:${campaignId}:`);
}
