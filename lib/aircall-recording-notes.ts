import { ObjectId, type Filter } from "mongodb";
import type { AircallCallInterest, AircallCallRow } from "@/lib/aircall";
import { getDb } from "@/lib/mongodb";
import {
  getFreshAircallRecordingUrl,
  type AircallCallDoc,
} from "@/lib/aircall-server";

const CALLS_COLLECTION = "aircall_calls";
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const STALE_LOCK_MS = 3 * 60 * 1000;

function openaiKey() {
  return (process.env.OPENAI_API_KEY || "").trim().replace(/[>\s]+$/g, "");
}

type SummaryCallDoc = AircallCallDoc & { recordingSummaryStartedAt?: Date | null };

function interestFilter(projectId: ObjectId): Filter<SummaryCallDoc> {
  return {
    projectId,
    recordingSummary: { $type: "string", $nin: ["", null] },
    $or: [
      { recordingInterest: { $exists: false } },
      { recordingInterest: null },
      { recordingInterest: "" },
    ],
  } as Filter<SummaryCallDoc>;
}

function pendingFilter(projectId: ObjectId, now = new Date()): Filter<SummaryCallDoc> {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  return {
    projectId,
    recordingUrl: { $type: "string", $nin: ["", null] },
    $and: [
      {
        $or: [
          { recordingSummary: { $exists: false } },
          { recordingSummary: null },
          { recordingSummary: "" },
        ],
      },
      {
        $or: [
          { recordingSummaryError: { $exists: false } },
          { recordingSummaryError: null },
          { recordingSummaryError: "" },
        ],
      },
      {
        $or: [
          { recordingSummaryStartedAt: { $exists: false } },
          { recordingSummaryStartedAt: null },
          { recordingSummaryStartedAt: { $lt: staleBefore } },
        ],
      },
    ],
  } as Filter<SummaryCallDoc>;
}

async function transcribe(apiKey: string, audio: Buffer, contentType: string) {
  const file = new File([new Uint8Array(audio)], "call.mp3", {
    type: contentType || "audio/mpeg",
  });
  const form = new FormData();
  form.append("file", file, "call.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const data = (await response.json().catch(() => null)) as {
    text?: string;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(data?.error?.message || `Transcription failed (${response.status})`);
  }
  return String(data?.text || "").trim();
}

function asInterest(value: unknown): AircallCallInterest {
  if (value === "interested" || value === "not_interested" || value === "normal") {
    return value;
  }
  return "normal";
}

function parseModelJson(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as { summary?: unknown; interest?: unknown };
  } catch {
    return null;
  }
}

async function complete(apiKey: string, system: string, user: string, maxTokens: number) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(data?.error?.message || `Summary failed (${response.status})`);
  }
  return parseModelJson(String(data?.choices?.[0]?.message?.content || ""));
}

const INTEREST_RULES =
  "interest is interested only when the other person wants to continue, book a meeting, see a demo, get a proposal, or buy. interest is not_interested when they decline, say they are not looking, already have a solution, or ask not to be contacted. interest is normal for voicemail, silence, hold music, small talk, logistics, or no clear yes or no. A polite greeting is normal.";

async function summarise(apiKey: string, transcript: string) {
  const parsed = await complete(
    apiKey,
    `Return JSON {"summary":"...","interest":"interested"|"not_interested"|"normal"}. summary is one or two short sentences in plain language, with no bullet points. If it is silence, a busy tone, hold music, or only a voicemail greeting, say that clearly. ${INTEREST_RULES}`,
    transcript.slice(0, 12000),
    220,
  );
  const summary = String(parsed?.summary || "").trim();
  return { summary, interest: asInterest(parsed?.interest) };
}

async function classifyInterest(apiKey: string, summary: string) {
  const parsed = await complete(
    apiKey,
    `Return JSON {"interest":"interested"|"not_interested"|"normal"}. ${INTEREST_RULES}`,
    summary.slice(0, 2000),
    40,
  );
  return asInterest(parsed?.interest);
}

async function mapSaved(projectId: ObjectId, aircallCallId: number) {
  const { listProjectAircallCalls } = await import("@/lib/aircall-server");
  const rows = await listProjectAircallCalls(projectId, { limit: 200 });
  return rows.find((row) => row.aircallCallId === aircallCallId) ?? null;
}

/** Transcribe and summarise the next recording in this project that has no notes yet. */
export async function summariseNextCallRecording(projectId: ObjectId): Promise<{
  call: AircallCallRow | null;
  remaining: number;
}> {
  const apiKey = openaiKey();
  const db = await getDb();
  const collection = db.collection<SummaryCallDoc>(CALLS_COLLECTION);
  const [summaryRemaining, interestRemaining] = await Promise.all([
    collection.countDocuments(pendingFilter(projectId)),
    collection.countDocuments(interestFilter(projectId)),
  ]);
  if (!summaryRemaining && !interestRemaining) {
    return { call: null, remaining: 0 };
  }
  if (!apiKey) {
    throw new Error("Recording summaries need OPENAI_API_KEY.");
  }

  if (interestRemaining) {
    const existing = await collection.findOne(interestFilter(projectId), {
      sort: { startedAt: -1 },
    });
    if (existing?.recordingSummary) {
      const interest = await classifyInterest(apiKey, existing.recordingSummary);
      await collection.updateOne(
        { _id: existing._id },
        { $set: { recordingInterest: interest } },
      );
      const call = await mapSaved(projectId, existing.aircallCallId);
      const remaining =
        (await collection.countDocuments(pendingFilter(projectId))) +
        (await collection.countDocuments(interestFilter(projectId)));
      return { call, remaining };
    }
  }

  const now = new Date();
  const doc = await collection.findOneAndUpdate(
    pendingFilter(projectId, now),
    { $set: { recordingSummaryStartedAt: now } },
    { sort: { startedAt: -1 }, returnDocument: "after" },
  );
  if (!doc) {
    return { call: null, remaining: 0 };
  }

  try {
    const remoteUrl = await getFreshAircallRecordingUrl(doc.aircallCallId);
    const audio = await fetch(remoteUrl, { cache: "no-store" });
    if (!audio.ok) {
      throw new Error(`Could not download recording (${audio.status})`);
    }
    const buffer = Buffer.from(await audio.arrayBuffer());
    if (buffer.byteLength > MAX_AUDIO_BYTES) {
      throw new Error("Recording is too long to summarise.");
    }
    const transcript = await transcribe(
      apiKey,
      buffer,
      audio.headers.get("content-type") || "audio/mpeg",
    );
    const noted = transcript
      ? await summarise(apiKey, transcript)
      : { summary: "Recording had no speech to summarise.", interest: "normal" as const };
    if (!noted.summary) {
      throw new Error("Summary came back empty.");
    }
    await collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          recordingSummary: noted.summary,
          recordingInterest: noted.interest,
        },
        $unset: { recordingSummaryError: "", recordingSummaryStartedAt: "" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not summarise recording";
    await collection.updateOne(
      { _id: doc._id },
      {
        $set: { recordingSummaryError: message.slice(0, 300) },
        $unset: { recordingSummaryStartedAt: "" },
      },
    );
  }

  const call = await mapSaved(projectId, doc.aircallCallId);
  const remaining =
    (await collection.countDocuments(pendingFilter(projectId))) +
    (await collection.countDocuments(interestFilter(projectId)));
  return { call, remaining };
}
