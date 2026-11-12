import { ObjectId } from "mongodb";
import {
  digitsOnlyPhone,
  phoneMatchKey,
  phonesLikelyMatch,
  toE164Phone,
  type AircallCallDirection,
  type AircallCallRow,
} from "@/lib/aircall";
import type { ContactDoc, ContactProfileTimelineItem } from "@/lib/crm";
import { getDb } from "@/lib/mongodb";

const CALLS_COLLECTION = "aircall_calls";
const AIRCALL_API_BASE = "https://api.aircall.io/v1";

export type AircallCallDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  aircallCallId: number;
  direction: string;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSec: number;
  phone: string;
  phoneDigits: string;
  userName: string;
  numberName: string;
  missedCallReason: string | null;
  recordingUrl: string | null;
  assetUrl: string | null;
  contactId: ObjectId | null;
  contactName: string | null;
  contactEmail: string | null;
  timelineItemId: string | null;
  timelineLoggedAt: Date | null;
  syncedAt: Date;
  raw?: Record<string, unknown>;
};

type AircallApiCall = {
  id?: number;
  direction?: string;
  status?: string;
  started_at?: number | null;
  answered_at?: number | null;
  ended_at?: number | null;
  duration?: number;
  raw_digits?: string | null;
  missed_call_reason?: string | null;
  recording?: string | null;
  voicemail?: string | null;
  asset?: string | null;
  user?: { name?: string | null; email?: string | null } | null;
  number?: { name?: string | null; digits?: string | null } | null;
  contact?: {
    first_name?: string | null;
    last_name?: string | null;
    phone_numbers?: Array<{ value?: string | null }>;
  } | null;
};

function aircallCredentials() {
  const id = (process.env.AIRCALL_API_ID || "").trim();
  const token = (process.env.AIRCALL_API_TOKEN || "").trim();
  if (!id || !token) {
    return null;
  }
  return { id, token };
}

export function aircallConfigured() {
  return Boolean(aircallCredentials());
}

async function aircallFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const creds = aircallCredentials();
  if (!creds) {
    throw new Error(
      "Aircall is not configured. Set AIRCALL_API_ID and AIRCALL_API_TOKEN in the server env.",
    );
  }
  const auth = Buffer.from(`${creds.id}:${creds.token}`).toString("base64");
  const response = await fetch(`${AIRCALL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  const data = (
    text
      ? (JSON.parse(text) as T & { error?: string; message?: string; errors?: unknown })
      : null
  ) as (T & { error?: string; message?: string }) | null;
  if (!response.ok) {
    if (response.status === 405) {
      throw new Error(
        "Aircall user is not available. In the dialer, set status to Available, then try Call again.",
      );
    }
    throw new Error(
      data?.error ||
        data?.message ||
        `Aircall API failed (${response.status})`,
    );
  }
  return (data ?? undefined) as T;
}

type AircallUser = {
  id?: number;
  name?: string;
  email?: string;
  availability_status?: string;
  numbers?: Array<{ id?: number; name?: string; digits?: string }>;
};

async function resolveDialer() {
  const envUserId = Number(process.env.AIRCALL_USER_ID || "");
  const envNumberId = Number(process.env.AIRCALL_NUMBER_ID || "");
  if (Number.isFinite(envUserId) && envUserId > 0 && Number.isFinite(envNumberId) && envNumberId > 0) {
    return { userId: envUserId, numberId: envNumberId, userName: "" };
  }

  const data = await aircallFetch<{ users?: AircallUser[] }>("/users?per_page=50");
  const users = Array.isArray(data?.users) ? data.users : [];
  for (const user of users) {
    const userId = Number(user.id);
    const numberId = Number(user.numbers?.[0]?.id);
    if (Number.isFinite(userId) && userId > 0 && Number.isFinite(numberId) && numberId > 0) {
      return {
        userId,
        numberId,
        userName: String(user.name || user.email || ""),
      };
    }
  }
  throw new Error(
    "No Aircall user with an assigned number found. Set AIRCALL_USER_ID and AIRCALL_NUMBER_ID, or assign a number in Aircall.",
  );
}

/** Start outbound call in Aircall Workspace (desktop). */
export async function startAircallOutboundCall(input: {
  to: string;
  mode?: "start" | "dial";
}) {
  if (!aircallConfigured()) {
    throw new Error(
      "Aircall is not configured. Set AIRCALL_API_ID and AIRCALL_API_TOKEN.",
    );
  }
  const to = toE164Phone(input.to);
  if (!to || to.length < 8) {
    throw new Error("Enter a valid phone number to call.");
  }

  const dialer = await resolveDialer();
  const mode = input.mode === "dial" ? "dial" : "start";

  if (mode === "dial") {
    await aircallFetch(`/users/${dialer.userId}/dial`, {
      method: "POST",
      body: JSON.stringify({ to }),
    });
    return {
      ok: true as const,
      mode: "dial" as const,
      to,
      userId: dialer.userId,
      numberId: dialer.numberId,
      userName: dialer.userName,
      detail: "Number opened in Aircall Workspace — press Call there.",
    };
  }

  await aircallFetch(`/users/${dialer.userId}/calls`, {
    method: "POST",
    body: JSON.stringify({ number_id: dialer.numberId, to }),
  });
  return {
    ok: true as const,
    mode: "start" as const,
    to,
    userId: dialer.userId,
    numberId: dialer.numberId,
    userName: dialer.userName,
    detail: "Call started in Aircall Workspace.",
  };
}

function unixToDate(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) {
    return null;
  }
  return new Date(value * 1000);
}

function newTimelineId(aircallCallId: number) {
  return `aircall-${aircallCallId}`;
}

function contactPhones(doc: ContactDoc) {
  const values = [
    doc.profile?.phone,
    doc.attributes?.phoneNumber,
    doc.attributes?.phone,
    doc.attributes?.mobile,
    doc.attributes?.Phone,
  ];
  return values.map((value) => String(value || "").trim()).filter(Boolean);
}

function flexiblePhoneRegex(key: string) {
  // Allow spaces/dashes/parens between digits so "+91 98765-43210" still matches.
  const pattern = `${key.split("").join("\\D*")}\\D*$`;
  return new RegExp(pattern);
}

async function findContactByPhone(projectId: ObjectId, phone: string) {
  const key = phoneMatchKey(phone);
  if (!key) {
    return null;
  }

  const db = await getDb();
  const regex = flexiblePhoneRegex(key);
  const candidates = await db
    .collection<ContactDoc>("contacts")
    .find({
      projectId,
      $or: [
        { "profile.phone": { $regex: regex } },
        { "attributes.phoneNumber": { $regex: regex } },
        { "attributes.phone": { $regex: regex } },
        { "attributes.mobile": { $regex: regex } },
      ],
    })
    .limit(40)
    .toArray();

  for (const candidate of candidates) {
    if (contactPhones(candidate).some((value) => phonesLikelyMatch(value, phone))) {
      return candidate;
    }
  }

  return null;
}

async function findContactsAcrossProjectsByPhone(phone: string) {
  const key = phoneMatchKey(phone);
  if (!key) {
    return [] as ContactDoc[];
  }
  const db = await getDb();
  const regex = flexiblePhoneRegex(key);
  const candidates = await db
    .collection<ContactDoc>("contacts")
    .find({
      $or: [
        { "profile.phone": { $regex: regex } },
        { "attributes.phoneNumber": { $regex: regex } },
        { "attributes.phone": { $regex: regex } },
        { "attributes.mobile": { $regex: regex } },
      ],
    })
    .limit(100)
    .toArray();

  return candidates.filter((candidate) =>
    contactPhones(candidate).some((value) => phonesLikelyMatch(value, phone)),
  );
}

function mapCallRow(doc: AircallCallDoc): AircallCallRow {
  const id = doc._id.toString();
  return {
    id,
    aircallCallId: doc.aircallCallId,
    direction: doc.direction,
    status: doc.status,
    startedAt: doc.startedAt?.toISOString() ?? null,
    endedAt: doc.endedAt?.toISOString() ?? null,
    durationSec: doc.durationSec || 0,
    phone: doc.phone,
    phoneDigits: doc.phoneDigits,
    userName: doc.userName,
    numberName: doc.numberName,
    missedCallReason: doc.missedCallReason,
    hasRecording: Boolean(doc.recordingUrl || doc.assetUrl),
    recordingProxyUrl: doc.recordingUrl
      ? `/api/aircall/calls/${doc.aircallCallId}/recording`
      : null,
    assetUrl: doc.assetUrl,
    contactId: doc.contactId?.toString() ?? null,
    contactName: doc.contactName,
    contactEmail: doc.contactEmail,
    timelineLogged: Boolean(doc.timelineLoggedAt),
    syncedAt: doc.syncedAt.toISOString(),
  };
}

function buildTimelineBody(input: {
  direction: string;
  durationSec: number;
  userName: string;
  phone: string;
  missedCallReason: string | null;
  status: string;
}) {
  const dir =
    input.direction === "inbound"
      ? "Inbound"
      : input.direction === "outbound"
        ? "Outbound"
        : input.direction || "Call";
  const parts = [
    `Aircall ${dir.toLowerCase()} call`,
    input.phone ? `with ${input.phone}` : null,
    input.userName ? `via ${input.userName}` : null,
    input.durationSec > 0 ? `(${Math.round(input.durationSec)}s)` : null,
  ].filter(Boolean);
  let body = parts.join(" ");
  if (input.missedCallReason) {
    body += ` · Missed: ${input.missedCallReason}`;
  } else if (input.status && input.status !== "done") {
    body += ` · ${input.status}`;
  }
  return body;
}

async function ensureIndexes() {
  const db = await getDb();
  const collection = db.collection<AircallCallDoc>(CALLS_COLLECTION);
  await Promise.all([
    collection.createIndex(
      { projectId: 1, aircallCallId: 1 },
      { unique: true },
    ),
    collection.createIndex({ projectId: 1, startedAt: -1 }),
    collection.createIndex({ projectId: 1, phoneDigits: 1 }),
  ]);
}

async function appendCallToContactTimeline(input: {
  projectId: ObjectId;
  contact: ContactDoc;
  aircallCallId: number;
  direction: string;
  durationSec: number;
  userName: string;
  phone: string;
  missedCallReason: string | null;
  status: string;
  startedAt: Date | null;
  hasRecording: boolean;
}) {
  const timelineId = newTimelineId(input.aircallCallId);
  const existing = input.contact.profile?.timeline || [];
  if (existing.some((item) => item.id === timelineId || item.aircallCallId === input.aircallCallId)) {
    return timelineId;
  }

  const entry: ContactProfileTimelineItem = {
    id: timelineId,
    at: (input.startedAt || new Date()).toISOString(),
    body: buildTimelineBody(input),
    kind: "call",
    aircallCallId: input.aircallCallId,
    direction: input.direction,
    durationSec: input.durationSec,
    recordingUrl: input.hasRecording
      ? `/api/aircall/calls/${input.aircallCallId}/recording`
      : undefined,
  };

  const db = await getDb();
  // Some contacts have profile.timeline = null (not []). $push fails on null,
  // so normalize with a pipeline update and prepend the new entry.
  await db.collection("contacts").updateOne(
    { _id: input.contact._id, projectId: input.projectId },
    [
      {
        $set: {
          profile: { $ifNull: ["$profile", {}] },
          updatedAt: new Date(),
        },
      },
      {
        $set: {
          "profile.timeline": {
            $concatArrays: [
              [entry],
              {
                $cond: [
                  { $isArray: "$profile.timeline" },
                  "$profile.timeline",
                  [],
                ],
              },
            ],
          },
        },
      },
    ],
  );
  return timelineId;
}

function parseAircallCall(raw: AircallApiCall) {
  const aircallCallId = Number(raw.id);
  if (!Number.isFinite(aircallCallId) || aircallCallId <= 0) {
    return null;
  }
  const phone = String(raw.raw_digits || "").trim();
  const recordingUrl = String(raw.recording || raw.voicemail || "").trim() || null;
  return {
    aircallCallId,
    direction: (raw.direction || "outbound") as AircallCallDirection | string,
    status: String(raw.status || ""),
    startedAt: unixToDate(raw.started_at),
    endedAt: unixToDate(raw.ended_at),
    durationSec: Number(raw.duration) || 0,
    phone,
    phoneDigits: digitsOnlyPhone(phone),
    userName: String(raw.user?.name || raw.user?.email || "").trim(),
    numberName: String(raw.number?.name || raw.number?.digits || "").trim(),
    missedCallReason: raw.missed_call_reason
      ? String(raw.missed_call_reason)
      : null,
    recordingUrl,
    assetUrl: String(raw.asset || "").trim() || null,
    raw: raw as Record<string, unknown>,
  };
}

export async function upsertAircallCallForProject(
  projectId: ObjectId,
  rawCall: AircallApiCall,
) {
  await ensureIndexes();
  const parsed = parseAircallCall(rawCall);
  if (!parsed) {
    return null;
  }

  const db = await getDb();
  const contact = parsed.phone
    ? await findContactByPhone(projectId, parsed.phone)
    : null;

  // Only CRM-matched numbers belong in a project. Drop unmatched leftovers.
  if (!contact) {
    await db.collection<AircallCallDoc>(CALLS_COLLECTION).deleteOne({
      projectId,
      aircallCallId: parsed.aircallCallId,
    });
    return null;
  }

  const timelineItemId = await appendCallToContactTimeline({
    projectId,
    contact,
    aircallCallId: parsed.aircallCallId,
    direction: parsed.direction,
    durationSec: parsed.durationSec,
    userName: parsed.userName,
    phone: parsed.phone,
    missedCallReason: parsed.missedCallReason,
    status: parsed.status,
    startedAt: parsed.startedAt,
    hasRecording: Boolean(parsed.recordingUrl || parsed.assetUrl),
  });
  const timelineLoggedAt = new Date();
  const now = new Date();
  const contactName =
    `${contact.firstName || ""} ${contact.lastName || ""}`.trim() ||
    contact.email;

  await db.collection<AircallCallDoc>(CALLS_COLLECTION).updateOne(
    { projectId, aircallCallId: parsed.aircallCallId },
    {
      $set: {
        projectId,
        aircallCallId: parsed.aircallCallId,
        direction: parsed.direction,
        status: parsed.status,
        startedAt: parsed.startedAt,
        endedAt: parsed.endedAt,
        durationSec: parsed.durationSec,
        phone: parsed.phone,
        phoneDigits: parsed.phoneDigits,
        userName: parsed.userName,
        numberName: parsed.numberName,
        missedCallReason: parsed.missedCallReason,
        recordingUrl: parsed.recordingUrl,
        assetUrl: parsed.assetUrl,
        contactId: contact._id,
        contactName,
        contactEmail: contact.email ?? null,
        timelineItemId,
        timelineLoggedAt,
        syncedAt: now,
        raw: parsed.raw,
      },
      $setOnInsert: { _id: new ObjectId() },
    },
    { upsert: true },
  );

  const saved = await db.collection<AircallCallDoc>(CALLS_COLLECTION).findOne({
    projectId,
    aircallCallId: parsed.aircallCallId,
  });
  return saved ? mapCallRow(saved) : null;
}

/** Webhook: attach call to every project contact that matches the phone. */
export async function ingestAircallWebhookCall(rawCall: AircallApiCall) {
  const parsed = parseAircallCall(rawCall);
  if (!parsed) {
    return { matched: 0, rows: [] as AircallCallRow[] };
  }

  const contacts = parsed.phone
    ? await findContactsAcrossProjectsByPhone(parsed.phone)
    : [];

  if (contacts.length === 0) {
    // Still store nothing project-specific without a match; sync page handles backfill.
    return { matched: 0, rows: [] as AircallCallRow[] };
  }

  const rows: AircallCallRow[] = [];
  const seenProjects = new Set<string>();
  for (const contact of contacts) {
    const key = contact.projectId.toString();
    if (seenProjects.has(key)) {
      continue;
    }
    seenProjects.add(key);
    const row = await upsertAircallCallForProject(contact.projectId, rawCall);
    if (row) {
      rows.push(row);
    }
  }
  return { matched: rows.length, rows };
}

export async function listProjectAircallCalls(
  projectId: ObjectId,
  options?: { limit?: number },
) {
  await ensureIndexes();
  const limit = Math.min(200, Math.max(1, options?.limit ?? 200));
  const db = await getDb();
  const docs = await db
    .collection<AircallCallDoc>(CALLS_COLLECTION)
    .find({ projectId, contactId: { $ne: null } })
    .sort({ startedAt: -1, syncedAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map(mapCallRow);
}

export async function syncAircallCallsForProject(
  projectId: ObjectId,
  options?: { perPage?: number },
) {
  const target = Math.min(200, Math.max(1, options?.perPage ?? 200));
  // Aircall typically caps a single page around 50 — page until we hit target.
  const pageSize = Math.min(50, target);
  const calls: AircallApiCall[] = [];
  let page = 1;
  while (calls.length < target) {
    const data = await aircallFetch<{
      calls?: AircallApiCall[];
      meta?: { next_page_link?: string | null; count?: number };
    }>(
      `/calls/search?per_page=${pageSize}&page=${page}&order=desc&fetch_contact=true`,
    );
    const batch = Array.isArray(data.calls) ? data.calls : [];
    if (batch.length === 0) {
      break;
    }
    calls.push(...batch);
    if (batch.length < pageSize || !data.meta?.next_page_link) {
      break;
    }
    page += 1;
    if (page > 10) {
      break;
    }
  }
  const limited = calls.slice(0, target);

  const rows: AircallCallRow[] = [];
  let matchedContacts = 0;
  let skippedUnmatched = 0;
  for (const call of limited) {
    const row = await upsertAircallCallForProject(projectId, call);
    if (row?.contactId) {
      rows.push(row);
      matchedContacts += 1;
    } else {
      skippedUnmatched += 1;
    }
  }

  // Clean any old unmatched rows left from earlier syncs.
  const db = await getDb();
  await db.collection<AircallCallDoc>(CALLS_COLLECTION).deleteMany({
    projectId,
    $or: [{ contactId: null }, { contactId: { $exists: false } }],
  });

  return {
    fetched: limited.length,
    matchedContacts,
    skippedUnmatched,
    calls: rows,
  };
}

export async function getFreshAircallRecordingUrl(aircallCallId: number) {
  const data = await aircallFetch<{ call?: AircallApiCall }>(
    `/calls/${aircallCallId}`,
  );
  const call = data.call;
  const url = String(call?.recording || call?.voicemail || "").trim();
  if (!url) {
    throw new Error("No recording available for this call.");
  }
  return url;
}

export async function getProjectAircallCall(
  projectId: ObjectId,
  aircallCallId: number,
) {
  const db = await getDb();
  return db.collection<AircallCallDoc>(CALLS_COLLECTION).findOne({
    projectId,
    aircallCallId,
  });
}
