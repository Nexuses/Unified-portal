import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

const MAX_SIGNATURE_LENGTH = 200_000;

type InboxSignatureDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  senderId: ObjectId;
  html: string;
  autoAdd: boolean;
  updatedBy: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

export type InboxSignature = {
  senderId: string;
  html: string;
  autoAdd: boolean;
  updatedAt: string;
};

function toSignature(doc: InboxSignatureDoc): InboxSignature {
  return {
    senderId: doc.senderId.toString(),
    html: doc.html,
    autoAdd: doc.autoAdd,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

let indexReady: Promise<string> | null = null;

async function signatures() {
  const db = await getDb();
  const collection = db.collection<InboxSignatureDoc>("inbox_signatures");
  indexReady ??= collection.createIndex({ projectId: 1, senderId: 1 }, { unique: true });
  await indexReady;
  return collection;
}

async function assertProjectSender(projectId: ObjectId, senderId: string) {
  if (!ObjectId.isValid(senderId)) {
    throw new Error("Choose an inbox for this signature");
  }
  const db = await getDb();
  const sender = await db
    .collection("smtp_senders")
    .findOne({ _id: new ObjectId(senderId), projectId }, { projection: { _id: 1 } });
  if (!sender) {
    throw new Error("Inbox not found in this project");
  }
  return sender._id as ObjectId;
}

export async function listInboxSignatures(projectId: ObjectId) {
  const docs = await (await signatures()).find({ projectId }).toArray();
  return docs.map(toSignature);
}

export async function saveInboxSignature(
  projectId: ObjectId,
  userId: ObjectId | null,
  input: { senderId: string; html: string; autoAdd: boolean },
) {
  const html = input.html.trim();
  if (!html) {
    throw new Error("Signature is empty");
  }
  if (html.length > MAX_SIGNATURE_LENGTH) {
    throw new Error("Signature is too large. Use image links instead of pasted images.");
  }
  const senderId = await assertProjectSender(projectId, input.senderId);
  const now = new Date();
  const doc = await (await signatures()).findOneAndUpdate(
    { projectId, senderId },
    {
      $set: { html, autoAdd: input.autoAdd, updatedBy: userId, updatedAt: now },
      $setOnInsert: { projectId, senderId, createdAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!doc) {
    throw new Error("Failed to save signature");
  }
  return toSignature(doc);
}

export async function deleteInboxSignature(projectId: ObjectId, senderId: string) {
  if (!ObjectId.isValid(senderId)) {
    return;
  }
  await (await signatures()).deleteOne({ projectId, senderId: new ObjectId(senderId) });
}
