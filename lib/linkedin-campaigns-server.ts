import { ObjectId } from "mongodb";
import {
  boatConfigured,
  ensureProjectBoat,
  isBoatRunning,
  openBoatDesktop,
  runBoatCommand,
  runBoatDesktopTask,
  shellQuote,
  getBoatTaskReport,
} from "@/lib/boat";
import { getDb } from "@/lib/mongodb";
import {
  launchLinkedinStage,
  linkedinBoardColumns,
  parseLinkedinCsv,
  type LinkedinCampaign,
  type LinkedinCampaignDetail,
  type LinkedinContact,
  type LinkedinSession,
} from "@/lib/linkedin-campaigns";

const LINKEDIN_PROFILE = "LinkedIn";

async function assertLinkedinComputerFree(projectId: ObjectId) {
  const db = await getDb();
  const lock = await db.collection<{ campaignName?: string }>("boat_desktop_locks").findOne({ projectId });
  if (!lock?.campaignName) return;
  throw new Error(
    `The LinkedIn computer is busy with cloud campaign "${lock.campaignName}". Pause or finish that campaign first.`,
  );
}

/** LinkedIn's own Chrome window. Fills the 1920×1080 desktop so the view is not a small window on a blank screen. */
async function openLinkedinChrome(sandboxId: string, url: string, restart: boolean) {
  const directory = shellQuote(LINKEDIN_PROFILE);
  const target = shellQuote(url);
  const restartCmd = restart
    ? "pkill -f google-chrome-stable >/dev/null 2>&1 || true; sleep 0.4;"
    : "";
  const command = [
    "if ! command -v google-chrome-stable >/dev/null; then echo chrome-missing; exit 1; fi;",
    restartCmd,
    "if command -v python3 >/dev/null; then python3 - <<'PY'",
    "import json, os",
    "path = os.path.expanduser('~/.config/google-chrome/Local State')",
    "os.makedirs(os.path.dirname(path), exist_ok=True)",
    "data = {}",
    "if os.path.exists(path):",
    "    try:",
    "        with open(path) as handle:",
    "            loaded = json.load(handle)",
    "        if isinstance(loaded, dict):",
    "            data = loaded",
    "    except Exception:",
    "        data = {}",
    "intl = data.get('intl') if isinstance(data.get('intl'), dict) else {}",
    "intl['app_locale'] = 'en-US'",
    "intl['accept_languages'] = 'en-US,en'",
    "data['intl'] = intl",
    "with open(path, 'w') as handle:",
    "    json.dump(data, handle)",
    "PY",
    "fi;",
    `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LANGUAGE=en_US:en DISPLAY=:0 nohup google-chrome-stable --no-first-run --start-maximized --window-position=0,0 --window-size=1920,1080 --lang=en-US --accept-lang=en-US,en --profile-directory=${directory} --new-window ${target}`,
    ">/tmp/boat-chrome-linkedin.log 2>&1 &",
    "(sleep 1; DISPLAY=:0 wmctrl -lx | while read -r id _desk _host class _; do case \"$class\" in *hrome*) wmctrl -i -r \"$id\" -b add,maximized_vert,maximized_horz ;; esac; done) >/dev/null 2>&1 & echo started",
  ].join(" ");
  return runBoatCommand(sandboxId, command, 20);
}

async function fillLinkedinChrome(sandboxId: string) {
  const command = [
    "DISPLAY=:0 wmctrl -lx | while read -r id _desk _host class _; do",
    "case \"$class\" in *hrome*) wmctrl -i -r \"$id\" -e 0,0,0,1920,1080; wmctrl -i -r \"$id\" -b add,maximized_vert,maximized_horz ;; esac;",
    "done; echo filled",
  ].join(" ");
  await runBoatCommand(sandboxId, command, 15).catch(() => null);
}

type SessionDoc = {
  projectId: ObjectId;
  connected: boolean;
  accountName: string;
  connectedAt?: Date;
  updatedAt: Date;
};

type PersonDoc = {
  id?: string;
  name: string;
  linkedinUrl: string;
  messages: string[];
  stage?: string;
  alreadyConnected?: boolean;
  connectedAt?: Date;
  nextActionAt?: Date;
  messagesSent?: number;
  replyCheckedAt?: Date;
  statusNote?: string;
};

type CampaignDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  name: string;
  status: "running" | "complete";
  messageLabels: string[];
  delayAfterAcceptDays: number;
  delayAfterMessageDays: number;
  people: PersonDoc[];
  boatPromptId?: string;
  boatConversationId?: string | null;
  relationshipSynced?: boolean;
  customStages?: { id: string; label: string }[];
  activePromptId?: string;
  activePromptAt?: Date;
  activeTargets?: string[];
  connectionCheckAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

let indexed = false;

async function sessions() {
  const db = await getDb();
  const collection = db.collection<SessionDoc>("linkedin_sessions");
  if (!indexed) {
    await collection.createIndex({ projectId: 1 }, { unique: true });
    await db.collection("linkedin_campaigns").createIndex({ projectId: 1, createdAt: -1 });
    indexed = true;
  }
  return collection;
}

function mapSession(doc: SessionDoc | null, boatReady: boolean): LinkedinSession {
  return {
    connected: doc?.connected === true,
    accountName: doc?.accountName || "",
    connectedAt: doc?.connectedAt?.toISOString(),
    boatReady,
  };
}

export async function getLinkedinSession(projectId: ObjectId) {
  const collection = await sessions();
  const doc = await collection.findOne({ projectId });
  return mapSession(doc, boatConfigured());
}

export async function openLinkedinComputer(projectId: ObjectId) {
  if (!boatConfigured()) {
    throw new Error("The virtual machine is not set up yet.");
  }
  await assertLinkedinComputerFree(projectId);
  const sandbox = await ensureProjectBoat(projectId);
  if (!isBoatRunning(sandbox.state)) {
    throw new Error(`The computer is ${sandbox.state}. Try again in a few seconds.`);
  }
  const collection = await sessions();
  const saved = await collection.findOne({ projectId });
  const stillConnected = saved?.connected === true && sandbox.replacedDeletedDisk !== true;
  const url = stillConnected
    ? "https://www.linkedin.com/feed/"
    : "https://www.linkedin.com/login";
  await openLinkedinChrome(sandbox.id, url, true);
  const desktopUrl = await openBoatDesktop(sandbox.id);
  if (!stillConnected && saved?.connected) {
    await collection.updateOne(
      { projectId },
      { $set: { connected: false, updatedAt: new Date() }, $unset: { connectedAt: "" } },
    );
  }
  const session = await getLinkedinSession(projectId);
  return { desktopUrl, session };
}

/** Open the LinkedIn screen without restarting Chrome, and stretch Chrome to the full desktop. */
export async function watchLinkedinComputer(projectId: ObjectId) {
  if (!boatConfigured()) {
    throw new Error("The virtual machine is not set up yet.");
  }
  const sandbox = await ensureProjectBoat(projectId);
  if (!isBoatRunning(sandbox.state)) {
    throw new Error(`The computer is ${sandbox.state}. Try again in a few seconds.`);
  }
  await fillLinkedinChrome(sandbox.id);
  const desktopUrl = await openBoatDesktop(sandbox.id);
  return { desktopUrl };
}

export async function confirmLinkedinLogin(projectId: ObjectId, accountName: string) {
  const collection = await sessions();
  const now = new Date();
  const name = accountName.trim().slice(0, 80);
  await collection.updateOne(
    { projectId },
    {
      $set: {
        connected: true,
        accountName: name,
        connectedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { projectId },
    },
    { upsert: true },
  );
  return getLinkedinSession(projectId);
}

function personStage(person: PersonDoc) {
  if (person.stage) return person.stage;
  return person.alreadyConnected ? "connected" : "request_sent";
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function stageCounts(people: PersonDoc[]) {
  let requestCount = 0;
  let connectedCount = 0;
  let messageCount = 0;
  for (const person of people) {
    const stage = personStage(person);
    if (stage === "request_sent") requestCount += 1;
    if (stage === "connected" || stage.startsWith("message_")) connectedCount += 1;
    if (stage.startsWith("message_")) messageCount += 1;
  }
  return { requestCount, connectedCount, messageCount };
}

function messagesNeeded(person: PersonDoc) {
  return person.messages.filter((message) => message.trim()).length;
}

/** A person is finished once their messages are sent, they reply, or they reject the request. */
function personSettled(person: PersonDoc) {
  const stage = personStage(person);
  if (stage === "connection_rejected" || stage === "reply" || stage.startsWith("custom_")) return true;
  const needed = messagesNeeded(person);
  return needed > 0 && (person.messagesSent || 0) >= needed;
}

function campaignStatus(people: PersonDoc[]): "running" | "complete" {
  if (!people.length || people.some((person) => !personSettled(person))) return "running";
  return "complete";
}

function mapCampaign(doc: CampaignDoc): LinkedinCampaign {
  const counts = stageCounts(doc.people);
  return {
    id: doc._id.toString(),
    name: doc.name,
    status: campaignStatus(doc.people),
    messageLabels: doc.messageLabels,
    delayAfterAcceptDays: doc.delayAfterAcceptDays,
    delayAfterMessageDays: doc.delayAfterMessageDays,
    peopleCount: doc.people.length,
    requestCount: counts.requestCount,
    connectedCount: counts.connectedCount,
    messageCount: counts.messageCount,
    createdAt: doc.createdAt.toISOString(),
  };
}

function mapContact(person: PersonDoc, index: number): LinkedinContact {
  const stage = personStage(person);
  const messageIndex = stage.startsWith("message_")
    ? Number(stage.slice("message_".length)) - 1
    : -1;
  return {
    id: person.id || `p${index + 1}`,
    name: person.name,
    linkedinUrl: person.linkedinUrl,
    stage,
    alreadyConnected: person.alreadyConnected === true,
    message: messageIndex >= 0 ? person.messages[messageIndex] || "" : "",
    note: person.statusNote || "",
  };
}

export async function getLinkedinCampaign(projectId: ObjectId, id: string) {
  if (!ObjectId.isValid(id)) return null;
  await sessions();
  const db = await getDb();
  const doc = await db.collection<CampaignDoc>("linkedin_campaigns").findOne({
    _id: new ObjectId(id),
    projectId,
  });
  if (!doc) return null;
  const detail: LinkedinCampaignDetail = {
    ...mapCampaign(doc),
    columns: linkedinBoardColumns(doc.messageLabels, doc.customStages || []),
    contacts: doc.people.map(mapContact),
    sending: Boolean(doc.activePromptId),
  };
  return detail;
}

export async function listLinkedinCampaigns(projectId: ObjectId) {
  await sessions();
  const db = await getDb();
  const docs = await db
    .collection<CampaignDoc>("linkedin_campaigns")
    .find({ projectId })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  return docs.map(mapCampaign);
}

function readDelay(value: unknown, label: string) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 90) {
    throw new Error(`${label} needs a whole number of days from 0 to 90.`);
  }
  return days;
}

export async function startLinkedinCampaign(
  projectId: ObjectId,
  input: {
    name?: string;
    csv?: string;
    delayAfterAcceptDays?: number;
    delayAfterMessageDays?: number;
  },
) {
  const session = await getLinkedinSession(projectId);
  if (!session.connected) {
    throw new Error("Log in to LinkedIn on the virtual machine first. That login stays connected.");
  }
  const name = String(input.name || "").trim().slice(0, 120);
  if (!name) throw new Error("Name the campaign.");
  const preview = parseLinkedinCsv(String(input.csv || ""));
  if (!preview.messageLabels.length) {
    throw new Error("The CSV needs columns such as Message 1 and Message 2.");
  }
  if (!preview.people.length) {
    throw new Error("The CSV needs a LinkedIn account column and at least one profile.");
  }
  const delayAfterAcceptDays = readDelay(
    input.delayAfterAcceptDays,
    "Days after they accept",
  );
  const delayAfterMessageDays =
    preview.messageLabels.length > 1
      ? readDelay(input.delayAfterMessageDays, "Days after message 1")
      : 0;

  const now = new Date();
  const db = await getDb();
  const result = await db.collection<CampaignDoc>("linkedin_campaigns").insertOne({
    _id: new ObjectId(),
    projectId,
    name,
    status: "running",
    messageLabels: preview.messageLabels,
    delayAfterAcceptDays,
    delayAfterMessageDays,
    people: preview.people.map((person, index) => {
      const alreadyConnected = person.alreadyConnected === true;
      return {
        id: `p${index + 1}`,
        name: person.name,
        linkedinUrl: person.linkedinUrl,
        messages: person.messages,
        alreadyConnected,
        stage: launchLinkedinStage(person),
        messagesSent: 0,
        ...(alreadyConnected
          ? { connectedAt: now, nextActionAt: addDays(now, delayAfterAcceptDays) }
          : {}),
      };
    }),
    createdAt: now,
    updatedAt: now,
  });
  const doc = await db.collection<CampaignDoc>("linkedin_campaigns").findOne({
    _id: result.insertedId,
    projectId,
  });
  if (!doc) throw new Error("Campaign was not saved.");

  const opened = await openLinkedinComputer(projectId).catch(() => null);
  if (opened?.desktopUrl) {
    const requests = preview.people.filter((person) => !person.alreadyConnected).slice(0, 80);
    const already = preview.people.filter((person) => person.alreadyConnected).slice(0, 40);
    const requestLines = requests
      .map((person, index) => `${index + 1}. ${person.name} — ${person.linkedinUrl}`)
      .join("\n");
    const alreadyLines = already
      .map((person, index) => `${index + 1}. ${person.name} — ${person.linkedinUrl}`)
      .join("\n");
    const sandbox = await ensureProjectBoat(projectId).catch(() => null);
    if (sandbox && (requestLines || alreadyLines)) {
      const task = `Chrome profile directory "${LINKEDIN_PROFILE}" is already signed in to LinkedIn. The browser language is English.
Send a connection request only to people who are not already connected. Open the profile, click Connect, and send it with no note.
If they are already a 1st-degree connection, do not send a request and do not send a message.
Wait a few seconds between profiles.
If LinkedIn shows a limit or a challenge, stop.

${requestLines ? `Check these profiles:\n${requestLines}` : ""}
${alreadyLines ? `These are expected to already be connections. Confirm and do not message them:\n${alreadyLines}` : ""}

Reply with one line per person, using the name exactly:
ALREADY: Name
REQUESTED: Name
STATUS: done OR limited OR error`;
      const queued = await runBoatDesktopTask(sandbox.id, task, null, 0).catch(() => null);
      if (queued?.promptId) {
        await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
          { _id: doc._id },
          {
            $set: {
              boatPromptId: queued.promptId,
              boatConversationId: queued.conversationId,
              relationshipSynced: false,
            },
          },
        );
      }
    }
  }
  return { campaign: mapCampaign(doc), desktopUrl: opened?.desktopUrl };
}

function markConnected(person: PersonDoc, delayDays: number, now: Date): PersonDoc {
  if (person.stage?.startsWith("message_") || person.stage === "connected") {
    return person;
  }
  return {
    ...person,
    stage: "connected",
    alreadyConnected: true,
    connectedAt: now,
    messagesSent: person.messagesSent || 0,
    nextActionAt: addDays(now, delayDays),
  };
}

/** Move people the virtual machine found already connected onto the Connected stage. */
export async function applyLinkedinRelationshipReport(
  projectId: ObjectId,
  campaignId: string,
  report: string,
) {
  if (!ObjectId.isValid(campaignId)) return null;
  const db = await getDb();
  const doc = await db.collection<CampaignDoc>("linkedin_campaigns").findOne({
    _id: new ObjectId(campaignId),
    projectId,
  });
  if (!doc) return null;
  const now = new Date();
  const lines = report.split(/\n+/);
  const people = doc.people.map((person) => {
    const line = lines.find((entry) =>
      entry.toLowerCase().includes(person.name.trim().toLowerCase()),
    );
    if (!line) return person;
    if (/already/i.test(line) && /connect/i.test(line)) {
      return markConnected(person, doc.delayAfterAcceptDays, now);
    }
    if (/request sent|invitation sent|pending/i.test(line) && !person.stage) {
      return { ...person, stage: "request_sent" };
    }
    return person;
  });
  await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
    { _id: doc._id },
    { $set: { people, relationshipSynced: true, updatedAt: now } },
  );
  return getLinkedinCampaign(projectId, campaignId);
}

function messageDue(person: PersonDoc, now: Date) {
  const stage = personStage(person);
  if (stage === "reply" || stage.startsWith("custom_")) return false;
  if (stage !== "connected" && !stage.startsWith("message_")) return false;
  if (!person.nextActionAt || person.nextActionAt.getTime() > now.getTime()) return false;
  const sent = person.messagesSent || 0;
  return Boolean(person.messages[sent]?.trim());
}

const CHECK_WAIT_MS = 10 * 60 * 1000;
const STUCK_PROMPT_MS = 20 * 60 * 1000;

let followUpRun: Promise<{ sent: number }> | null = null;

function namePattern(name: string) {
  return name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function reportHas(report: string, tag: string, name: string) {
  return new RegExp(`^${tag}:\\s*${namePattern(name)}\\s*$`, "im").test(report);
}

function sentMessageNumbers(report: string, name: string) {
  const pattern = new RegExp(`^SENT:\\s*${namePattern(name)}\\s*\\|\\s*(\\d+)\\s*$`, "gim");
  const numbers: number[] = [];
  for (const match of report.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) numbers.push(value);
  }
  return numbers;
}

function withoutNextAction(person: PersonDoc, patch: Partial<PersonDoc>): PersonDoc {
  const next = { ...person, ...patch };
  delete next.nextActionAt;
  return next;
}

function messagesToSend(person: PersonDoc, delayAfterMessageDays: number) {
  const sent = person.messagesSent || 0;
  const pending = person.messages
    .map((text, index) => ({ number: index + 1, text: text.trim() }))
    .filter((message) => message.number > sent && message.text);
  if (delayAfterMessageDays === 0) return pending;
  return pending.slice(0, 1);
}

function applyFollowUpReport(doc: CampaignDoc, report: string, now: Date) {
  const targets = new Set(doc.activeTargets || []);
  let sawPending = false;
  const people = doc.people.map((person) => {
    const id = person.id || "";
    const replied = reportHas(report, "REPLIED", person.name);
    const connected = reportHas(report, "CONNECTED", person.name);
    const pending = reportHas(report, "PENDING", person.name);
    const sent = sentMessageNumbers(report, person.name);
    if (pending) sawPending = true;
    if (replied) {
      return withoutNextAction(person, {
        stage: "reply",
        alreadyConnected: true,
        connectedAt: person.connectedAt || now,
        replyCheckedAt: now,
      });
    }
    if (reportHas(report, "REJECTED", person.name)) {
      return withoutNextAction(person, {
        stage: "connection_rejected",
        replyCheckedAt: now,
        statusNote: "They rejected the connection request.",
      });
    }
    if (sent.length) {
      const maxSent = Math.max(...sent);
      const hasNext = Boolean(person.messages[maxSent]?.trim());
      return {
        ...person,
        stage: `message_${maxSent}`,
        messagesSent: maxSent,
        alreadyConnected: true,
        connectedAt: person.connectedAt || now,
        replyCheckedAt: now,
        statusNote: "",
        nextActionAt: hasNext ? addDays(now, doc.delayAfterMessageDays) : undefined,
      };
    }
    if (connected) {
      const marked = markConnected(person, doc.delayAfterAcceptDays, now);
      return { ...marked, replyCheckedAt: now };
    }
    if (pending) {
      return {
        ...person,
        stage: "request_sent",
        replyCheckedAt: now,
        statusNote: "Opened the profile. The connection request is still pending.",
      };
    }
    if (!targets.has(id)) return person;
    const stage = personStage(person);
    if (stage === "connected" || stage.startsWith("message_")) {
      return {
        ...person,
        replyCheckedAt: now,
        nextActionAt: new Date(now.getTime() + CHECK_WAIT_MS),
      };
    }
    return { ...person, replyCheckedAt: now };
  });
  return { people, sawPending };
}

function personBlock(person: PersonDoc, delayAfterMessageDays: number, checkConnection: boolean) {
  const messages = messagesToSend(person, delayAfterMessageDays);
  if (checkConnection) {
    const sendLines = messages.length
      ? [
          "Send these LinkedIn messages, in order, and wait until each one is delivered:",
          ...messages.map((message) => `MESSAGE ${message.number}:\n${message.text}`),
          ...messages.map((message) => `Then report SENT: ${person.name} | ${message.number}`),
        ]
      : ["Report CONNECTED and do not send a message."];
    return [
      `${person.name} — ${person.linkedinUrl}`,
      "Open that exact profile URL. Reload it and wait until the name and the buttons beside the name are visible.",
      "If a Pending button is visible, the request is still waiting. Report PENDING and do not send a message. A Message button next to Pending does not mean they accepted.",
      "If there is no Pending button and the profile says 1st, they accepted.",
      ...sendLines,
      "If there is no Pending button, the profile is not 1st, and the button says Connect, they rejected the request. Report REJECTED. Do not send another connection request and do not send a message.",
    ].join("\n");
  }
  const lines = [
    `${person.name} — ${person.linkedinUrl}`,
    "They are already a connection. Do not send a connection request.",
    "Open the message thread first. If they have replied, report REPLIED and do not send anything.",
  ];
  if (messages.length) {
    const already = person.messagesSent || 0;
    if (already > 0) {
      lines.push(`Message ${already} was already sent. Do not send it again.`);
    }
    lines.push("Send these LinkedIn messages, in order, and wait until each one is delivered:");
    for (const message of messages) {
      lines.push(`MESSAGE ${message.number}:\n${message.text}`);
    }
    lines.push(
      messages.map((message) => `Then report SENT: ${person.name} | ${message.number}`).join("\n"),
    );
  } else {
    lines.push("Do not send a message. Only report REPLIED if they replied.");
  }
  return lines.join("\n");
}

export async function addLinkedinStage(projectId: ObjectId, campaignId: string, label: string) {
  if (!ObjectId.isValid(campaignId)) throw new Error("Campaign not found");
  const name = label.trim().slice(0, 40);
  if (!name) throw new Error("Name the stage.");
  const db = await getDb();
  const doc = await db.collection<CampaignDoc>("linkedin_campaigns").findOne({
    _id: new ObjectId(campaignId),
    projectId,
  });
  if (!doc) throw new Error("Campaign not found");
  const custom = doc.customStages || [];
  if (custom.length >= 8) throw new Error("This campaign already has 8 extra stages.");
  if (custom.some((stage) => stage.label.toLowerCase() === name.toLowerCase())) {
    throw new Error("That stage is already on the board.");
  }
  custom.push({ id: `custom_${Date.now().toString(36)}`, label: name });
  await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
    { _id: doc._id },
    { $set: { customStages: custom, updatedAt: new Date() } },
  );
  return getLinkedinCampaign(projectId, campaignId);
}

export async function moveLinkedinContact(
  projectId: ObjectId,
  campaignId: string,
  contactId: string,
  stage: string,
) {
  if (!ObjectId.isValid(campaignId)) throw new Error("Campaign not found");
  const db = await getDb();
  const doc = await db.collection<CampaignDoc>("linkedin_campaigns").findOne({
    _id: new ObjectId(campaignId),
    projectId,
  });
  if (!doc) throw new Error("Campaign not found");
  const allowed = new Set(
    linkedinBoardColumns(doc.messageLabels, doc.customStages || []).map((column) => column.id),
  );
  if (!allowed.has(stage)) throw new Error("That stage is not on this board.");
  const now = new Date();
  let found = false;
  const people = doc.people.map((person, index) => {
    const id = person.id || `p${index + 1}`;
    if (id !== contactId) return person;
    found = true;
    if (stage === "reply" || stage === "connection_rejected" || stage.startsWith("custom_")) {
      return withoutNextAction(person, {
        stage,
        ...(stage === "connection_rejected"
          ? { statusNote: "They rejected the connection request." }
          : {}),
      });
    }
    if (stage.startsWith("message_")) {
      const sentCount = Number(stage.slice("message_".length));
      const hasNext = Boolean(person.messages[sentCount]?.trim());
      return {
        ...person,
        stage,
        messagesSent: Number.isInteger(sentCount) ? sentCount : person.messagesSent,
        nextActionAt: hasNext ? addDays(now, doc.delayAfterMessageDays) : undefined,
      };
    }
    if (stage === "connected") {
      const sent = person.messagesSent || 0;
      return {
        ...person,
        stage,
        alreadyConnected: true,
        connectedAt: person.connectedAt || now,
        nextActionAt: person.messages[sent]?.trim() ? now : undefined,
      };
    }
    return withoutNextAction(person, { stage });
  });
  if (!found) throw new Error("Contact not found");
  await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
    { _id: doc._id },
    { $set: { people, status: campaignStatus(people), updatedAt: now } },
  );
  return getLinkedinCampaign(projectId, campaignId);
}

/** Check accepts and replies, and send every message whose wait is already over. */
export function processDueLinkedinMessages(now = new Date()) {
  if (followUpRun) return followUpRun;
  followUpRun = runLinkedinFollowUps(now).finally(() => {
    followUpRun = null;
  });
  return followUpRun;
}

async function runLinkedinFollowUps(now = new Date()) {
  await sessions();
  const db = await getDb();
  const docs = await db
    .collection<CampaignDoc>("linkedin_campaigns")
    .find({ status: { $in: ["running", "complete"] } })
    .toArray();
  let sent = 0;
  if (!boatConfigured()) return { sent };
  for (const doc of docs) {
    const statusNow = campaignStatus(doc.people);
    if (statusNow !== doc.status) {
      await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
        { _id: doc._id },
        { $set: { status: statusNow, updatedAt: now } },
      );
      doc.status = statusNow;
    }
    const sandbox = await ensureProjectBoat(doc.projectId).catch(() => null);
    if (!sandbox || !isBoatRunning(sandbox.state)) continue;

    if (doc.activePromptId) {
      const age = now.getTime() - (doc.activePromptAt?.getTime() || 0);
      const finished =
        age > STUCK_PROMPT_MS
          ? { done: true, report: "" }
          : await getBoatTaskReport(sandbox.id, doc.activePromptId).catch(() => null);
      if (!finished?.done) continue;
      const applied = applyFollowUpReport(doc, finished.report || "", now);
      const checkedConnections = (doc.activeTargets || []).some((id) =>
        doc.people.some(
          (person, index) =>
            (person.id || `p${index + 1}`) === id && personStage(person) === "request_sent",
        ),
      );
      sent += applied.people.filter((person, index) => person.stage !== doc.people[index]?.stage).length;
      await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
        { _id: doc._id },
        {
          $set: {
            people: applied.people,
            status: campaignStatus(applied.people),
            connectionCheckAt: applied.sawPending || checkedConnections ? now : doc.connectionCheckAt,
            updatedAt: now,
          },
          $unset: { activePromptId: "", activePromptAt: "", activeTargets: "" },
        },
      );
      doc.people = applied.people;
      doc.activePromptId = undefined;
    }

    const checkConnections =
      doc.people.some((person) => personStage(person) === "request_sent") &&
      (!doc.connectionCheckAt || now.getTime() - doc.connectionCheckAt.getTime() >= CHECK_WAIT_MS);
    const included = new Set<string>();
    const blocks: string[] = [];
    doc.people.forEach((person, index) => {
      const id = person.id || `p${index + 1}`;
      const stage = personStage(person);
      if (checkConnections) {
        if (stage !== "request_sent") return;
        included.add(id);
        blocks.push(personBlock(person, doc.delayAfterMessageDays, true));
        return;
      }
      const due = messageDue(person, now);
      const replyCheck =
        stage.startsWith("message_") &&
        (!person.replyCheckedAt || now.getTime() - person.replyCheckedAt.getTime() >= CHECK_WAIT_MS);
      if (!due && !replyCheck) return;
      included.add(id);
      blocks.push(personBlock(person, doc.delayAfterMessageDays, false));
    });
    if (!blocks.length) continue;

    const queued = await runBoatDesktopTask(
      sandbox.id,
      `Use the Chrome profile directory "${LINKEDIN_PROFILE}". It is signed in to LinkedIn. The browser language is English.
Do not send a connection request. Only open the people listed below. Do not message anyone else.

For each person below, follow the instructions in their section.

${blocks.join("\n\n")}

Reply with one line per result, using the name exactly:
PENDING: Name
REJECTED: Name
CONNECTED: Name
REPLIED: Name
SENT: Name | 1
SENT: Name | 2
STATUS: done OR error`,
      null,
      0,
    ).catch((error) => {
      console.error("[linkedin] could not queue follow-up:", error);
      return null;
    });
    if (!queued?.promptId) continue;
    const heldUntil = new Date(now.getTime() + STUCK_PROMPT_MS);
    const people = doc.people.map((person, index) => {
      const id = person.id || `p${index + 1}`;
      if (!included.has(id) || !messageDue(person, now)) return person;
      return { ...person, nextActionAt: heldUntil };
    });
    await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
      { _id: doc._id },
      {
        $set: {
          people,
          status: campaignStatus(people),
          activePromptId: queued.promptId,
          activePromptAt: now,
          activeTargets: [...included],
          connectionCheckAt: checkConnections ? now : doc.connectionCheckAt,
          updatedAt: now,
        },
      },
    );
    console.info(`[linkedin] queued follow-up for ${doc.name} (${blocks.length} people)`);
  }
  return { sent };
}
