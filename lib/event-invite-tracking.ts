import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import {
  injectCampaignTracking,
  resolveUsableTrackingOrigin,
} from "@/lib/campaign-tracking";
import { getDb } from "@/lib/mongodb";
import type { SenderDoc } from "@/lib/smtp-senders";

type TrackableSubmission = {
  _id: ObjectId;
  eventId: ObjectId;
  trackingToken?: string;
  openedAt?: Date;
  openCount?: number;
  clickedAt?: Date;
  clickCount?: number;
};

function submissions() {
  return getDb().then((db) => db.collection<TrackableSubmission>("event_submissions"));
}

/** Stable per-submission token for open/click CTD URLs. */
export async function ensureSubmissionTrackingToken(
  eventId: string,
  submissionId: string,
) {
  if (!ObjectId.isValid(eventId) || !ObjectId.isValid(submissionId)) {
    return "";
  }
  const collection = await submissions();
  const existing = await collection.findOne({
    _id: new ObjectId(submissionId),
    eventId: new ObjectId(eventId),
  });
  if (!existing) {
    return "";
  }
  if (existing.trackingToken) {
    return existing.trackingToken;
  }
  const trackingToken = randomBytes(18).toString("hex");
  await collection.updateOne({ _id: existing._id }, { $set: { trackingToken } });
  return trackingToken;
}

async function loadNotifySenderTrackingDomain(
  projectId: string,
  senderId: string | undefined,
) {
  if (!ObjectId.isValid(projectId) || !senderId || !ObjectId.isValid(senderId)) {
    return "";
  }
  const db = await getDb();
  const sender = await db.collection<SenderDoc>("smtp_senders").findOne(
    {
      _id: new ObjectId(senderId),
      projectId: new ObjectId(projectId),
    },
    { projection: { trackingDomain: 1 } },
  );
  return String(sender?.trackingDomain ?? "").trim();
}

/**
 * When the event has CTD enabled, wrap links + open pixel using the notify
 * sender's tracking domain. Returns the original HTML when CTD is off.
 */
export async function applyEventInviteCustomTracking(input: {
  html: string;
  event: {
    customTrackingEnabled?: boolean;
    projectId?: string;
    senderId?: string;
    eventName?: string;
  };
  eventId: string;
  submissionId?: string;
}) {
  if (!input.event.customTrackingEnabled) {
    return input.html;
  }
  const submissionId = String(input.submissionId ?? "").trim();
  if (!submissionId || !input.eventId) {
    return input.html;
  }

  const token = await ensureSubmissionTrackingToken(input.eventId, submissionId);
  if (!token) {
    return input.html;
  }

  const trackingDomain = await loadNotifySenderTrackingDomain(
    String(input.event.projectId ?? ""),
    input.event.senderId,
  );
  const origin = await resolveUsableTrackingOrigin(trackingDomain);
  return injectCampaignTracking(input.html, origin, token, {
    campaignName: String(input.event.eventName ?? "").trim(),
    trackOpens: true,
    trackClicks: true,
    autoUnsubscribeFooter: false,
  });
}

export async function recordEventInviteOpen(token: string) {
  const cleaned = String(token ?? "").trim();
  if (!cleaned) {
    return false;
  }
  const collection = await submissions();
  const submission = await collection.findOne({ trackingToken: cleaned });
  if (!submission) {
    return false;
  }
  const now = new Date();
  await collection.updateOne(
    { _id: submission._id },
    {
      $inc: { openCount: 1 },
      $set: { openedAt: submission.openedAt ?? now },
    },
  );
  return true;
}

export async function recordEventInviteClick(token: string, url?: string) {
  const cleaned = String(token ?? "").trim();
  if (!cleaned) {
    return false;
  }
  const collection = await submissions();
  const submission = await collection.findOne({ trackingToken: cleaned });
  if (!submission) {
    return false;
  }
  const now = new Date();
  const clickedUrl = String(url ?? "").trim();
  await collection.updateOne(
    { _id: submission._id },
    {
      $inc: { clickCount: 1 },
      $set: {
        clickedAt: submission.clickedAt ?? now,
        ...(clickedUrl ? { clickedUrl } : {}),
      },
    },
  );
  return true;
}
