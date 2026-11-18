import { ObjectId } from "mongodb";
import { DEFAULT_STAGE_COLOR, KANBAN_DOT_COLORS } from "@/lib/analytics-kanban";
import {
  boatConfigured,
  ensureLinkedinBoat,
  isBoatRunning,
  openBoatDesktop,
  runBoatCommand,
  shellQuote,
} from "@/lib/boat";
import {
  campaignTabMarker,
  focusLinkedinTab,
  LINKEDIN_MESSAGING_URL,
  LINKEDIN_NETWORK_TAB,
  LINKEDIN_NETWORK_URL,
  LINKEDIN_REPLIES_TAB,
  linkedinNetworkTask,
  linkedinProfileSlug,
  linkedinProfileTask,
  linkedinRepliesTask,
  parseLinkedinBoatReport,
  runLinkedinBoatTask,
  sameLinkedinName,
  type LinkedinBoatReport,
  type LinkedinInboxRow,
} from "@/lib/linkedin-boat";
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
import {
  appendLinkedinTimeline,
  linkedinTimelineChanges,
  recordLinkedinCampaignStart,
  saveLinkedinCampaignList,
} from "@/lib/linkedin-crm";

const REQUEST_WAITING_NOTE = "Connection request sent. Waiting for them to accept.";
const BUTTONS_HIDDEN_NOTE =
  "Opened the profile, but the buttons were not visible yet. It will try again.";

/** LinkedIn's computer. Email and Cloud Campaign stay on the other computer. */
async function linkedinComputer(projectId: ObjectId) {
  const sandbox = await ensureLinkedinBoat(projectId);
  if (sandbox.replacedDeletedDisk) {
    const collection = await sessions();
    await collection.updateOne(
      { projectId },
      { $set: { connected: false, updatedAt: new Date() }, $unset: { connectedAt: "" } },
    );
  }
  return sandbox;
}

/** Chrome on the LinkedIn computer, using the saved LinkedIn profile. Email Chrome stays on the other computer. */
async function openLinkedinChrome(sandboxId: string, url: string, restart: boolean) {
  const directory = shellQuote("LinkedIn");
  const target = shellQuote(url);
  const restartCmd = restart
    ? "pkill -x google-chrome-stable >/dev/null 2>&1 || true; pkill -x chrome >/dev/null 2>&1 || true; sleep 0.4;"
    : "";
  const localeScript = shellQuote(
    [
      "import json, os",
      'path = os.path.expanduser("~/.config/google-chrome/Local State")',
      "os.makedirs(os.path.dirname(path), exist_ok=True)",
      "data = {}",
      "if os.path.exists(path):",
      "    try:",
      "        loaded = json.load(open(path))",
      "        data = loaded if isinstance(loaded, dict) else {}",
      "    except Exception:",
      "        data = {}",
      'intl = data.get("intl") if isinstance(data.get("intl"), dict) else {}',
      'intl["app_locale"] = "en-US"',
      'intl["accept_languages"] = "en-US,en"',
      'data["intl"] = intl',
      'json.dump(data, open(path, "w"))',
    ].join("\n"),
  );
  const command = [
    "if ! command -v google-chrome-stable >/dev/null; then echo chrome-missing; exit 1; fi;",
    restartCmd,
    `python3 -c ${localeScript} || true;`,
    `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LANGUAGE=en_US:en DISPLAY=:0 nohup google-chrome-stable --no-first-run --start-maximized --window-position=0,0 --window-size=1920,1080 --lang=en-US --accept-lang=en-US,en --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --profile-directory=${directory} --new-window ${target} >/tmp/boat-chrome-linkedin.log 2>&1 &`,
    "for i in 1 2 3 4 5 6 7 8; do DISPLAY=:0 wmctrl -lx | grep -q hrome && break; sleep 0.5; done;",
    'DISPLAY=:0 wmctrl -lx | while read -r id _desk _host class _; do case "$class" in *hrome*) wmctrl -i -r "$id" -b add,maximized_vert,maximized_horz ;; esac; done;',
    "echo started",
  ].join(" ");
  return runBoatCommand(sandboxId, command, 20);
}

type ProfileRead = "pending" | "connected" | "connect" | "rejected" | "login" | "unknown";

type ProfileVisit = {
  state: ProfileRead;
  sent: number[];
  replied: boolean | null;
  requested: boolean;
  liked?: boolean;
};

async function chromeDebugOpen(sandboxId: string) {
  const result = await runBoatCommand(
    sandboxId,
    "python3 -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:9222/json/version', timeout=2).read(); print('open')\"",
    10,
  ).catch(() => null);
  return Boolean(result?.stdout.includes("open"));
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
  accountPhoto?: string;
  connectedAt?: Date;
  /** Last time a new connection request was actually sent from this login. */
  lastConnectionRequestAt?: Date;
  /** Last time the Messaging inbox was read for replies. */
  inboxCheckedAt?: Date;
  /** Last time the messaging tab was read for replies. */
  repliesCheckedAt?: Date;
  /** Last time the network tab was read for accepts. */
  acceptsCheckedAt?: Date;
  /** Do not touch the computer again until LinkedIn is signed in. */
  loginHoldUntil?: Date;
  updatedAt: Date;
};

type PersonDoc = {
  id?: string;
  name: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  crmContactId?: string;
  linkedinUrl: string;
  messages: string[];
  stage?: string;
  alreadyConnected?: boolean;
  /** True when the CSV said they were already a connection, before this campaign. */
  startedConnected?: boolean;
  /** True only after this campaign sends the connection request. */
  inviteSent?: boolean;
  connectedAt?: Date;
  nextActionAt?: Date;
  messagesSent?: number;
  replyCheckedAt?: Date;
  connectionRequested?: boolean;
  likeRecentPost?: boolean;
  likedRecentPost?: boolean;
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
  /** 0 is Sunday, 1 is Monday. Missing means every day. */
  sendDays?: number[];
  windowStart?: string;
  windowEnd?: string;
  timezone?: string;
  people: PersonDoc[];
  boatPromptId?: string;
  boatConversationId?: string | null;
  relationshipSynced?: boolean;
  customStages?: { id: string; label: string; color?: string }[];
  listId?: string;
  listName?: string;
  /** Stops visits, requests, messages, and reply checks until resumed. */
  paused?: boolean;
  activePromptId?: string;
  activePromptAt?: Date;
  activeTargets?: string[];
  connectionCheckAt?: Date;
  lastBoatAt?: Date;
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
    accountPhoto: doc?.accountPhoto || "",
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
  const sandbox = await linkedinComputer(projectId);
  if (!isBoatRunning(sandbox.state)) {
    throw new Error(`The computer is ${sandbox.state}. Try again in a few seconds.`);
  }
  const collection = await sessions();
  const saved = await collection.findOne({ projectId });
  const stillConnected = saved?.connected === true && sandbox.replacedDeletedDisk !== true;
  const url = stillConnected
    ? "https://www.linkedin.com/feed/"
    : "https://www.linkedin.com/login?lang=en_US";
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
  const sandbox = await linkedinComputer(projectId);
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

export async function disconnectLinkedinLogin(projectId: ObjectId) {
  const collection = await sessions();
  await collection.updateOne(
    { projectId },
    { $set: { connected: false, updatedAt: new Date() }, $unset: { connectedAt: "" } },
  );
  return getLinkedinSession(projectId);
}

const ACCOUNT_PHOTO_PY = `
import json, os, socket, base64, time, urllib.request

class Reader:
    def __init__(self, sock, rest=b""):
        self.sock = sock
        self.rest = rest
    def recvn(self, size):
        buf = self.rest
        while len(buf) < size:
            chunk = self.sock.recv(max(4096, size - len(buf)))
            if not chunk:
                raise RuntimeError("closed")
            buf += chunk
        self.rest = buf[size:]
        return buf[:size]
    def sendall(self, data):
        self.sock.sendall(data)

def ws_connect(url):
    rest = url.split("://", 1)[1]
    hostport, path = rest.split("/", 1)
    host, port = hostport.split(":")
    sock = socket.create_connection((host, int(port)), 15)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall(("GET /%s HTTP/1.1\\r\\nHost: %s\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: %s\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n" % (path, hostport, key)).encode())
    buf = b""
    while b"\\r\\n\\r\\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("closed")
        buf += chunk
    _header, _, leftover = buf.partition(b"\\r\\n\\r\\n")
    return Reader(sock, leftover)

def send(reader, payload):
    data = json.dumps(payload).encode()
    mask = os.urandom(4)
    header = bytearray([0x81])
    size = len(data)
    if size < 126:
        header.append(0x80 | size)
    else:
        header.append(0xFE)
        header.extend(size.to_bytes(2, "big"))
    header.extend(mask)
    reader.sendall(bytes(header) + bytes(byte ^ mask[index % 4] for index, byte in enumerate(data)))

def recv_text(reader):
    parts = []
    while True:
        header = reader.recvn(2)
        opcode = header[0] & 15
        length = header[1] & 127
        if length == 126:
            length = int.from_bytes(reader.recvn(2), "big")
        elif length == 127:
            length = int.from_bytes(reader.recvn(8), "big")
        data = reader.recvn(length)
        if opcode == 8:
            raise RuntimeError("closed")
        if opcode == 9:
            continue
        if opcode in (0, 1):
            parts.append(data)
            if header[0] & 128:
                return b"".join(parts).decode("utf-8", "replace")

def call(sock, ident, method, params):
    send(sock, {"id": ident, "method": method, "params": params})
    deadline = time.time() + 20
    while time.time() < deadline:
        message = json.loads(recv_text(sock))
        if message.get("id") == ident:
            return message
    raise TimeoutError(method)

EXPR = """(async () => {
  const collect = (root, out) => {
    out.push(...root.querySelectorAll("img"));
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) collect(el.shadowRoot, out);
    }
    return out;
  };
  const name = (window.__liAccountName || "").toLowerCase().trim();
  const first = name.split(/\\s+/)[0] || "";
  const labelOf = (el) => {
    const bits = [el.alt, el.getAttribute("aria-label"), el.getAttribute("title")];
    let parent = el.parentElement;
    for (let i = 0; i < 5 && parent; i += 1) {
      bits.push(parent.getAttribute("aria-label"), parent.getAttribute("title"));
      parent = parent.parentElement;
    }
    return bits.filter(Boolean).join(" ").toLowerCase();
  };
  const srcOf = (el) => el.currentSrc || el.src || "";
  const imgs = collect(document, []).filter((el) => /licdn\\.com|profile-displayphoto|profile-framedphoto/i.test(srcOf(el)));
  const scored = imgs.map((el) => {
    const box = el.getBoundingClientRect();
    const src = srcOf(el);
    const label = labelOf(el);
    let score = 0;
    if (/profile-displayphoto|profile-framedphoto|member-photo|me-photo/i.test(src + " " + (el.className || ""))) score += 5;
    if (first && label.includes(first)) score += 8;
    if (/(^| )me($| )|moi/.test(label)) score += 4;
    if (box.width >= 20 && box.width <= 80 && box.top >= 0 && box.top < 72) score += 10;
    if (box.width >= 48 && box.width <= 140 && box.top >= 0 && box.top < 280 && box.left < 360) score += 2;
    return { el, score };
  }).sort((a, b) => b.score - a.score);
  const img = (scored[0] && scored[0].score > 0 ? scored[0].el : null);
  const src = img && srcOf(img);
  if (!src) return "";
  try {
    const response = await fetch(src, { credentials: "include" });
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch (error) {
    return src;
  }
})()"""

def photo_from(value):
    if isinstance(value, str) and value.startswith("data:image/") and len(value) < 80000:
        return value
    if isinstance(value, str) and value.startswith("http"):
        try:
            request = urllib.request.Request(value, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=15) as response:
                data = response.read(120000)
                kind = (response.headers.get("Content-Type") or "image/jpeg").split(";")[0]
            if not kind.startswith("image/") or not data:
                return ""
            encoded = base64.b64encode(data).decode()
            if len(encoded) >= 80000:
                return ""
            return "data:%s;base64,%s" % (kind, encoded)
        except Exception:
            return ""
    return ""

try:
    with urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=5) as response:
        targets = json.load(response)
    pages = [item for item in targets if item.get("type") == "page"]
    signed_in = [
        item for item in pages
        if "linkedin.com" in (item.get("url") or "")
        and "authwall" not in (item.get("url") or "")
        and "/login" not in (item.get("url") or "")
    ]
    def page_rank(item):
        url = item.get("url") or ""
        if "/feed" in url:
            return 0
        if "/in/" in url:
            return 1
        if "/messaging" in url:
            return 3
        return 2
    signed_in.sort(key=page_rank)
    page = signed_in[0] if signed_in else (pages[0] if pages else None)
    if page is None:
        raise RuntimeError("no-page")
    sock = ws_connect(page["webSocketDebuggerUrl"])
    seq = [1]
    def evaluate(expression, wait=False):
        seq[0] += 1
        result = call(sock, seq[0], "Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": wait})
        return (((result.get("result") or {}).get("result") or {}).get("value"))
    account = os.environ.get("ACCOUNT_NAME", "")
    evaluate("window.__liAccountName = %s" % json.dumps(account))
    found = ""
    for _wait in range(4):
        found = photo_from(evaluate(EXPR, True))
        if found:
            break
        time.sleep(1)
    href = str(evaluate("location.href") or "")
    if "authwall" in href or "/login" in href:
        found = ""
    if not found:
        href = str(evaluate("location.href") or "")
        sample = str(evaluate("(() => [...document.images].slice(0, 12).map((el) => { const box = el.getBoundingClientRect(); let host = (el.currentSrc || el.src || '').slice(0, 50); try { const url = new URL(el.currentSrc || el.src); host = url.hostname + url.pathname.slice(0, 36); } catch (e) {} return Math.round(box.top) + 'x' + Math.round(box.width) + ' ' + host; }).join(' | '))()") or "")
        print("PHOTO_MISS\\t%s\\t%s" % (href.split("?")[0][:80], sample[:300]), flush=True)
    print("PHOTO\\t" + found, flush=True)
except Exception as error:
    print("PHOTO_ERROR", type(error).__name__, flush=True)
`.trim();

/** Read the signed-in LinkedIn profile photo from the virtual machine and save it on the session. */
export async function captureLinkedinAccountPhoto(projectId: ObjectId) {
  const collection = await sessions();
  const saved = await collection.findOne({ projectId });
  if (!saved?.connected || saved.accountPhoto || !boatConfigured()) {
    return getLinkedinSession(projectId);
  }
  const sandbox = await ensureLinkedinBoat(projectId);
  if (sandbox.replacedDeletedDisk || !isBoatRunning(sandbox.state)) {
    return getLinkedinSession(projectId);
  }
  if (!(await chromeDebugOpen(sandbox.id))) {
    await openLinkedinChrome(sandbox.id, "https://www.linkedin.com/feed/", true);
    for (let attempt = 0; attempt < 8 && !(await chromeDebugOpen(sandbox.id)); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!(await chromeDebugOpen(sandbox.id))) return getLinkedinSession(projectId);
  const result = await runBoatCommand(
    sandbox.id,
    `ACCOUNT_NAME=${shellQuote(saved.accountName || "")} python3 -c ${shellQuote(ACCOUNT_PHOTO_PY)}`,
    40,
  );
  const line = result.stdout.split("\n").find((item) => item.startsWith("PHOTO\t"));
  const photo = line?.slice("PHOTO\t".length).trim() || "";
  if (photo.startsWith("data:image/") && photo.length < 80000) {
    await collection.updateOne({ projectId }, { $set: { accountPhoto: photo, updatedAt: new Date() } });
  } else if (result.stdout.includes("PHOTO_ERROR") || result.stdout.includes("PHOTO_MISS")) {
    console.info("[linkedin] account photo", result.stdout.slice(0, 240));
  }
  return getLinkedinSession(projectId);
}

function personStage(person: PersonDoc) {
  if (person.stage) return person.stage;
  return person.alreadyConnected ? "connected" : "request_sent";
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

type SendSchedule = {
  sendDays?: number[];
  windowStart?: string;
  windowEnd?: string;
  timezone?: string;
};

function clockInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value.slice(0, 3) || "Sun";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return { weekday: weekday < 0 ? 0 : weekday, minutes: hour * 60 + minute };
}

function clockMinutes(value: string | undefined) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function linkedinWindowOpen(schedule: SendSchedule | undefined, date: Date) {
  const days = (schedule?.sendDays || []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const start = clockMinutes(schedule?.windowStart);
  const end = clockMinutes(schedule?.windowEnd);
  if (!days.length && (start === null || end === null)) return true;
  const { weekday, minutes } = clockInZone(date, schedule?.timezone || "Asia/Kolkata");
  if (days.length && !days.includes(weekday)) return false;
  if (start === null || end === null || start >= end) return true;
  return minutes >= start && minutes < end;
}

function nextOpenSendAt(from: Date, schedule: SendSchedule | undefined) {
  if (linkedinWindowOpen(schedule, from)) return from;
  for (let step = 1; step <= 8 * 24 * 60; step += 1) {
    const candidate = new Date(from.getTime() + step * 60 * 1000);
    if (linkedinWindowOpen(schedule, candidate)) return candidate;
  }
  return from;
}

function readSendSchedule(input: {
  sendDays?: number[];
  windowStart?: string;
  windowEnd?: string;
  timezone?: string;
}): SendSchedule {
  const sendDays = [...new Set((input.sendDays || []).map((day) => Number(day)))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
  if (!sendDays.length) throw new Error("Choose at least one day to send.");
  const windowStart = String(input.windowStart || "");
  const windowEnd = String(input.windowEnd || "");
  const start = clockMinutes(windowStart);
  const end = clockMinutes(windowEnd);
  if (start === null || end === null || start >= end) {
    throw new Error("Choose a send time, with the end after the start.");
  }
  let timezone = String(input.timezone || "Asia/Kolkata");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    timezone = "Asia/Kolkata";
  }
  return { sendDays, windowStart, windowEnd, timezone };
}

function stageCounts(people: PersonDoc[]) {
  let requestCount = 0;
  let connectedCount = 0;
  let messageCount = 0;
  let requestsSent = 0;
  let messagesSent = 0;
  let replyCount = 0;
  for (const person of people) {
    const stage = personStage(person);
    if (stage === "request_sent") requestCount += 1;
    if (stage === "connected" || stage.startsWith("message_")) connectedCount += 1;
    if (stage.startsWith("message_")) messageCount += 1;
    if (person.inviteSent) requestsSent += 1;
    messagesSent += person.messagesSent || 0;
    if (stage === "reply") replyCount += 1;
  }
  return { requestCount, connectedCount, messageCount, requestsSent, messagesSent, replyCount };
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
    status: doc.paused ? "paused" : campaignStatus(doc.people),
    messageLabels: doc.messageLabels,
    delayAfterAcceptDays: doc.delayAfterAcceptDays,
    delayAfterMessageDays: doc.delayAfterMessageDays,
    peopleCount: doc.people.length,
    requestCount: counts.requestCount,
    connectedCount: counts.connectedCount,
    messageCount: counts.messageCount,
    requestsSent: counts.requestsSent,
    messagesSent: counts.messagesSent,
    replyCount: counts.replyCount,
    createdAt: doc.createdAt.toISOString(),
    listName: doc.listName || "",
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
    note:
      stage === "request_sent" && (person.connectionRequested || person.inviteSent)
        ? REQUEST_WAITING_NOTE
        : person.statusNote || "",
    crmContactId: person.crmContactId || "",
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

export async function deleteLinkedinCampaigns(projectId: ObjectId, ids: string[]) {
  const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  if (!objectIds.length) return { deleted: 0 };
  const db = await getDb();
  const result = await db.collection("linkedin_campaigns").deleteMany({
    projectId,
    _id: { $in: objectIds },
  });
  return { deleted: result.deletedCount };
}

export async function setLinkedinCampaignPaused(projectId: ObjectId, campaignId: string, paused: boolean) {
  if (!ObjectId.isValid(campaignId)) return null;
  const db = await getDb();
  const now = new Date();
  const result = await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
    { _id: new ObjectId(campaignId), projectId },
    {
      $set: { paused, updatedAt: now },
      ...(paused ? { $unset: { activePromptId: "", activePromptAt: "", activeTargets: "" } } : {}),
    },
  );
  if (!result.matchedCount) return null;
  return getLinkedinCampaign(projectId, campaignId);
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
  userId: ObjectId | null,
  input: {
    name?: string;
    listName?: string;
    fileName?: string;
    csv?: string;
    delayAfterAcceptDays?: number;
    delayAfterMessageDays?: number;
    sendDays?: number[];
    windowStart?: string;
    windowEnd?: string;
    timezone?: string;
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
  const schedule = readSendSchedule(input);

  const now = new Date();
  const savedList = await saveLinkedinCampaignList({
    projectId,
    userId,
    listName: String(input.listName || ""),
    fileName: String(input.fileName || ""),
    people: preview.people,
  });
  const db = await getDb();
  const campaignId = new ObjectId();
  const people = savedList.people.map((person, index) => {
    const alreadyConnected = person.alreadyConnected === true;
    return {
      id: `p${index + 1}`,
      name: person.name,
      firstName: person.firstName,
      lastName: person.lastName,
      companyName: person.companyName,
      crmContactId: person.crmContactId,
      linkedinUrl: person.linkedinUrl,
      messages: person.messages,
      ...(person.likeRecentPost ? { likeRecentPost: true } : {}),
      alreadyConnected,
      startedConnected: alreadyConnected,
      stage: launchLinkedinStage(person),
      messagesSent: 0,
      ...(alreadyConnected
        ? { connectedAt: now, nextActionAt: nextOpenSendAt(addDays(now, delayAfterAcceptDays), schedule) }
        : {}),
    };
  });
  const result = await db.collection<CampaignDoc>("linkedin_campaigns").insertOne({
    _id: campaignId,
    projectId,
    name,
    status: "running",
    messageLabels: preview.messageLabels,
    delayAfterAcceptDays,
    delayAfterMessageDays,
    sendDays: schedule.sendDays,
    windowStart: schedule.windowStart,
    windowEnd: schedule.windowEnd,
    timezone: schedule.timezone,
    listId: savedList.listId,
    listName: savedList.listName,
    people,
    createdAt: now,
    updatedAt: now,
  });
  await recordLinkedinCampaignStart({
    projectId,
    campaignId: campaignId.toString(),
    campaignName: name,
    people,
    at: now,
  }).catch((error) => {
    console.error("[linkedin] could not write the contact activity", error);
  });
  const doc = await db.collection<CampaignDoc>("linkedin_campaigns").findOne({
    _id: result.insertedId,
    projectId,
  });
  if (!doc) throw new Error("Campaign was not saved.");

  const opened = await openLinkedinComputer(projectId).catch(() => null);
  return { campaign: mapCampaign(doc), desktopUrl: opened?.desktopUrl };
}

function markConnected(
  person: PersonDoc,
  delayDays: number,
  now: Date,
  schedule?: SendSchedule,
): PersonDoc {
  if (person.stage?.startsWith("message_") || person.stage === "connected") {
    return person;
  }
  return {
    ...person,
    stage: "connected",
    alreadyConnected: true,
    connectedAt: now,
    messagesSent: person.messagesSent || 0,
    nextActionAt: nextOpenSendAt(addDays(now, delayDays), schedule),
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
      return markConnected(person, doc.delayAfterAcceptDays, now, doc);
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
  if (stage === "reply" || stage.startsWith("custom_") || person.statusNote === "They replied.") {
    return false;
  }
  if (stage !== "connected" && !stage.startsWith("message_")) return false;
  if (!person.nextActionAt || person.nextActionAt.getTime() > now.getTime()) return false;
  const sent = person.messagesSent || 0;
  return Boolean(person.messages[sent]?.trim());
}

const PROFILE_READ_WAIT_MS = 60 * 1000;
const COMPLETE_REPLY_WAIT_MS = 15 * 60 * 1000;
const CONNECTION_GAP_MS = 5 * 60 * 1000;
const WATCH_QUIET_MS = 10 * 60 * 1000;
const LOGIN_HOLD_MS = 30 * 60 * 1000;
const PROFILE_WATCH_MS = 150_000;
const INBOX_WATCH_MS = 90_000;
const STALE_MESSAGE_NOTES = new Set([
  "They accepted the connection request.",
  "They replied.",
  "The check could not run. It will try again.",
  "They accepted. The message could not be sent. It will try again.",
]);

let followUpRun: Promise<{ sent: number }> | null = null;

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

export async function addLinkedinStage(
  projectId: ObjectId,
  campaignId: string,
  label: string,
  color?: string,
) {
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
  custom.push({
    id: `custom_${Date.now().toString(36)}`,
    label: name,
    color: (KANBAN_DOT_COLORS as readonly string[]).includes(color || "")
      ? color
      : DEFAULT_STAGE_COLOR,
  });
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
        nextActionAt: hasNext ? nextOpenSendAt(addDays(now, doc.delayAfterMessageDays), doc) : undefined,
      };
    }
    if (stage === "connected") {
      const sent = person.messagesSent || 0;
      return {
        ...person,
        stage,
        alreadyConnected: true,
        connectedAt: person.connectedAt || now,
        nextActionAt: person.messages[sent]?.trim() ? nextOpenSendAt(now, doc) : undefined,
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

/** One desktop-agent step: a single profile in that campaign's tab, or the LinkedIn inbox. */
export function processDueLinkedinMessages(now = new Date()) {
  if (followUpRun) return followUpRun;
  followUpRun = runLinkedinFollowUps(now).finally(() => {
    followUpRun = null;
  });
  return followUpRun;
}

(globalThis as typeof globalThis & { __nexusesLinkedinFollowUp?: typeof processDueLinkedinMessages }).__nexusesLinkedinFollowUp =
  processDueLinkedinMessages;

type BoatTarget = {
  id: string;
  url: string;
  name: string;
  messages: { number: number; text: string }[];
  sendConnect?: boolean;
};

type LinkedinAction = {
  priority: number;
  kind: "connect" | "status" | "message" | "like";
  doc: CampaignDoc;
  index: number;
  person: PersonDoc;
  like: boolean;
  message?: { number: number; text: string };
};

type ReadyCampaign = { doc: CampaignDoc; sandboxId: string };

function boatLockFresh(doc: CampaignDoc, now: Date) {
  if (!doc.activePromptId) return false;
  return now.getTime() - (doc.activePromptAt?.getTime() || 0) < 3 * 60 * 1000;
}

function pickCampaignAction(doc: CampaignDoc, now: Date, connectGapOpen: boolean): LinkedinAction | null {
  const limitHold = Boolean(
    doc.connectionCheckAt && doc.connectionCheckAt.getTime() > now.getTime() + PROFILE_READ_WAIT_MS,
  );
  let best: LinkedinAction | null = null;
  const consider = (action: LinkedinAction) => {
    if (!best || action.priority < best.priority) best = action;
  };
  doc.people.forEach((person, index) => {
    if (!person.linkedinUrl) return;
    const stage = personStage(person);
    const sinceLook = person.replyCheckedAt ? now.getTime() - person.replyCheckedAt.getTime() : Infinity;
    if (messageDue(person, now)) {
      const message = messagesToSend(person, doc.delayAfterMessageDays)[0];
      if (message) {
        consider({ priority: 0, kind: "message", doc, index, person, like: false, message });
      }
    }
    const needsRequest =
      stage === "request_sent" && !person.connectionRequested && (person.messagesSent || 0) === 0;
    const lookFailed = person.statusNote === BUTTONS_HIDDEN_NOTE;
    if (needsRequest && (connectGapOpen || lookFailed) && !limitHold && (lookFailed || sinceLook >= CONNECTION_GAP_MS)) {
      consider({ priority: 1, kind: "connect", doc, index, person, like: false });
    }
  });
  return best;
}

function replyCandidates(items: ReadyCampaign[]) {
  return items.flatMap((item) =>
    item.doc.people.filter((person) => {
      const stage = personStage(person);
      return (
        stage === "connected" ||
        stage.startsWith("message_") ||
        (person.messagesSent || 0) > 0 ||
        (stage === "request_sent" && Boolean(person.connectionRequested))
      );
    }),
  );
}

function watchWait(items: ReadyCampaign[], activeMs: number) {
  return items.every((item) => item.doc.status === "complete") ? COMPLETE_REPLY_WAIT_MS : activeMs;
}

function repliesDue(items: ReadyCampaign[], session: SessionDoc, now: Date) {
  if (!replyCandidates(items).length) return false;
  if (!session.repliesCheckedAt) return true;
  return now.getTime() - session.repliesCheckedAt.getTime() >= watchWait(items, WATCH_QUIET_MS);
}

function acceptsDue(items: ReadyCampaign[], session: SessionDoc, now: Date) {
  const waiting = items.some((item) =>
    item.doc.people.some(
      (person) => personStage(person) === "request_sent" && person.connectionRequested,
    ),
  );
  if (!waiting) return false;
  if (!session.acceptsCheckedAt) return true;
  return now.getTime() - session.acceptsCheckedAt.getTime() >= watchWait(items, WATCH_QUIET_MS);
}

function visitFromReport(report: LinkedinBoatReport, messageNumber: number) {
  const status = report.status;
  let state: ProfileRead = "unknown";
  if (
    status === "pending" ||
    status === "connected" ||
    status === "connect" ||
    status === "rejected" ||
    status === "login"
  ) {
    state = status;
  } else if (status === "sent" || status === "replied") {
    state = "connected";
  }
  const replied = status === "replied";
  const limited = status === "limited";
  const sentNumber = status === "sent" && !replied ? report.message || messageNumber : 0;
  const visit: ProfileVisit = {
    state,
    sent: sentNumber > 0 ? [sentNumber] : [],
    replied: replied ? true : null,
    requested: !limited && (report.sentRequest || state === "pending"),
    liked: report.liked,
  };
  return { visit, limited, sentRequest: report.sentRequest && !limited };
}

function peopleAfterVisit(
  doc: CampaignDoc,
  targets: BoatTarget[],
  states: Map<string, ProfileVisit>,
  now: Date,
  limited: boolean,
) {
  const people = doc.people.map((person, index) => {
    const id = person.id || `p${index + 1}`;
    const visit = states.get(id);
    if (!visit) return person;
    console.info(
      `[linkedin] ${person.name}: ${visit.state} sent=${visit.sent.join(",") || "none"}`,
    );
    const stage = personStage(person);
    if (limited && targets.some((target) => target.id === id && target.sendConnect)) {
      return {
        ...person,
        replyCheckedAt: now,
        statusNote: "LinkedIn is limiting connection requests. It will try again later.",
      };
    }
    if (visit.replied === true) {
      return withoutNextAction(person, {
        stage: "reply",
        alreadyConnected: true,
        connectedAt: person.connectedAt || now,
        connectionRequested: true,
        replyCheckedAt: now,
        statusNote: "They replied.",
      });
    }
    if (visit.replied === false && stage.startsWith("message_") && !visit.sent.length) {
      const allSent = !(person.messages[person.messagesSent || 0] || "").trim();
      const note =
        allSent && (!person.statusNote || STALE_MESSAGE_NOTES.has(person.statusNote))
          ? "All messages were sent."
          : person.statusNote;
      return { ...person, connectionRequested: true, replyCheckedAt: now, statusNote: note };
    }
    const triedMessage = targets.some((target) => target.id === id && target.messages.length > 0);
    if ((visit.state === "unknown" || visit.state === "login") && stage.startsWith("message_") && !visit.sent.length) {
      return {
        ...person,
        replyCheckedAt: now,
        ...(triedMessage
          ? {
              statusNote: "The message could not be sent. It will try again.",
              nextActionAt: new Date(now.getTime() + CONNECTION_GAP_MS),
            }
          : {}),
      };
    }
    if (visit.sent.length) {
      const maxSent = Math.max(...visit.sent);
      const hasNext = Boolean(person.messages[maxSent]?.trim());
      return {
        ...person,
        stage: `message_${maxSent}`,
        messagesSent: maxSent,
        alreadyConnected: true,
        connectedAt: person.connectedAt || now,
        connectionRequested: true,
        replyCheckedAt: now,
        statusNote: hasNext ? `Message ${maxSent} was sent.` : "All messages were sent.",
        nextActionAt: hasNext ? nextOpenSendAt(addDays(now, doc.delayAfterMessageDays), doc) : undefined,
      };
    }
    const state = visit.state;
    if (state === "pending" || visit.requested) {
      return withoutNextAction(person, {
        stage: "request_sent",
        connectionRequested: true,
        inviteSent: true,
        replyCheckedAt: now,
        statusNote: REQUEST_WAITING_NOTE,
      });
    }
    if (state === "connect" || state === "rejected") {
      if (person.connectionRequested) {
        return withoutNextAction(person, {
          stage: "connection_rejected",
          replyCheckedAt: now,
          statusNote: "They rejected the connection request.",
        });
      }
      return {
        ...person,
        stage: "request_sent",
        replyCheckedAt: now,
        statusNote: "The connection request could not be sent. It will try again.",
      };
    }
    if (state === "connected") {
      const marked = markConnected(person, doc.delayAfterAcceptDays, now, doc);
      const unsent = messagesToSend(marked, doc.delayAfterMessageDays);
      if (unsent.length && triedMessage) {
        return {
          ...marked,
          connectionRequested: true,
          replyCheckedAt: now,
          statusNote: "They accepted. The message could not be sent. It will try again.",
          nextActionAt: new Date(now.getTime() + CONNECTION_GAP_MS),
        };
      }
      if (stage.startsWith("message_") || stage === "connected") {
        return {
          ...person,
          connectionRequested: true,
          alreadyConnected: true,
          connectedAt: person.connectedAt || now,
          replyCheckedAt: now,
        };
      }
      const accepted = {
        ...marked,
        connectionRequested: true,
        replyCheckedAt: now,
        statusNote: "They accepted the connection request.",
      };
      if ((person.messages[person.messagesSent || 0] || "").trim()) return accepted;
      return withoutNextAction(accepted, {});
    }
    if (stage !== "request_sent") return person;
    if (person.connectionRequested || person.inviteSent) {
      return { ...person, replyCheckedAt: now, statusNote: REQUEST_WAITING_NOTE };
    }
    return {
      ...person,
      replyCheckedAt: now,
      statusNote: state === "login"
        ? "LinkedIn needs a sign-in before this profile can be checked."
        : BUTTONS_HIDDEN_NOTE,
    };
  });
  people.forEach((person, index) => {
    const id = person.id || `p${index + 1}`;
    if (!states.get(id)?.liked) return;
    person.likedRecentPost = true;
  });
  return people;
}

function withInboxReply(
  person: PersonDoc,
  replies: { name: string; text: string }[],
  accountName: string,
  now: Date,
) {
  const stage = personStage(person);
  if (stage.startsWith("custom_")) return person;
  const hit = replies.find(
    (reply) => sameLinkedinName(person.name, reply.name) && !sameLinkedinName(accountName, reply.name),
  );
  if (!hit) return person;
  const watching =
    stage === "reply" ||
    stage === "connected" ||
    stage.startsWith("message_") ||
    (stage === "request_sent" && Boolean(person.connectionRequested)) ||
    (person.messagesSent || 0) > 0;
  if (!watching) return person;
  const statusNote = hit.text || "They replied.";
  if (stage === "reply") {
    if (person.statusNote === statusNote) return person;
    if (!hit.text && person.statusNote && person.statusNote !== "They replied.") return person;
    return { ...person, replyCheckedAt: now, statusNote };
  }
  return withoutNextAction(person, {
    stage: "reply",
    alreadyConnected: true,
    connectedAt: person.connectedAt || now,
    connectionRequested: true,
    replyCheckedAt: now,
    statusNote,
  });
}

function withAccepted(
  person: PersonDoc,
  names: string[],
  accountName: string,
  now: Date,
  doc: CampaignDoc,
) {
  if (personStage(person) !== "request_sent" || !person.connectionRequested) return person;
  const hit = names.some(
    (name) => sameLinkedinName(person.name, name) && !sameLinkedinName(accountName, name),
  );
  if (!hit) return person;
  const marked = markConnected(person, doc.delayAfterAcceptDays, now, doc);
  const accepted = {
    ...marked,
    connectionRequested: true,
    replyCheckedAt: now,
    statusNote: "They accepted the connection request.",
  };
  if ((person.messages[person.messagesSent || 0] || "").trim()) return accepted;
  return withoutNextAction(accepted, {});
}

function cleanReplyText(personName: string, snippet: string) {
  let text = snippet.replace(/\s+/g, " ").trim();
  text = text.replace(/^\d{1,2}:\d{2}\s*(am|pm)?\s*/i, "");
  const labels = [personName, ...personName.split(/\s+/).filter((part) => part.length > 1)];
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`^${escaped}\\s*:\\s*`, "i"), "");
  }
  return text.slice(0, 280);
}

function inboxReplies(rows: LinkedinInboxRow[], people: PersonDoc[]) {
  const replies: { name: string; text: string }[] = [];
  for (const row of rows) {
    const person = people.find((item) => sameLinkedinName(item.name, row.name));
    if (!person || replies.some((item) => item.name === person.name)) continue;
    const stage = personStage(person);
    const messaged =
      stage.startsWith("message_") ||
      stage === "connected" ||
      stage === "reply" ||
      (person.messagesSent || 0) > 0;
    const snippet = row.snippet.trim();
    const fromUs = /^you\s*:/i.test(snippet);
    const fromThem = row.unread || (Boolean(snippet) && !fromUs);
    if (!fromThem || fromUs) continue;
    if (!(messaged || row.unread)) continue;
    replies.push({ name: person.name, text: cleanReplyText(person.name, snippet) });
  }
  return replies;
}

function campaignMarkers(items: ReadyCampaign[]) {
  return items.map((item) => campaignTabMarker(item.doc._id.toString()));
}

function linkedinKeepTabs(items: ReadyCampaign[]) {
  return [...campaignMarkers(items), LINKEDIN_REPLIES_TAB, LINKEDIN_NETWORK_TAB];
}

async function commitLinkedinPeople(
  doc: CampaignDoc,
  now: Date,
  people: PersonDoc[],
  options: { limited?: boolean; sentRequest?: boolean; schedule?: boolean },
) {
  const db = await getDb();
  const previous = doc.people;
  let sent = 0;
  for (let index = 0; index < people.length; index += 1) {
    const before = previous[index];
    const after = people[index];
    if (!before || !after?.crmContactId) continue;
    const events = linkedinTimelineChanges({
      campaignId: doc._id.toString(),
      campaignName: doc.name,
      personId: after.id || `p${index + 1}`,
      previous: before,
      next: after,
      at: now,
    });
    if (!events.length) continue;
    await appendLinkedinTimeline(doc.projectId, after.crmContactId, events).catch((error) => {
      console.error("[linkedin] could not write the contact activity", error);
    });
  }
  sent += people.filter((person, index) => (person.messagesSent || 0) > (previous[index]?.messagesSent || 0)).length;
  const stored = await db.collection<CampaignDoc>("linkedin_campaigns").findOne(
    { _id: doc._id },
    { projection: { people: 1 } },
  );
  const merged = people.map((person, index) => {
    const earlier = stored?.people[index];
    if (!earlier || earlier.linkedinUrl !== person.linkedinUrl) return person;
    return {
      ...person,
      startedConnected: person.startedConnected === true || earlier.startedConnected === true,
      inviteSent: person.inviteSent === true || earlier.inviteSent === true,
      likedRecentPost: person.likedRecentPost === true || earlier.likedRecentPost === true,
    };
  });
  const schedule = options.schedule !== false;
  await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
    { _id: doc._id },
    {
      $set: {
        people: merged,
        status: campaignStatus(merged),
        updatedAt: now,
        ...(schedule
          ? {
              lastBoatAt: now,
              connectionCheckAt: options.limited ? new Date(now.getTime() + 30 * 60 * 1000) : now,
            }
          : {}),
      },
      $unset: { activePromptId: "", activePromptAt: "", activeTargets: "" },
    },
  );
  if (options.sentRequest) {
    await db.collection<SessionDoc>("linkedin_sessions").updateOne(
      { projectId: doc.projectId },
      { $set: { lastConnectionRequestAt: now, updatedAt: now } },
    );
  }
  return sent;
}

async function ensureLinkedinChrome(sandboxId: string) {
  if (await chromeDebugOpen(sandboxId)) return true;
  await openLinkedinChrome(sandboxId, LINKEDIN_MESSAGING_URL, true);
  for (let attempt = 0; attempt < 10 && !(await chromeDebugOpen(sandboxId)); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return chromeDebugOpen(sandboxId);
}

async function clearBoatLock(doc: CampaignDoc) {
  const db = await getDb();
  await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
    { _id: doc._id },
    { $unset: { activePromptId: "", activePromptAt: "", activeTargets: "" } },
  );
}

async function runLinkedinProfileStep(
  action: LinkedinAction,
  sandboxId: string,
  now: Date,
  keep: string[],
) {
  const doc = action.doc;
  const person = action.person;
  const id = person.id || `p${action.index + 1}`;
  const db = await getDb();
  let saved = false;
  await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
    { _id: doc._id },
    { $set: { activePromptId: "boat", activePromptAt: now, updatedAt: now } },
  );
  try {
    const slug = linkedinProfileSlug(person.linkedinUrl);
    const focus = await focusLinkedinTab(
      sandboxId,
      campaignTabMarker(doc._id.toString()),
      person.linkedinUrl,
      slug || "/in/",
      keep,
    );
    const messages = action.message ? [action.message] : [];
    const target: BoatTarget = {
      id,
      url: person.linkedinUrl,
      name: person.name,
      messages,
      ...(action.kind === "connect" ? { sendConnect: true } : {}),
    };
    let visit: ProfileVisit = { state: focus.state === "login" ? "login" : "unknown", sent: [], replied: null, requested: false };
    let limited = false;
    let sentRequest = false;
    if (focus.state === "ready") {
      const result = await runLinkedinBoatTask(
        sandboxId,
        linkedinProfileTask({
          campaignName: doc.name,
          personName: person.name,
          url: person.linkedinUrl,
          kind: action.kind,
          message: action.message,
          like: action.like,
        }),
        PROFILE_WATCH_MS,
      );
      console.info("[linkedin] boat", (result.report || result.status || "").slice(0, 400));
      const report = parseLinkedinBoatReport(result.report || "");
      const read = visitFromReport(report, action.kind === "message" ? action.message?.number || 0 : 0);
      visit = read.visit;
      if (action.kind !== "message") visit.sent = [];
      limited = read.limited;
      sentRequest =
        action.kind === "connect" &&
        !limited &&
        visit.state !== "unknown" &&
        visit.state !== "login" &&
        (read.sentRequest || visit.state === "pending");
    }
    const people = peopleAfterVisit(doc, [target], new Map([[id, visit]]), now, limited);
    const sent = await commitLinkedinPeople(doc, now, people, { limited, sentRequest });
    saved = true;
    return sent;
  } finally {
    await focusLinkedinTab(sandboxId, campaignTabMarker(doc._id.toString()), "", "", keep).catch(
      () => "failed" as const,
    );
    if (!saved) await clearBoatLock(doc).catch(() => undefined);
  }
}

async function runLinkedinWatchStep(
  items: ReadyCampaign[],
  session: SessionDoc,
  sandboxId: string,
  now: Date,
  watch: {
    marker: string;
    url: string;
    expect: string;
    task: string;
    label: string;
    stamp: "repliesCheckedAt" | "acceptsCheckedAt";
  },
) {
  const db = await getDb();
  const lockDoc = items[0].doc;
  const keep = linkedinKeepTabs(items);
  let saved = false;
  await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
    { _id: lockDoc._id },
    { $set: { activePromptId: "boat", activePromptAt: now, updatedAt: now } },
  );
  try {
    const focus = await focusLinkedinTab(sandboxId, watch.marker, watch.url, watch.expect, keep, true);
    if (focus.state === "login") {
      await db.collection<SessionDoc>("linkedin_sessions").updateOne(
        { projectId: session.projectId },
        {
          $set: {
            [watch.stamp]: now,
            loginHoldUntil: new Date(now.getTime() + LOGIN_HOLD_MS),
            updatedAt: now,
          },
        },
      );
      console.info("[linkedin] LinkedIn is asking for a sign-in. The computer will stay still.");
      saved = true;
      return 0;
    }
    let accepted: string[] = [];
    let replies: { name: string; text: string }[] = [];
    if (focus.state === "ready" && watch.stamp === "repliesCheckedAt") {
      const people = items.flatMap((item) => item.doc.people);
      replies = inboxReplies(focus.inbox, people);
      console.info(
        "[linkedin] inbox",
        focus.inbox
          .map((row) => `${row.name} | ${row.snippet || "no preview"} | ${row.unread ? "unread" : "read"}`)
          .join(" || ")
          .slice(0, 500) || "no conversations",
      );
      if (replies.length) console.info("[linkedin] replies found", replies.map((reply) => reply.name).join(", "));
      await db.collection<SessionDoc>("linkedin_sessions").updateOne(
        { projectId: session.projectId },
        { $set: { repliesCheckedAt: now, updatedAt: now } },
      );
    } else if (focus.state === "ready") {
      accepted = focus.accepted;
      if (accepted.length) console.info("[linkedin] accepts found", accepted.join(", "));
      await db.collection<SessionDoc>("linkedin_sessions").updateOne(
        { projectId: session.projectId },
        { $set: { [watch.stamp]: now, updatedAt: now } },
      );
    }
    let sent = 0;
    const accountName = session.accountName || "";
    for (const item of items) {
      const people = item.doc.people
        .map((person) => withAccepted(person, accepted, accountName, now, item.doc))
        .map((person) => withInboxReply(person, replies, accountName, now));
      const changed = people.some((person, index) => {
        const before = item.doc.people[index];
        return person.stage !== before?.stage || person.statusNote !== before?.statusNote;
      });
      if (!changed) continue;
      sent += await commitLinkedinPeople(item.doc, now, people, { schedule: false });
    }
    saved = true;
    return sent;
  } finally {
    if (!saved) await clearBoatLock(lockDoc).catch(() => undefined);
    else {
      await db
        .collection<CampaignDoc>("linkedin_campaigns")
        .updateOne({ _id: lockDoc._id }, { $unset: { activePromptId: "", activePromptAt: "", activeTargets: "" } })
        .catch(() => undefined);
    }
  }
}

async function runProjectLinkedinStep(items: ReadyCampaign[], now: Date) {
  const projectId = items[0].doc.projectId;
  const sandboxId = items[0].sandboxId;
  if (items.some((item) => boatLockFresh(item.doc, now))) return 0;
  const db = await getDb();
  const session = await db.collection<SessionDoc>("linkedin_sessions").findOne({
    projectId,
    connected: true,
  });
  if (!session) return 0;
  if (session.loginHoldUntil && session.loginHoldUntil.getTime() > now.getTime()) return 0;
  const connectGapOpen =
    !session.lastConnectionRequestAt ||
    now.getTime() - session.lastConnectionRequestAt.getTime() >= CONNECTION_GAP_MS;
  const ordered = [...items].sort(
    (a, b) => (a.doc.lastBoatAt?.getTime() || 0) - (b.doc.lastBoatAt?.getTime() || 0),
  );
  let best: LinkedinAction | null = null;
  for (const item of ordered) {
    const action = pickCampaignAction(item.doc, now, connectGapOpen);
    if (action && (!best || action.priority < best.priority)) best = action;
  }
  const readReplies = repliesDue(ordered, session, now);
  const readAccepts = acceptsDue(ordered, session, now);
  if (!best && !readReplies && !readAccepts) return 0;
  if (!(await ensureLinkedinChrome(sandboxId))) return 0;
  const keep = linkedinKeepTabs(ordered);
  const accountName = session.accountName || "";
  if (readReplies) {
    console.info("[linkedin] reading the messaging tab for replies");
    return runLinkedinWatchStep(ordered, session, sandboxId, now, {
      marker: LINKEDIN_REPLIES_TAB,
      url: LINKEDIN_MESSAGING_URL,
      expect: "linkedin.com/messaging",
      task: linkedinRepliesTask(
        accountName,
        replyCandidates(ordered).map((person) => person.name),
      ),
      label: "replies",
      stamp: "repliesCheckedAt",
    });
  }
  if (readAccepts && best?.kind !== "message") {
    console.info("[linkedin] reading the network tab for accepts");
    return runLinkedinWatchStep(ordered, session, sandboxId, now, {
      marker: LINKEDIN_NETWORK_TAB,
      url: LINKEDIN_NETWORK_URL,
      expect: "linkedin.com/notifications",
      task: linkedinNetworkTask(accountName, []),
      label: "network",
      stamp: "acceptsCheckedAt",
    });
  }
  if (!best) return 0;
  await fillLinkedinChrome(sandboxId);
  console.info(
    `[linkedin] ${best.doc.name}: ${best.kind} ${best.person.name} in ${campaignTabMarker(best.doc._id.toString())}`,
  );
  return runLinkedinProfileStep(best, sandboxId, now, keep);
}

async function runLinkedinFollowUps(now = new Date()) {
  await sessions();
  const db = await getDb();
  const docs = await db
    .collection<CampaignDoc>("linkedin_campaigns")
    .find({ status: { $in: ["running", "complete"] } })
    .toArray();
  docs.sort((a, b) => Number(a.status !== "running") - Number(b.status !== "running"));
  if (!boatConfigured()) return { sent: 0 };
  const ready: ReadyCampaign[] = [];
  for (const doc of docs) {
    if (doc.paused) continue;
    const statusNow = campaignStatus(doc.people);
    if (statusNow !== doc.status) {
      await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
        { _id: doc._id },
        { $set: { status: statusNow, updatedAt: now } },
      );
      doc.status = statusNow;
    }
    const sandbox = await linkedinComputer(doc.projectId).catch(() => null);
    if (!sandbox || !isBoatRunning(sandbox.state)) continue;
    if (sandbox.replacedDeletedDisk) {
      if (doc.activePromptId) {
        await clearBoatLock(doc);
        doc.activePromptId = undefined;
      }
      continue;
    }
    const signedIn = await db.collection<SessionDoc>("linkedin_sessions").findOne({
      projectId: doc.projectId,
      connected: true,
    });
    if (!signedIn) continue;
    if (!linkedinWindowOpen(doc, now)) continue;
    ready.push({ doc, sandboxId: sandbox.id });
  }
  const groups = new Map<string, ReadyCampaign[]>();
  for (const item of ready) {
    const key = String(item.doc.projectId);
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  const counts = await Promise.all(
    [...groups.values()].map(async (items) => {
      try {
        return await runProjectLinkedinStep(items, now);
      } catch (error) {
        console.error("[linkedin] step failed", error);
        return 0;
      }
    }),
  );
  return { sent: counts.reduce((sum, count) => sum + count, 0) };
}
