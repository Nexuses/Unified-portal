import { ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";
import nodemailer from "nodemailer";
import { PUBLIC_APP_ORIGIN } from "@/lib/campaign-tracking";
import { getDataToolDb } from "@/lib/datatool-server";
import { getDb } from "@/lib/mongodb";

export type StatusLevel = "operational" | "degraded" | "down";

type CheckId =
  | "app"
  | "database"
  | "enrich-db"
  | "apollo"
  | "aircall"
  | "boat"
  | "openai"
  | "xai"
  | "ses"
  | "s3"
  | "agentmail"
  | "mxtoolbox";

type StatusComponent = {
  id: string;
  group: string;
  name: string;
  path: string;
  checks: CheckId[];
  /** "any" stays up when a fallback provider is responding. */
  need?: "all" | "any";
};

type CheckResult = {
  id: CheckId;
  state: StatusLevel;
  detail: string;
};

type Track = {
  id: string;
  state: StatusLevel;
  failStreak: number;
  alerted: boolean;
};

type IncidentUpdate = { at: string; body: string };

type Incident = {
  id: string;
  title: string;
  componentIds: string[];
  startedAt: string;
  resolvedAt: string | null;
  updates: IncidentUpdate[];
};

const SNAPSHOT_VERSION = 3;

type Snapshot = {
  version: number;
  updatedAt: string;
  checks: CheckResult[];
  tracks: Track[];
  days: Record<string, Record<string, StatusLevel>>;
  /** Per day, per component: [checks that were up, checks run]. */
  counts?: Record<string, Record<string, [number, number]>>;
  incidents: Incident[];
};

const DAY_COUNT = 90;
const FRESH_MS = 90_000;
const PROBE_MS = 8_000;
const CONFIRM_FAILURES = 2;

const COMPONENTS: StatusComponent[] = [
  { id: "portal", group: "Platform", name: "Home", path: "/portal", checks: ["app", "database"] },
  { id: "login", group: "Platform", name: "Login", path: "/api/auth/login", checks: ["database"] },
  { id: "database", group: "Platform", name: "Database", path: "MongoDB", checks: ["database"] },
  { id: "users", group: "Platform", name: "Users", path: "/api/users", checks: ["database"] },
  { id: "projects", group: "Platform", name: "Projects", path: "/api/projects", checks: ["database"] },
  { id: "admin", group: "Platform", name: "Admin", path: "/api/admin", checks: ["database"] },
  { id: "jobs", group: "Platform", name: "Scheduled jobs", path: "/api/cron", checks: ["app"] },
  { id: "boat", group: "Platform", name: "Cloud computers", path: "/api/boat", checks: ["boat"] },
  { id: "contacts", group: "CRM", name: "Contacts", path: "/api/crm/contacts", checks: ["database"] },
  { id: "companies", group: "CRM", name: "Companies", path: "/api/crm/companies", checks: ["database"] },
  { id: "lists", group: "CRM", name: "Lists", path: "/api/crm/lists", checks: ["database"] },
  { id: "segments", group: "CRM", name: "Segments", path: "/portal/crm/segments", checks: ["database"] },
  { id: "lead-reports", group: "CRM", name: "Lead reports", path: "/api/crm/lead-reports", checks: ["database"] },
  { id: "suppression", group: "CRM", name: "Suppression list", path: "/api/crm/suppression", checks: ["database"] },
  { id: "enrich", group: "CRM", name: "Enrichment search", path: "/api/crm/enrich", checks: ["enrich-db"] },
  { id: "apollo", group: "CRM", name: "Apollo enrichment", path: "/api/crm/contacts/apollo-enrich", checks: ["apollo"] },
  { id: "campaigns", group: "Marketing", name: "Drip campaigns", path: "/api/campaigns", checks: ["database"] },
  { id: "oneone", group: "Marketing", name: "1-1 campaigns", path: "/api/campaigns", checks: ["database"] },
  { id: "tracking", group: "Marketing", name: "Open and click tracking", path: "/api/campaigns/track", checks: ["database"] },
  { id: "automations", group: "Marketing", name: "Automations", path: "/api/automations", checks: ["database"] },
  { id: "automation-history", group: "Marketing", name: "Automation history", path: "/portal/marketing/automation-history", checks: ["database"] },
  { id: "automation-chat", group: "Marketing", name: "Automation chat", path: "/api/automation/chat", checks: ["database", "openai"], need: "all" },
  { id: "personalise", group: "Marketing", name: "Personalise", path: "/api/personalise", checks: ["openai"] },
  { id: "cloud", group: "Marketing", name: "Cloud campaigns", path: "/api/cloud-campaigns", checks: ["database", "boat"] },
  { id: "linkedin", group: "Marketing", name: "LinkedIn campaigns", path: "/api/linkedin/campaigns", checks: ["database", "boat"] },
  { id: "linkedin-session", group: "Marketing", name: "LinkedIn sign-in", path: "/api/linkedin/session", checks: ["database", "boat"] },
  { id: "edm", group: "Marketing", name: "EDM", path: "/api/edm", checks: ["s3"] },
  { id: "unsubscribe", group: "Marketing", name: "Unsubscribe", path: "/api/unsubscribe", checks: ["database"] },
  { id: "pitch", group: "Marketing", name: "Pitch research", path: "/api/pitch-research", checks: ["xai", "openai"], need: "any" },
  { id: "inbox", group: "Inbox", name: "Master Inbox", path: "/api/inbox", checks: ["database"] },
  { id: "inbox-signatures", group: "Inbox", name: "Inbox signatures", path: "/api/inbox/signatures", checks: ["database"] },
  { id: "agentmail", group: "Inbox", name: "Deliverability mail", path: "AgentMail", checks: ["agentmail"] },
  { id: "aircall", group: "Calling", name: "Aircall", path: "/api/aircall", checks: ["aircall"] },
  { id: "recordings", group: "Calling", name: "Call recordings", path: "/api/aircall/calls", checks: ["aircall", "database"] },
  { id: "speech", group: "Calling", name: "Call transcription", path: "/api/speech/transcribe", checks: ["openai"] },
  { id: "analytics", group: "Analytics", name: "Analytics", path: "/api/analytics", checks: ["database"] },
  { id: "activity", group: "Analytics", name: "Activity", path: "/api/activity", checks: ["database"] },
  { id: "pipeline", group: "Pipeline", name: "Pipeline", path: "/api/analytics/kanban", checks: ["database"] },
  { id: "pipeline-share", group: "Pipeline", name: "Shared pipeline", path: "/api/public/kanban", checks: ["database"] },
  { id: "pipeline-chat", group: "Pipeline", name: "Pipeline chat", path: "/api/analytics/kanban/chat", checks: ["database", "openai"] },
  { id: "smtp", group: "Email", name: "SMTP senders", path: "/api/smtp/senders", checks: ["database"] },
  { id: "sender-health", group: "Email", name: "Sender health", path: "/api/dashboard/email-health", checks: ["database", "mxtoolbox"] },
  { id: "ses", group: "Email", name: "Email delivery", path: "Amazon SES", checks: ["ses"] },
  { id: "mx", group: "Email", name: "Domain health", path: "MXToolbox", checks: ["mxtoolbox"] },
  { id: "weekly-report", group: "Email", name: "Weekly report", path: "/api/cron/weekly-report", checks: ["ses", "database"] },
  { id: "grok", group: "AI", name: "Grok", path: "api.x.ai", checks: ["xai"] },
  { id: "assistant", group: "AI", name: "Assistant", path: "/api/assistant", checks: ["openai"] },
  { id: "project-assistant", group: "AI", name: "Project assistant", path: "/api/project-assistant", checks: ["openai"] },
  { id: "credits", group: "AI", name: "API credits", path: "/api/api-credits", checks: ["database"] },
  { id: "files", group: "Files", name: "File manager", path: "/api/file-manager", checks: ["s3"] },
  { id: "knowledge", group: "Files", name: "Knowledge base", path: "/api/knowledge-base", checks: ["database"] },
  { id: "branding", group: "Files", name: "Branding", path: "/api/branding", checks: ["database"] },
  { id: "brand-logos", group: "Files", name: "Logos", path: "/api/brand", checks: ["s3"] },
  { id: "integrations", group: "Files", name: "Integrations", path: "/api/integrations", checks: ["database"] },
  { id: "webhooks", group: "Files", name: "Webhooks", path: "/api/webhooks", checks: ["database"] },
  { id: "public-links", group: "Files", name: "Shared links", path: "/api/public", checks: ["database"] },
];

const CHECK_DETAIL: Record<CheckId, { ok: string; bad: string }> = {
  app: { ok: "The portal process is responding.", bad: "The portal process is not responding." },
  database: { ok: "The database is responding.", bad: "The database did not respond." },
  "enrich-db": { ok: "The enrichment database is responding.", bad: "The enrichment database did not respond." },
  apollo: { ok: "Apollo is responding.", bad: "Apollo did not respond." },
  aircall: { ok: "Aircall is responding.", bad: "Aircall did not respond." },
  boat: { ok: "The cloud computer API is responding.", bad: "The cloud computer API did not respond." },
  openai: { ok: "OpenAI is responding.", bad: "OpenAI did not respond." },
  xai: { ok: "Grok is responding.", bad: "Grok did not respond." },
  ses: { ok: "Email delivery is responding.", bad: "Email delivery did not respond." },
  s3: { ok: "File storage is responding.", bad: "File storage did not respond." },
  agentmail: { ok: "Deliverability mail is responding.", bad: "Deliverability mail did not respond." },
  mxtoolbox: { ok: "Domain health is responding.", bad: "Domain health did not respond." },
};

const GROUP_ORDER = ["Platform", "CRM", "Calling", "Pipeline", "Marketing", "Inbox", "Analytics", "Email", "AI", "Files"];

type Memory = {
  snapshot: Snapshot | null;
  slackWarned: boolean;
};

function memory(): Memory {
  const g = globalThis as typeof globalThis & { __nexusesPlatformStatus?: Memory };
  if (!g.__nexusesPlatformStatus) {
    g.__nexusesPlatformStatus = { snapshot: null, slackWarned: false };
  }
  return g.__nexusesPlatformStatus;
}

function rank(level: StatusLevel) {
  if (level === "down") return 2;
  if (level === "degraded") return 1;
  return 0;
}

function worse(a: StatusLevel, b: StatusLevel): StatusLevel {
  return rank(a) >= rank(b) ? a : b;
}

const PUBLIC_ORIGIN = PUBLIC_APP_ORIGIN;

function appOrigin() {
  return PUBLIC_ORIGIN;
}

function slackTargets() {
  const email = process.env.SLACK_STATUS_EMAIL?.trim() || "";
  const hook =
    process.env.SLACK_STATUS_WEBHOOK_URL?.trim() ||
    process.env.SLACK_WEBHOOK_URL?.trim() ||
    "";
  if (hook.includes("@") && !hook.startsWith("http")) {
    return { webhook: "", email: email || hook };
  }
  return { webhook: hook.startsWith("http") ? hook : "", email };
}

function componentById(id: string) {
  return COMPONENTS.find((component) => component.id === id);
}

function whereLine(component: StatusComponent) {
  return component.path.startsWith("/") ? `${PUBLIC_ORIGIN}${component.path}` : component.path;
}

function problemBlock(id: string, checks: CheckResult[], state: StatusLevel) {
  const component = componentById(id);
  const name = component?.name || id;
  const word = state === "degraded" ? "degraded" : "down";
  const lines = [`${name} is ${word}.`];
  if (!component) return lines.join("\n");
  lines.push(`Area: ${component.group}`);
  lines.push(`Where: ${whereLine(component)}`);
  const detail = componentDetail(component, checks);
  if (detail && detail !== "Operational") lines.push(detail);
  return lines.join("\n");
}

function recoveryBlock(id: string) {
  const component = componentById(id);
  const name = component?.name || id;
  const lines = [`${name} is fixed and live.`];
  if (!component) return lines.join("\n");
  lines.push(`Area: ${component.group}`);
  lines.push(`Where: ${whereLine(component)}`);
  lines.push("It was down and is responding again.");
  return lines.join("\n");
}

function slackFooter(when: string) {
  return `Checked: ${whenFormat.format(new Date(when))} IST\nFull status: ${statusUrl()}`;
}

async function postSlackEmail(subject: string, text: string, to: string) {
  const host = process.env.WEEKLY_REPORT_SMTP_HOST?.trim();
  const user = process.env.WEEKLY_REPORT_SMTP_USER?.trim();
  const pass = process.env.WEEKLY_REPORT_SMTP_PASS?.trim();
  const from = process.env.WEEKLY_REPORT_FROM_EMAIL?.trim();
  const port = Number(process.env.WEEKLY_REPORT_SMTP_PORT || 587);
  if (!host || !user || !pass || !from) {
    console.error("[status] Slack email is set, but the report mail server is not.");
    return;
  }
  const transport = nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure: false,
    auth: { user, pass },
    connectionTimeout: PROBE_MS,
    greetingTimeout: PROBE_MS,
    socketTimeout: PROBE_MS,
  });
  try {
    await withTimeout(
      transport.sendMail({
        from: `Nexgos Platform <${from}>`,
        to,
        subject,
        text,
      }),
      PROBE_MS,
    );
  } catch {
    console.error("[status] Slack email failed.");
  } finally {
    transport.close();
  }
}

async function postSlack(subject: string, text: string) {
  const { webhook, email } = slackTargets();
  if (!webhook && !email) {
    if (!memory().slackWarned) {
      memory().slackWarned = true;
      console.error("[status] Slack alerts are off until SLACK_STATUS_EMAIL is set.");
    }
    return;
  }
  if (email) await postSlackEmail(subject, text, email);
  if (!webhook) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_MS);
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `${subject}\n${text}` }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error("[status] Slack did not accept the status message.");
    }
  } catch {
    console.error("[status] Slack status message failed.");
  } finally {
    clearTimeout(timer);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function httpLevel(url: string, init?: RequestInit): Promise<StatusLevel> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    if (response.ok) return "operational";
    if (response.status === 429 || response.status === 408) return "degraded";
    return "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

function result(id: CheckId, state: StatusLevel): CheckResult {
  const copy = CHECK_DETAIL[id];
  return { id, state, detail: state === "operational" ? copy.ok : copy.bad };
}

async function probeDatabase(): Promise<CheckResult> {
  try {
    await withTimeout(getDb(), PROBE_MS);
    return result("database", "operational");
  } catch {
    return result("database", "down");
  }
}

async function probeEnrichDb(): Promise<CheckResult> {
  try {
    const db = await withTimeout(getDataToolDb(), PROBE_MS);
    await withTimeout(db.command({ ping: 1 }), PROBE_MS);
    return result("enrich-db", "operational");
  } catch {
    return result("enrich-db", "down");
  }
}

async function probeApollo(): Promise<CheckResult> {
  const key = process.env.APOLLO_API_KEY?.trim();
  if (!key) return result("apollo", "down");
  const headers = { "x-api-key": key, Accept: "application/json" };
  const primary = await httpLevel("https://api.apollo.io/api/v1/auth/health", { headers });
  if (primary === "operational") return result("apollo", "operational");
  const legacy = await httpLevel("https://api.apollo.io/v1/auth/health", { headers });
  return result("apollo", legacy === "operational" ? "operational" : primary === "degraded" || legacy === "degraded" ? "degraded" : "down");
}

async function probeAircall(): Promise<CheckResult> {
  const id = process.env.AIRCALL_API_ID?.trim();
  const token = process.env.AIRCALL_API_TOKEN?.trim();
  if (!id || !token) return result("aircall", "down");
  const auth = Buffer.from(`${id}:${token}`).toString("base64");
  const level = await httpLevel("https://api.aircall.io/v1/ping", {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  return result("aircall", level);
}

async function probeBoat(): Promise<CheckResult> {
  const key = process.env.BOAT_API_KEY?.trim();
  if (!key) return result("boat", "down");
  const base = process.env.BOAT_API_BASE?.trim() || "https://boat.dev/api/v1";
  // One sandbox is enough to know the API answers; the full list is large and grows with
  // every archived box. Boat has short gateway blips (502s), so try twice before calling it down.
  const probe = () =>
    httpLevel(`${base}/sandboxes?limit=1`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
  let level = await probe();
  if (level !== "operational") {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    level = await probe();
  }
  return result("boat", level);
}

async function probeOpenAi(): Promise<CheckResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return result("openai", "down");
  const level = await httpLevel("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  return result("openai", level);
}

async function authedLevel(url: string, key: string, init?: RequestInit): Promise<StatusLevel> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_MS);
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(init?.headers || {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (response.ok || response.status === 400 || response.status === 422) return "operational";
    if (response.status === 429) return "degraded";
    return "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

async function probeXai(): Promise<CheckResult> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) return result("xai", "down");
  const listed = await authedLevel("https://api.x.ai/v1/models", key);
  if (listed !== "down") return result("xai", listed);
  const answered = await authedLevel("https://api.x.ai/v1/responses", key, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return result("xai", answered);
}

async function probeSes(): Promise<CheckResult> {
  const host = process.env.WEEKLY_REPORT_SMTP_HOST?.trim();
  const user = process.env.WEEKLY_REPORT_SMTP_USER?.trim();
  const pass = process.env.WEEKLY_REPORT_SMTP_PASS?.trim();
  const port = Number(process.env.WEEKLY_REPORT_SMTP_PORT || 587);
  if (!host || !user || !pass) return result("ses", "down");
  const transport = nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure: false,
    auth: { user, pass },
    connectionTimeout: PROBE_MS,
    greetingTimeout: PROBE_MS,
    socketTimeout: PROBE_MS,
  });
  try {
    await withTimeout(transport.verify(), PROBE_MS);
    return result("ses", "operational");
  } catch {
    return result("ses", "down");
  } finally {
    transport.close();
  }
}

async function probeS3(): Promise<CheckResult> {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return result("s3", "down");
  const client = new S3Client({
    region: process.env.AWS_REGION?.trim() || "us-east-1",
    credentials: { accessKeyId, secretAccessKey },
  });
  try {
    await withTimeout(client.send(new ListBucketsCommand({})), PROBE_MS);
    return result("s3", "operational");
  } catch {
    return result("s3", "down");
  } finally {
    client.destroy();
  }
}

async function probeAgentMail(): Promise<CheckResult> {
  const key = process.env.AGENTMAIL_API_KEY?.trim();
  if (!key) return result("agentmail", "down");
  const level = await httpLevel("https://api.agentmail.to/v0/inboxes?limit=1", {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  return result("agentmail", level);
}

async function probeMx(): Promise<CheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_MS);
  try {
    await fetch("https://api.mxtoolbox.com/api/v1/Lookup", {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    return result("mxtoolbox", "operational");
  } catch {
    return result("mxtoolbox", "down");
  } finally {
    clearTimeout(timer);
  }
}

async function runChecks(): Promise<CheckResult[]> {
  const [database, enrichDb, apollo, aircall, boat, openai, xai, ses, s3, agentmail, mxtoolbox] =
    await Promise.all([
      probeDatabase(),
      probeEnrichDb(),
      probeApollo(),
      probeAircall(),
      probeBoat(),
      probeOpenAi(),
      probeXai(),
      probeSes(),
      probeS3(),
      probeAgentMail(),
      probeMx(),
    ]);
  return [
    result("app", "operational"),
    database,
    enrichDb,
    apollo,
    aircall,
    boat,
    openai,
    xai,
    ses,
    s3,
    agentmail,
    mxtoolbox,
  ];
}

function componentState(component: StatusComponent, checks: CheckResult[]): StatusLevel {
  const byId = new Map(checks.map((check) => [check.id, check.state]));
  const levels = component.checks.map((id) => byId.get(id) || "down");
  if (component.need === "any") {
    if (levels.includes("operational")) return "operational";
    if (levels.includes("degraded")) return "degraded";
    return "down";
  }
  return levels.reduce<StatusLevel>((level, next) => worse(level, next), "operational");
}

function componentDetail(component: StatusComponent, checks: CheckResult[]) {
  const failing = checks.filter(
    (check) => component.checks.includes(check.id) && check.state !== "operational",
  );
  if (!failing.length) return "Operational";
  return failing[0]?.detail || "This API is not responding.";
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function lastDays(count: number) {
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    days.push(new Date(start - index * 86_400_000).toISOString().slice(0, 10));
  }
  return days;
}

function namesOf(ids: string[]) {
  const byId = new Map(COMPONENTS.map((component) => [component.id, component.name]));
  return ids.map((id) => byId.get(id) || id);
}

function listNames(ids: string[]) {
  const names = namesOf(ids);
  if (names.length <= 4) return names.join(", ");
  return `${names.slice(0, 3).join(", ")}, and ${names.length - 3} more`;
}

function statusUrl() {
  return `${appOrigin()}/status`;
}

async function loadSnapshot(): Promise<Snapshot | null> {
  const cached = memory().snapshot;
  if (cached) return cached;
  try {
    const db = await withTimeout(getDb(), PROBE_MS);
    const current = await db.collection("status_current").findOne({ _id: "current" as never });
    const dayDocs = await db
      .collection<{
        _id: string;
        worst?: Record<string, StatusLevel>;
        counts?: Record<string, [number, number]>;
      }>("status_days")
      .find({ _id: { $in: lastDays(DAY_COUNT) } })
      .toArray();
    const incidents = await db
      .collection<Incident & { _id?: unknown }>("status_incidents")
      .find({})
      .sort({ startedAt: -1 })
      .limit(20)
      .toArray();
    if (!current) return null;
    const days: Snapshot["days"] = {};
    const counts: NonNullable<Snapshot["counts"]> = {};
    for (const doc of dayDocs) {
      days[String(doc._id)] = doc.worst || {};
      if (doc.counts) counts[String(doc._id)] = doc.counts;
    }
    const snapshot: Snapshot = {
      version: Number(current.version) || 0,
      updatedAt: current.updatedAt instanceof Date ? current.updatedAt.toISOString() : new Date().toISOString(),
      checks: Array.isArray(current.checks) ? (current.checks as CheckResult[]) : [],
      tracks: Array.isArray(current.tracks) ? (current.tracks as Track[]) : [],
      days,
      counts,
      incidents: incidents.map((incident) => ({
        id: String(incident.id || incident._id),
        title: incident.title,
        componentIds: incident.componentIds || [],
        startedAt: incident.startedAt,
        resolvedAt: incident.resolvedAt,
        updates: incident.updates || [],
      })),
    };
    memory().snapshot = snapshot;
    return snapshot;
  } catch {
    return memory().snapshot;
  }
}

async function saveSnapshot(snapshot: Snapshot) {
  memory().snapshot = snapshot;
  try {
    const db = await withTimeout(getDb(), PROBE_MS);
    const today = dayKey(new Date());
    await db.collection("status_current").updateOne(
      { _id: "current" as never },
      {
        $set: {
          updatedAt: new Date(snapshot.updatedAt),
          checks: snapshot.checks,
          tracks: snapshot.tracks,
        },
      },
      { upsert: true },
    );
    await db.collection("status_days").updateOne(
      { _id: today as never },
      { $set: { worst: snapshot.days[today] || {}, counts: snapshot.counts?.[today] || {} } },
      { upsert: true },
    );
    for (const incident of snapshot.incidents.slice(0, 20)) {
      await db.collection("status_incidents").updateOne(
        { id: incident.id },
        { $set: incident },
        { upsert: true },
      );
    }
  } catch {
    console.error("[status] could not save the status snapshot");
  }
}

let inflight: Promise<void> | null = null;

async function doRun() {
  const previous = (await loadSnapshot()) || {
    version: SNAPSHOT_VERSION,
    updatedAt: new Date(0).toISOString(),
    checks: [],
    tracks: [],
    days: {},
    incidents: [],
  };
  const checks = await runChecks();
  const previousTracks = new Map(previous.tracks.map((track) => [track.id, track]));
  const tracks: Track[] = COMPONENTS.map((component) => {
    const raw = componentState(component, checks);
    const prior = previousTracks.get(component.id);
    const failStreak = raw === "operational" ? 0 : (prior?.failStreak || 0) + 1;
    // One failed check is shown as degraded; it only counts as down once it is confirmed.
    const state: StatusLevel =
      raw === "down" && failStreak < CONFIRM_FAILURES ? "degraded" : raw;
    return {
      id: component.id,
      state,
      failStreak,
      alerted: prior?.alerted || false,
    };
  });

  const newlyDown = tracks.filter(
    (track) => track.state !== "operational" && track.failStreak >= CONFIRM_FAILURES && !track.alerted,
  );
  const recovered = tracks.filter((track) => track.state === "operational" && track.alerted);
  for (const track of newlyDown) track.alerted = true;
  for (const track of recovered) track.alerted = false;

  const now = new Date().toISOString();
  const incidents = previous.incidents.map((incident) => ({ ...incident, updates: [...incident.updates] }));
  let open = incidents.find((incident) => !incident.resolvedAt) || null;

  if (newlyDown.length) {
    const ids = newlyDown.map((track) => track.id);
    const sentence = `${listNames(ids)} ${ids.length === 1 ? "is" : "are"} down.`;
    if (!open) {
      open = {
        id: `inc_${Date.now()}`,
        title: ids.length === 1 ? `${namesOf(ids)[0]} is down` : `${ids.length} APIs are down`,
        componentIds: ids,
        startedAt: now,
        resolvedAt: null,
        updates: [{ at: now, body: sentence }],
      };
      incidents.unshift(open);
    } else {
      open.componentIds = [...new Set([...open.componentIds, ...ids])];
      open.updates.unshift({ at: now, body: `Also affected: ${sentence}` });
    }
    const blocks = ids.map((id) => {
      const state = tracks.find((track) => track.id === id)?.state || "down";
      return problemBlock(id, checks, state);
    });
    const subject = ids.length === 1 ? blocks[0].split("\n")[0] : `${ids.length} services are down.`;
    await postSlack(subject, `${blocks.join("\n\n")}\n\n${slackFooter(now)}`);
  }

  if (recovered.length) {
    const ids = recovered.map((track) => track.id);
    const sentence = `${listNames(ids)} ${ids.length === 1 ? "is" : "are"} responding again.`;
    const stillDown = tracks.filter((track) => track.alerted).map((track) => track.id);
    if (open) {
      open.updates.unshift({ at: now, body: sentence });
      if (!stillDown.length) open.resolvedAt = now;
    }
    const blocks = ids.map((id) => recoveryBlock(id));
    const still = stillDown.length
      ? `\n\nStill down:\n${stillDown
          .map((id) => {
            const component = componentById(id);
            return component ? `${component.name} (${component.group}) — ${whereLine(component)}` : id;
          })
          .join("\n")}`
      : "";
    const subject = ids.length === 1 ? blocks[0].split("\n")[0] : `${ids.length} services are fixed and live.`;
    await postSlack(subject, `${blocks.join("\n\n")}${still}\n\n${slackFooter(now)}`);
  }

  const today = dayKey(new Date());
  const days = { ...previous.days };
  const worst = { ...(days[today] || {}) };
  for (const track of tracks) {
    worst[track.id] = worst[track.id] ? worse(worst[track.id], track.state) : track.state;
  }
  days[today] = worst;
  const counts = { ...(previous.counts || {}) };
  const todayCounts = { ...(counts[today] || {}) };
  for (const track of tracks) {
    const [up, total] = todayCounts[track.id] || [0, 0];
    todayCounts[track.id] = [up + (track.state === "down" ? 0 : 1), total + 1];
  }
  counts[today] = todayCounts;
  const keep = new Set(lastDays(DAY_COUNT));
  for (const day of Object.keys(counts)) if (!keep.has(day)) delete counts[day];

  await saveSnapshot({
    version: SNAPSHOT_VERSION,
    updatedAt: now,
    checks,
    tracks,
    days,
    counts,
    incidents: incidents.slice(0, 20),
  });
}

export function runPlatformStatusCheck() {
  if (!inflight) {
    inflight = doRun().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

function snapshotIsFresh(snapshot: Snapshot | null) {
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION) return false;
  return Date.now() - new Date(snapshot.updatedAt).getTime() < FRESH_MS;
}

export async function ensureFreshStatus() {
  if (snapshotIsFresh(memory().snapshot)) return;
  const loaded = await loadSnapshot();
  if (snapshotIsFresh(loaded)) return;
  await runPlatformStatusCheck();
}

function uptimeLabel(
  bars: Array<StatusLevel | "none">,
  dayCounts: Array<[number, number] | undefined> = [],
) {
  // Prefer real check counts: a four-minute blip should not make a whole day read 0%.
  let up = 0;
  let total = 0;
  bars.forEach((bar, index) => {
    const counted = dayCounts[index];
    if (counted && counted[1] > 0) {
      up += counted[0];
      total += counted[1];
    } else if (bar !== "none") {
      up += bar === "down" ? 0 : 1;
      total += 1;
    }
  });
  if (!total) return "100%";
  const percent = (up / total) * 100;
  if (percent >= 99.95) return "100%";
  if (percent <= 0) return "0%";
  return `${percent.toFixed(2)}%`;
}

function overallOf(states: StatusLevel[]) {
  const down = states.filter((state) => state === "down").length;
  const degraded = states.filter((state) => state === "degraded").length;
  if (!down && !degraded) {
    return {
      overall: "operational" as const,
      headline: "We're fully operational",
      summary: "We're not aware of any issues affecting our systems.",
    };
  }
  if (!down) {
    return {
      overall: "degraded" as const,
      headline: "Some systems are degraded",
      summary: "A few APIs are slow or only partly available.",
    };
  }
  if (down / Math.max(states.length, 1) >= 0.5) {
    return {
      overall: "major" as const,
      headline: "Major system outage",
      summary: "Most of the portal APIs are not responding.",
    };
  }
  return {
    overall: "partial" as const,
    headline: "Partial system outage",
    summary: "Some APIs are down. The rest of the portal is still up.",
  };
}

const whenFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export async function getPlatformStatusPage() {
  await ensureFreshStatus();
  const snapshot = memory().snapshot;
  const checks = snapshot?.checks || [];
  const tracks = new Map((snapshot?.tracks || []).map((track) => [track.id, track]));
  const days = lastDays(DAY_COUNT);
  const monthTicks: Array<{ index: number; label: string }> = [];
  let lastMonth = "";
  days.forEach((day, index) => {
    const label = new Date(`${day}T00:00:00Z`).toLocaleString("en-US", {
      month: "short",
      timeZone: "UTC",
    });
    if (label !== lastMonth) {
      monthTicks.push({ index, label });
      lastMonth = label;
    }
  });

  const rows = COMPONENTS.map((component) => {
    const state = tracks.get(component.id)?.state || (checks.length ? componentState(component, checks) : "operational");
    const bars = days.map((day) => snapshot?.days[day]?.[component.id] || "none");
    return {
      ...component,
      state,
      detail: checks.length ? componentDetail(component, checks) : "Waiting for the first check.",
      uptime: uptimeLabel(
        bars,
        days.map((day) => snapshot?.counts?.[day]?.[component.id]),
      ),
      bars,
    };
  });

  const banner = overallOf(rows.map((row) => row.state));
  const groups = GROUP_ORDER.map((name) => ({
    name,
    components: rows.filter((row) => row.group === name),
  })).filter((group) => group.components.length);

  const rangeStart = new Date(`${days[0]}T00:00:00Z`).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const rangeEnd = new Date(`${days[days.length - 1]}T00:00:00Z`).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  return {
    ...banner,
    updatedAt: snapshot ? whenFormat.format(new Date(snapshot.updatedAt)) : null,
    rangeLabel: `${rangeStart} – ${rangeEnd}`,
    days,
    monthTicks,
    groups,
    incidents: (snapshot?.incidents || []).map((incident) => ({
      title: incident.title,
      startedAt: whenFormat.format(new Date(incident.startedAt)),
      resolvedAt: incident.resolvedAt ? whenFormat.format(new Date(incident.resolvedAt)) : null,
      updates: incident.updates.map((update) => ({
        at: whenFormat.format(new Date(update.at)),
        body: update.body,
      })),
    })),
  };
}
