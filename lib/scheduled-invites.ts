import { ObjectId } from "mongodb";
import { isWaitlistedWebinarFormat, isWebinarFormat } from "@/lib/event-format";
import { getEventById } from "@/lib/events";
import { getDb } from "@/lib/mongodb";
import {
  getSubmissionsByEventId,
  type EventSubmission,
} from "@/lib/submissions";
import {
  getWaitlistedSubmissionStage,
  getWebinarSubmissionStage,
} from "@/lib/webinar-submission-stage";
import { sendSubmissionInviteForEvent } from "@/lib/send-submission-invite";

export type ScheduledInviteTab = "invite_to" | "invited";
export { formatScheduledInviteDateTime, parseScheduledInviteDateTime } from "@/lib/scheduled-invite-time";

type ScheduledInviteBatchDocument = {
  _id?: ObjectId;
  eventId: ObjectId;
  submissionIds: ObjectId[];
  scheduledAt: Date;
  customMessage: string;
  useEventBanner: boolean;
  tab: ScheduledInviteTab | null;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: Date;
  processedAt?: Date;
  sentCount?: number;
  failCount?: number;
  lastError?: string;
};

function scheduledInvitesCollection() {
  return getDb().then((db) =>
    db.collection<ScheduledInviteBatchDocument>("scheduled_invite_batches")
  );
}

function filterSubmissionsForTab(
  submissions: EventSubmission[],
  eventFormat: string | undefined,
  tab: ScheduledInviteTab
) {
  if (isWaitlistedWebinarFormat(eventFormat)) {
    return submissions.filter(
      (submission) => getWaitlistedSubmissionStage(submission) === tab
    );
  }
  if (isWebinarFormat(eventFormat)) {
    return submissions.filter((submission) => getWebinarSubmissionStage(submission) === tab);
  }
  return [];
}

export async function resolveSubmissionIdsForScheduledInvites(input: {
  eventId: string;
  tab?: ScheduledInviteTab | null;
  submissionIds?: string[];
}) {
  const event = await getEventById(input.eventId);
  if (!event) {
    throw new Error("Event not found.");
  }
  if (!isWebinarFormat(event.eventFormat) && !isWaitlistedWebinarFormat(event.eventFormat)) {
    throw new Error("Scheduled invites are only available for webinar events.");
  }

  if (input.submissionIds?.length) {
    const unique = Array.from(
      new Set(input.submissionIds.map((id) => id.trim()).filter((id) => ObjectId.isValid(id)))
    );
    if (unique.length === 0) {
      throw new Error("No valid submissions selected.");
    }
    return unique;
  }

  const tab = input.tab;
  if (tab !== "invite_to" && tab !== "invited") {
    throw new Error("Choose Invite to or Invited to schedule invites.");
  }

  const submissions = await getSubmissionsByEventId(input.eventId);
  const targets = filterSubmissionsForTab(submissions, event.eventFormat, tab);
  const ids = targets.map((submission) => submission.id).filter(Boolean);
  if (ids.length === 0) {
    throw new Error("No contacts found in the selected tab.");
  }
  return ids;
}

export async function createScheduledInviteBatch(input: {
  eventId: string;
  tab?: ScheduledInviteTab | null;
  submissionIds?: string[];
  scheduledAt: Date;
  customMessage: string;
  useEventBanner: boolean;
}) {
  if (input.scheduledAt.getTime() <= Date.now() + 60_000) {
    throw new Error("Schedule time must be at least 1 minute in the future.");
  }

  const submissionIds = await resolveSubmissionIdsForScheduledInvites({
    eventId: input.eventId,
    tab: input.tab,
    submissionIds: input.submissionIds,
  });

  const collection = await scheduledInvitesCollection();
  const result = await collection.insertOne({
    eventId: new ObjectId(input.eventId),
    submissionIds: submissionIds.map((id) => new ObjectId(id)),
    scheduledAt: input.scheduledAt,
    customMessage: input.customMessage,
    useEventBanner: input.useEventBanner,
    tab: input.tab ?? null,
    status: "pending",
    createdAt: new Date(),
  });

  return {
    id: result.insertedId.toString(),
    submissionCount: submissionIds.length,
    scheduledAt: input.scheduledAt.toISOString(),
  };
}

export async function claimDueScheduledInviteBatches(limit = 20) {
  const collection = await scheduledInvitesCollection();
  const dueBefore = new Date();
  const staleProcessingBefore = new Date(Date.now() - 15 * 60 * 1000);

  await collection.updateMany(
    {
      status: "processing",
      processedAt: { $lte: staleProcessingBefore },
    },
    {
      $set: { status: "pending" },
      $unset: { processedAt: "" },
    }
  );

  const claimed: ScheduledInviteBatchDocument[] = [];

  for (let i = 0; i < limit; i += 1) {
    const batch = await collection.findOneAndUpdate(
      {
        status: "pending",
        scheduledAt: { $lte: dueBefore },
      },
      {
        $set: {
          status: "processing",
          processedAt: new Date(),
        },
      },
      { sort: { scheduledAt: 1 }, returnDocument: "after" }
    );

    if (!batch?._id) {
      break;
    }
    claimed.push(batch);
  }

  return claimed;
}

export async function processScheduledInviteBatch(batch: ScheduledInviteBatchDocument) {
  const collection = await scheduledInvitesCollection();
  const batchId = batch._id;
  if (!batchId) {
    return { sentCount: 0, failCount: 0 };
  }

  const event = await getEventById(batch.eventId.toString());
  if (!event) {
    await collection.updateOne(
      { _id: batchId },
      {
        $set: {
          status: "failed",
          sentCount: 0,
          failCount: batch.submissionIds.length,
          lastError: "Event not found.",
        },
      }
    );
    return { sentCount: 0, failCount: batch.submissionIds.length };
  }

  let sentCount = 0;
  let failCount = 0;
  let lastError = "";

  for (const submissionId of batch.submissionIds) {
    const id = submissionId.toString();
    try {
      await sendSubmissionInviteForEvent(event, id, {
        customMessage: batch.customMessage,
        useEventBanner: batch.useEventBanner,
      });
      sentCount += 1;
    } catch (error) {
      failCount += 1;
      lastError = error instanceof Error ? error.message : "Failed to send invite.";
    }
  }

  await collection.updateOne(
    { _id: batchId },
    {
      $set: {
        status: failCount > 0 && sentCount === 0 ? "failed" : "completed",
        sentCount,
        failCount,
        ...(lastError ? { lastError } : {}),
      },
    }
  );

  return { sentCount, failCount };
}

export async function dispatchDueScheduledInvites(limit = 20) {
  const batches = await claimDueScheduledInviteBatches(limit);
  let sentCount = 0;
  let failCount = 0;

  for (const batch of batches) {
    const result = await processScheduledInviteBatch(batch);
    sentCount += result.sentCount;
    failCount += result.failCount;
  }

  return {
    batchCount: batches.length,
    sentCount,
    failCount,
  };
}
