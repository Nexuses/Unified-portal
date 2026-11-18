import { interruptBoatAgent, runBoatCommand, runBoatDesktopTask, shellQuote } from "@/lib/boat";

/** Messaging inbox. This tab stays open and is the only place replies are read. */
export const LINKEDIN_MESSAGING_URL = "https://www.linkedin.com/messaging/";
/** Notification list. This tab stays open and is where an accept shows up. */
export const LINKEDIN_NETWORK_URL = "https://www.linkedin.com/notifications/";
export const LINKEDIN_REPLIES_TAB = "nexuses-li-replies";
export const LINKEDIN_NETWORK_TAB = "nexuses-li-network";

export function campaignTabMarker(campaignId: string) {
  const clean = campaignId.replace(/[^a-zA-Z0-9]/g, "") || "campaign";
  return `nexuses-li-${clean}`;
}

export function linkedinProfileSlug(url: string) {
  const path = url.split("?")[0].replace(/\/+$/, "");
  const slug = path.split("/").pop() || "";
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

const LINKEDIN_TAB_PY = `
import json, os, socket, base64, time, urllib.request, re
marker = os.environ.get("TAB_MARKER") or "nexuses-li-campaign"
url = os.environ.get("TAB_URL") or ""
expect = os.environ.get("TAB_EXPECT") or ""
quiet = os.environ.get("TAB_QUIET") == "1"
keep = set(part for part in (os.environ.get("TAB_KEEP") or "").split(",") if part)
keep.add(marker)

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

def ws_connect(ws_url):
    rest = ws_url.split("://", 1)[1]
    hostport, path = rest.split("/", 1)
    host, port = hostport.split(":")
    sock = socket.create_connection((host, int(port)), 15)
    key = base64.b64encode(os.urandom(16)).decode()
    req = "GET /%s HTTP/1.1\\r\\nHost: %s\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: %s\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n" % (path, hostport, key)
    sock.sendall(req.encode())
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

def page_targets():
    with urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=5) as response:
        return [item for item in json.load(response) if item.get("type") == "page"]

def browser_socket():
    with urllib.request.urlopen("http://127.0.0.1:9222/json/version", timeout=5) as response:
        return ws_connect(json.load(response)["webSocketDebuggerUrl"])

def window_name(item):
    try:
        probe = ws_connect(item["webSocketDebuggerUrl"])
        result = call(probe, 1, "Runtime.evaluate", {"expression": "window.name", "returnByValue": True})
        return (((result.get("result") or {}).get("result") or {}).get("value")) or ""
    except Exception:
        return ""

pages = page_targets()
named = []
for item in pages:
    copied = dict(item)
    copied["_name"] = window_name(item)
    named.append(copied)
page = next((item for item in named if item.get("_name") == marker), None)
if page is None:
    for item in named:
        name = item.get("_name") or ""
        href = item.get("url") or ""
        if name in keep and name != marker:
            continue
        if name.startswith("nexuses-li-") and name != marker:
            continue
        if marker != "nexuses-li-replies" and "linkedin.com/messaging" in href:
            continue
        if marker != "nexuses-li-network" and "linkedin.com/notifications" in href:
            continue
        if marker in ("nexuses-li-replies", "nexuses-li-network") and "/in/" in href:
            continue
        if "linkedin.com" in href or href.startswith("about:") or href.startswith("chrome:") or not href:
            page = item
            break
if page is None:
    browser = browser_socket()
    created = call(browser, 1, "Target.createTarget", {"url": "about:blank"})
    target_id = (created.get("result") or {}).get("targetId")
    page = None
    for _wait in range(10):
        time.sleep(0.3)
        found = page_targets()
        page = next((item for item in found if item.get("id") == target_id), None)
        if page:
            break
    if page is None:
        raise RuntimeError("no-tab")
sock = ws_connect(page["webSocketDebuggerUrl"])
call(sock, 2, "Runtime.evaluate", {"expression": "window.name = %s" % json.dumps(marker), "returnByValue": True})
if not quiet:
    try:
        browser = browser_socket()
        call(browser, 3, "Target.activateTarget", {"targetId": page.get("id")})
    except Exception:
        pass
    call(sock, 4, "Page.bringToFront", {})
call(sock, 5, "Page.enable", {})
seq = [10]
def evaluate(expression):
    seq[0] += 1
    result = call(sock, seq[0], "Runtime.evaluate", {"expression": expression, "returnByValue": True})
    return (((result.get("result") or {}).get("result") or {}).get("value"))
def close_extras():
    try:
        browser = browser_socket()
    except Exception:
        return
    current = page.get("id")
    for item in page_targets():
        if item.get("id") == current:
            continue
        name = ""
        for known in named:
            if known.get("id") == item.get("id"):
                name = known.get("_name") or ""
                break
        if not name:
            name = window_name(item)
        if name in keep:
            continue
        try:
            call(browser, 80, "Target.closeTarget", {"targetId": item.get("id")})
        except Exception:
            pass

def on_inbox(location):
    return (
        "linkedin.com/messaging" in location
        and "/messaging/thread" not in location
        and "/messaging/compose" not in location
    )

href = str(evaluate("location.href") or "")
needs_nav = False
if url:
    if "linkedin.com/messaging" in url and not on_inbox(href):
        needs_nav = True
    elif "linkedin.com/messaging" not in url and (not expect or expect not in href):
        needs_nav = True
if needs_nav:
    seq[0] += 1
    call(sock, seq[0], "Page.navigate", {"url": url})
    for _wait in range(12):
        time.sleep(1)
        href = str(evaluate("location.href") or "")
        if "linkedin.com/messaging" in url:
            if on_inbox(href):
                break
        elif (expect and expect in href) or (not expect and url.split("?")[0] in href):
            break
if not quiet:
    close_extras()
title = str(evaluate("document.title || ''") or "")
href = str(evaluate("location.href") or "")
if expect and expect not in href:
    if re.search(r"sign in|join linkedin|authwall|login", title, re.I):
        print("TAB_LOGIN\\t%s" % href[:180])
    else:
        print("TAB_FAIL\\t%s" % href[:180])
elif re.search(r"sign in|join linkedin|authwall", title, re.I) and "messaging" not in href and "/in/" not in href and "feed" not in href:
    print("TAB_LOGIN\\t%s" % href[:180])
else:
    if marker == "nexuses-li-replies" and not on_inbox(href):
        print("TAB_FAIL\\t%s" % href[:180])
    else:
        if "/in/" in href and not quiet:
            evaluate("window.scrollTo(0,0)")
            evaluate("(() => { const h1 = document.querySelector('h1'); if (h1) h1.scrollIntoView({block:'start'}); return 'ok'; })()")
            time.sleep(0.8)
        if marker == "nexuses-li-replies" and on_inbox(href):
            for _wait in range(8):
                count = evaluate(
                    "Array.from(document.querySelectorAll('a')).filter((node) => String(node.href || '').indexOf('/messaging/thread') >= 0).length"
                )
                if count:
                    break
                time.sleep(0.5)
            payload = evaluate(
            "(() => {"
            "const rows = [];"
            "const seen = {};"
            "const tidy = (value) => {"
            "let out = '';"
            "let gap = false;"
            "const text = String(value || '');"
            "for (let i = 0; i < text.length; i += 1) {"
            "const code = text.charCodeAt(i);"
            "const space = code === 9 || code === 10 || code === 13 || code === 32 || code === 160;"
            "if (space) { gap = out.length > 0; continue; }"
            "if (gap) out += ' ';"
            "gap = false;"
            "out += text.charAt(i);"
            "}"
            "return out.trim();"
            "};"
            "const take = (name, snippet, unread) => {"
            "const clean = tidy(name).slice(0, 80);"
            "const key = clean.toLowerCase();"
            "if (!clean || clean.length < 2 || seen[key]) return;"
            "if (key.indexOf('jump to') === 0 || key.indexOf('search') === 0 || key === 'messaging' || key === 'focused' || key === 'other' || key === 'inmail') return;"
            "seen[key] = 1;"
            "rows.push({ name: clean, snippet: tidy(snippet).slice(0, 180), unread: !!unread });"
            "};"
            "const nodes = [];"
            "const visit = (root) => {"
            "if (!root || !root.querySelectorAll) return;"
            "Array.from(root.querySelectorAll('li, div')).forEach((node) => {"
            "const cls = ((node.getAttribute && node.getAttribute('class')) || '').toLowerCase();"
            "if (cls.indexOf('conversation-listitem') < 0 && cls.indexOf('conversation-card') < 0) return;"
            "if (nodes.indexOf(node) >= 0) return;"
            "nodes.push(node);"
            "});"
            "Array.from(root.querySelectorAll('*')).forEach((node) => { if (node.shadowRoot) visit(node.shadowRoot); });"
            "};"
            "visit(document);"
            "const cards = nodes.filter((node) => !nodes.some((other) => other !== node && other.contains && other.contains(node)));"
            "cards.forEach((node) => {"
            "if (rows.length >= 30) return;"
            "const cls = ((node.getAttribute && node.getAttribute('class')) || '').toLowerCase();"
            "let person = '';"
            "let preview = '';"
            "Array.from(node.querySelectorAll('*')).forEach((child) => {"
            "const childCls = ((child.getAttribute && child.getAttribute('class')) || '').toLowerCase();"
            "if (!person && childCls.indexOf('participant') >= 0) person = child.innerText || '';"
            "if (!preview && childCls.indexOf('snippet') >= 0) preview = child.innerText || '';"
            "});"
            "const text = String(node.innerText || '').trim();"
            "const lines = text.split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean);"
            "if (!person) person = lines[0] || '';"
            "if (!preview) preview = lines.slice(1).join(' ');"
            "take(person, preview, cls.indexOf('unread') >= 0);"
            "});"
            "if (!rows.length) {"
            "Array.from(document.querySelectorAll('li, h3, span')).forEach((node) => {"
            "if (rows.length >= 30) return;"
            "const cls = ((node.getAttribute && node.getAttribute('class')) || '').toLowerCase();"
            "if (cls.indexOf('participant') < 0 && cls.indexOf('msg-conversation') < 0 && cls.indexOf('conversation-card') < 0) return;"
            "const text = String(node.innerText || '').trim();"
            "if (!text || text.length > 500) return;"
            "const lines = text.split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean);"
            "take(lines[0], lines.slice(1).join(' '), cls.indexOf('unread') >= 0);"
            "});"
            "}"
            "return JSON.stringify(rows);"
            "})()"
        )
            print("INBOX_JSON\\t%s" % str(payload or "[]").replace("\\n", " ")[:6000])
            if str(payload or "[]").strip() in ("[]", ""):
                sample = evaluate("(document.body && document.body.innerText || '').slice(0, 700)")
                print("INBOX_SAMPLE\\t%s" % str(sample or "").replace("\\n", " | ")[:700])
        if marker == "nexuses-li-network" and "linkedin.com/notifications" in href:
            accepted = evaluate(
                "(() => {"
                "const names = [];"
                "const seen = {};"
                "Array.from(document.querySelectorAll('article, li, div, a, span')).forEach((node) => {"
                "if (names.length >= 30) return;"
                "const raw = String(node.innerText || '').trim();"
                "if (!raw || raw.length > 220) return;"
                "const text = raw.split(String.fromCharCode(10)).join(' ');"
                "const lower = text.toLowerCase();"
                "const mark = lower.indexOf('accepted your invitation');"
                "if (mark < 1) return;"
                "const name = text.slice(0, mark).trim();"
                "const key = name.toLowerCase();"
                "if (!name || name.length > 80 || seen[key]) return;"
                "seen[key] = 1;"
                "names.push(name);"
                "});"
                "return JSON.stringify(names);"
                "})()"
            )
            print("ACCEPT_JSON\\t%s" % str(accepted or "[]").replace("\\n", " ")[:4000])
        print("TAB_READY\\t%s" % href[:180])
`.trim();

export type LinkedinInboxRow = { name: string; snippet: string; unread: boolean };

export type LinkedinTabFocus = {
  state: "ready" | "login" | "failed";
  inbox: LinkedinInboxRow[];
  inboxRead: boolean;
  accepted: string[];
};

/** Put one campaign, or the inbox, in front. Does not click, type, or send. */
export async function focusLinkedinTab(
  sandboxId: string,
  marker: string,
  url: string,
  expect: string,
  keep: string[] = [],
  quiet = false,
): Promise<LinkedinTabFocus> {
  const command = [
    `TAB_MARKER=${shellQuote(marker)}`,
    `TAB_URL=${shellQuote(url)}`,
    `TAB_EXPECT=${shellQuote(expect)}`,
    `TAB_KEEP=${shellQuote(keep.filter(Boolean).join(","))}`,
    ...(quiet ? ["TAB_QUIET=1"] : []),
    `python3 -c ${shellQuote(LINKEDIN_TAB_PY)}`,
  ].join(" ");
  const result = await runBoatCommand(sandboxId, command, 40).catch((error) => {
    console.error("[linkedin] tab focus failed", error);
    return null;
  });
  const line = result?.stdout.split("\n").find((item) => item.startsWith("TAB_")) || "";
  const inboxLine = result?.stdout.split("\n").find((item) => item.startsWith("INBOX_JSON\t")) || "";
  let inbox: LinkedinInboxRow[] = [];
  let inboxRead = false;
  let accepted: string[] = [];
  if (inboxLine) {
    inboxRead = true;
    try {
      const parsed = JSON.parse(inboxLine.slice("INBOX_JSON\t".length)) as unknown;
      if (Array.isArray(parsed)) {
        inbox = parsed.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as { name?: unknown; snippet?: unknown; unread?: unknown };
          const name = String(row.name || "").trim();
          if (!name) return [];
          return [{ name, snippet: String(row.snippet || "").trim(), unread: row.unread === true }];
        });
      }
    } catch {
      inboxRead = false;
    }
  }
  const acceptLine = result?.stdout.split("\n").find((item) => item.startsWith("ACCEPT_JSON\t")) || "";
  if (acceptLine) {
    try {
      const parsed = JSON.parse(acceptLine.slice("ACCEPT_JSON\t".length)) as unknown;
      if (Array.isArray(parsed)) {
        accepted = parsed.map((item) => String(item || "").trim()).filter(Boolean);
      }
    } catch {
      accepted = [];
    }
  }
  console.info(
    "[linkedin]",
    line.slice(0, 220) || "TAB_FAIL",
    inboxRead ? `inbox=${inbox.length}` : "",
    accepted.length ? `accepted=${accepted.length}` : "",
  );
  const sample = result?.stdout.split("\n").find((item) => item.startsWith("INBOX_SAMPLE\t")) || "";
  if (sample) console.info("[linkedin]", sample.slice(0, 500));
  const state = line.startsWith("TAB_READY") ? "ready" : line.startsWith("TAB_LOGIN") ? "login" : "failed";
  return { state, inbox, inboxRead, accepted };
}

function tokenBudgetError(report: string) {
  return /402|fewer max_tokens|can only afford/i.test(report);
}

/** Keep Claude's output reservation small enough for the desktop key to accept the call. */
async function capClaudeOutput(sandboxId: string) {
  const script = [
    "import json, os",
    'path = os.path.expanduser("~/.claude/settings.json")',
    "os.makedirs(os.path.dirname(path), exist_ok=True)",
    "data = {}",
    "if os.path.exists(path):",
    "    try:",
    "        loaded = json.load(open(path))",
    "        data = loaded if isinstance(loaded, dict) else {}",
    "    except Exception:",
    "        data = {}",
    'env = data.get("env") if isinstance(data.get("env"), dict) else {}',
    'env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] = "8000"',
    'data["env"] = env',
    'json.dump(data, open(path, "w"))',
    'print("capped")',
  ].join("\n");
  await runBoatCommand(sandboxId, `python3 -c ${shellQuote(script)}`, 15).catch(() => null);
  await interruptBoatAgent(sandboxId, null).catch(() => undefined);
}

export async function runLinkedinBoatTask(sandboxId: string, task: string, watchMs: number) {
  await capClaudeOutput(sandboxId);
  const options = { strict: true, interruptOnTimeout: true };
  let result = await runBoatDesktopTask(sandboxId, task, null, watchMs, undefined, options);
  if (!tokenBudgetError(result.report || "")) return result;
  console.info("[linkedin] token budget blocked the agent, retrying with codex");
  try {
    result = await runBoatDesktopTask(sandboxId, task, null, watchMs, undefined, {
      ...options,
      provider: "codex",
    });
  } catch (error) {
    console.error("[linkedin] codex retry failed", error);
  }
  return result;
}

export function linkedinProfileTask(input: {
  campaignName: string;
  personName: string;
  url: string;
  kind: "connect" | "status" | "message" | "like";
  message?: { number: number; text: string };
  like: boolean;
}) {
  const name = input.personName.trim() || "this person";
  let job = `Look at ${name}'s profile and say whether a connection request is pending, you are already connected, Connect is still available, or the request was declined. Do not send a request and do not send a message.`;
  if (input.kind === "connect") {
    job = `Send ${name} one connection request, with no note.
The Connect button is in the profile header, in the same row as Follow, Message, and More. Scroll until that row is on screen.
If Connect is not in the row, open More. Connect is inside that menu. Use it, then send with no note.
If the header already says Pending, or this person is already a 1st-degree connection, do not send another request.
If LinkedIn will not allow another invitation, stop.`;
  } else if (input.kind === "message" && input.message) {
    const text = input.message.text.replace(/```/g, "'''").slice(0, 4000);
    job = `This is message ${input.message.number} for ${name}. Send it only if they have not already replied.
Open Message on this profile, in this same tab, and read the conversation.
If ${name} has sent a message, send nothing.
If they have not replied, send the text between MESSAGE TEXT and END MESSAGE. Send that text only.
MESSAGE TEXT
${text}
END MESSAGE
Stay on this profile when you finish.`;
  } else if (input.kind === "like") {
    job = `Like ${name}'s latest post once. If it is already liked, leave it.`;
  }
  if (input.like && input.kind !== "like") {
    job += `\nAlso like ${name}'s latest post once if it is not already liked.`;
  }
  return `You are guiding the LinkedIn desktop. Look at the screen and decide each click yourself.

Chrome is already open. The front tab belongs only to the campaign "${input.campaignName}".
It is showing one profile: ${name}
${input.url}

Stay in this one tab. Do not open a new tab, a new window, Feed, or Messaging. Do not click anything that would leave this page in a different tab.

${job}

Reply with only these lines:
STATUS: pending
MESSAGE: 0
LIKED: no
SENT_REQUEST: no
DETAIL: one short sentence

STATUS is one of: pending, connected, connect, rejected, login, sent, replied, failed, limited.
pending = a request is waiting. connected = already a 1st-degree connection. connect = Connect is still available and you did not send. rejected = the invite was withdrawn or declined. login = LinkedIn wants a sign-in. sent = you sent the message. replied = they already sent you a message, so you sent nothing. failed = you could not finish. limited = LinkedIn is blocking more invitations.
MESSAGE is the message number you sent, otherwise 0.
LIKED is yes only when their latest post is liked.
SENT_REQUEST is yes only if you sent a new connection request on this visit.`;
}

function linkedinNameList(items: string[]) {
  return items
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 40)
    .join(" | ");
}

export function linkedinRepliesTask(accountName: string, people: string[]) {
  const who = accountName.trim() ? `The logged-in account is ${accountName.trim()}. Do not list that account.` : "";
  const list = linkedinNameList(people);
  return `You are guiding the LinkedIn desktop. Look at the screen and decide what to read.

The front tab is the LinkedIn messaging inbox. This tab is only for replies.
${who}
Stay in this tab. Do not open a new tab or a new window. Do not go to Feed, My Network, or Notifications.

Read the conversation list on the left. A reply means one of these people sent a message:
${list || "none"}

Use the name in the list. Open a conversation only when the name is cut off, and open it in this same tab. Then come back to the inbox list.

Reply with only these lines:
STATUS: ok
REPLIES: Full Name | Full Name

STATUS is ok, login, or failed.
REPLIES is none when none of those people have sent a message. Otherwise their names, separated by |.`;
}

export function linkedinNetworkTask(accountName: string, waiting: string[]) {
  const who = accountName.trim() ? `The logged-in account is ${accountName.trim()}.` : "";
  const list = linkedinNameList(waiting);
  return `You are guiding the LinkedIn desktop. Look at the screen and decide what to read.

The front tab is the LinkedIn notifications page. This tab is only the network watch.
${who}
Stay in this tab. Do not open a profile, a message, or a new tab.

Read who accepted a connection invitation. Only these people are waiting:
${list || "none"}
An accept says they accepted your invitation. Scroll this page once if those names are not on screen yet.

Reply with only these lines:
STATUS: ok
ACCEPTED: Full Name | Full Name

STATUS is ok, login, or failed.
ACCEPTED is none when nobody on that list accepted. Otherwise their names, separated by |.`;
}

const BOAT_STATUSES = new Set([
  "pending",
  "connected",
  "connect",
  "rejected",
  "login",
  "sent",
  "replied",
  "failed",
  "limited",
  "ok",
]);

export type LinkedinBoatReport = {
  status: string;
  message: number;
  liked: boolean;
  sentRequest: boolean;
  replies: string[];
  accepted: string[];
  detail: string;
};

export function parseLinkedinBoatReport(report: string): LinkedinBoatReport {
  const field = (name: string) => {
    const match = report.match(new RegExp("^" + name + ":\\s*(.*)$", "im"));
    return (match?.[1] || "").trim();
  };
  const rawStatus = field("STATUS").toLowerCase();
  const token = rawStatus.split(/\s+/)[0] || "";
  const status = !rawStatus.includes("|") && BOAT_STATUSES.has(token) ? token : "";
  const message = Number(field("MESSAGE"));
  const names = (value: string) =>
    !value || /^none$/i.test(value)
      ? []
      : value
          .split("|")
          .map((item) => item.trim())
          .filter((item) => item && !/^none$/i.test(item) && !/^(you|linkedin member)$/i.test(item));
  return {
    status,
    message: Number.isInteger(message) && message > 0 ? message : 0,
    liked: /^yes\b/i.test(field("LIKED")),
    sentRequest: /^yes\b/i.test(field("SENT_REQUEST")),
    replies: names(field("REPLIES")),
    accepted: names(field("ACCEPTED")),
    detail: field("DETAIL").slice(0, 240),
  };
}

export function sameLinkedinName(left: string, right: string) {
  const a = left.toLowerCase().replace(/\s+/g, " ").trim();
  const b = right.toLowerCase().replace(/\s+/g, " ").trim();
  if (a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  return long.startsWith(`${short} `) || long.startsWith(`${short},`);
}
