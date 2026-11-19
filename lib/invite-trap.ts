import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { PUBLIC_APP_ORIGIN } from "@/lib/campaign-tracking";
import { getDb } from "@/lib/mongodb";

type TrapSubmission = {
  _id: ObjectId;
  eventId: ObjectId;
  trapToken?: string;
  botClick?: boolean;
};

function trapSubmissions() {
  return getDb().then((db) => db.collection<TrapSubmission>("event_submissions"));
}

export async function ensureSubmissionTrapToken(eventId: string, submissionId: string) {
  if (!ObjectId.isValid(eventId) || !ObjectId.isValid(submissionId)) {
    return "";
  }
  const collection = await trapSubmissions();
  const existing = await collection.findOne({
    _id: new ObjectId(submissionId),
    eventId: new ObjectId(eventId),
  });
  if (!existing) return "";
  if (existing.trapToken) return existing.trapToken;
  const trapToken = randomBytes(16).toString("hex");
  await collection.updateOne({ _id: existing._id }, { $set: { trapToken } });
  return trapToken;
}

export function inviteClickTrapUrl(token: string) {
  const cleaned = token.trim();
  if (!cleaned) return "";
  return `${PUBLIC_APP_ORIGIN}/api/events/invite-trap/${cleaned}`;
}

export async function markSubmissionBotClick(token: string) {
  const cleaned = token.trim();
  if (!cleaned) return false;
  const collection = await trapSubmissions();
  const existing = await collection.findOne(
    { trapToken: cleaned },
    { projection: { _id: 1, botClick: 1 } },
  );
  if (!existing) return false;
  if (!existing.botClick) {
    await collection.updateOne(
      { _id: existing._id },
      { $set: { botClick: true, botClickedAt: new Date() } },
    );
  }
  return true;
}
