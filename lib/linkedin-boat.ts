import { interruptBoatAgent, runBoatCommand, runBoatDesktopTask, shellQuote } from "@/lib/boat";

/** Messaging inbox tab — replies only. */
export const LINKEDIN_MESSAGING_URL = "https://www.linkedin.com/messaging/";
/** Notifications tab — connection accepts / network watch. */
export const LINKEDIN_NETWORK_URL = "https://www.linkedin.com/notifications/";
/** window.name marker for the replies tab. */
export const LINKEDIN_REPLIES_TAB = "nexuses-li-replies";
/** window.name marker for the network/accepts tab. */
export const LINKEDIN_NETWORK_TAB = "nexuses-li-network";
/** Campaign profile tabs use campaignTabMarker(id) for connection requests and messages. */

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
call(sock, 2, "Page.enable", {})
# LinkedIn navigations can wipe window.name — stamp it on every new document too.
call(sock, 3, "Page.addScriptToEvaluateOnNewDocument", {"source": "window.name = %s;" % json.dumps(marker)})
call(sock, 4, "Runtime.evaluate", {"expression": "window.name = %s" % json.dumps(marker), "returnByValue": True})
if not quiet:
    try:
        browser = browser_socket()
        call(browser, 5, "Target.activateTarget", {"targetId": page.get("id")})
    except Exception:
        pass
    call(sock, 6, "Page.bringToFront", {})
seq = [10]
def evaluate(expression):
    seq[0] += 1
    result = call(sock, seq[0], "Runtime.evaluate", {"expression": expression, "returnByValue": True})
    return (((result.get("result") or {}).get("result") or {}).get("value"))
def stamp_name():
    try:
        evaluate("window.name = %s" % json.dumps(marker))
    except Exception:
        pass
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
        href = item.get("url") or ""
        # Never kill workspace tabs — LinkedIn often clears window.name on navigate.
        if name in keep or name.startswith("nexuses-li-"):
            continue
        if "linkedin.com/messaging" in href or "linkedin.com/notifications" in href:
            continue
        if "/in/" in href:
            continue
        junk = (
            href.startswith("about:")
            or href.startswith("chrome:")
            or href.startswith("chrome-error:")
            or "linkedin.com/feed" in href
            or not href
        )
        if not junk and "linkedin.com" in href:
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
    nav_tries = 20 if "/in/" in (url or "") else 12
    for _wait in range(nav_tries):
        time.sleep(1)
        href = str(evaluate("location.href") or "")
        if "linkedin.com/messaging" in url:
            if on_inbox(href):
                break
        elif (expect and expect in href) or (not expect and url.split("?")[0] in href):
            break
    stamp_name()
else:
    stamp_name()
if not quiet:
    close_extras()
title = str(evaluate("document.title || ''") or "")
href = str(evaluate("location.href") or "")
profile_actions = []
def read_profile_actions():
    raw = evaluate(
        "(() => {"
        "const labels = [];"
        "const seen = {};"
        "const push = (value) => {"
        "let text = '';"
        "let gap = false;"
        "const rawText = String(value || '');"
        "for (let i = 0; i < rawText.length; i += 1) {"
        "const code = rawText.charCodeAt(i);"
        "const space = code === 9 || code === 10 || code === 13 || code === 32 || code === 160;"
        "if (space) { gap = text.length > 0; continue; }"
        "if (gap) text += ' ';"
        "gap = false;"
        "text += rawText.charAt(i);"
        "}"
        "text = text.trim();"
        "if (!text || text.length > 64) return;"
        "const key = text.toLowerCase();"
        "if (seen[key]) return;"
        "const hit = key === 'connect' || key.indexOf('to connect') >= 0 || key.indexOf('connect') === 0"
        " || key === 'pending' || key.indexOf('pending') === 0 || key.indexOf('withdraw') >= 0"
        " || key === 'message' || key.indexOf('message') === 0 || key === 'follow' || key.indexOf('follow') === 0"
        " || key === 'more' || key.indexOf('more') === 0 || key.indexOf('remove connection') >= 0"
        " || key.indexOf('personalize') >= 0 || key.indexOf('send profile') >= 0;"
        "if (!hit) return;"
        "seen[key] = 1;"
        "labels.push(text);"
        "};"
        "Array.from(document.querySelectorAll('button, a, [role=\"button\"]')).forEach((node) => {"
        "push(node.innerText || '');"
        "push(node.getAttribute('aria-label') || '');"
        "});"
        "return labels.slice(0, 12).join('|');"
        "})()"
    )
    text = str(raw or "").strip()
    if not text:
        return []
    return [part for part in text.split("|") if part]
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
            for _wait in range(30):
                profile_actions = read_profile_actions()
                if profile_actions:
                    break
                time.sleep(0.5)
            print("PROFILE_ACTIONS\\t%s" % ("|".join(profile_actions) if profile_actions else "none"))
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
  profileActions: string[];
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
  const result = await runBoatCommand(sandboxId, command, 55).catch((error) => {
    console.error("[linkedin] tab focus failed", error);
    return null;
  });
  const line = result?.stdout.split("\n").find((item) => item.startsWith("TAB_")) || "";
  const inboxLine = result?.stdout.split("\n").find((item) => item.startsWith("INBOX_JSON\t")) || "";
  let inbox: LinkedinInboxRow[] = [];
  let inboxRead = false;
  let accepted: string[] = [];
  let profileActions: string[] = [];
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
  const actionsLine = result?.stdout.split("\n").find((item) => item.startsWith("PROFILE_ACTIONS\t")) || "";
  if (actionsLine) {
    const raw = actionsLine.slice("PROFILE_ACTIONS\t".length).trim();
    if (raw && !/^none$/i.test(raw)) {
      profileActions = raw
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  console.info(
    "[linkedin]",
    line.slice(0, 220) || "TAB_FAIL",
    inboxRead ? `inbox=${inbox.length}` : "",
    accepted.length ? `accepted=${accepted.length}` : "",
    profileActions.length ? `actions=${profileActions.join("|")}` : "",
  );
  const sample = result?.stdout.split("\n").find((item) => item.startsWith("INBOX_SAMPLE\t")) || "";
  if (sample) console.info("[linkedin]", sample.slice(0, 500));
  const state = line.startsWith("TAB_READY") ? "ready" : line.startsWith("TAB_LOGIN") ? "login" : "failed";
  return { state, inbox, inboxRead, accepted, profileActions };
}

const LINKEDIN_WORKSPACE_PY = `
import json, os, socket, base64, time, urllib.request

replies_marker = os.environ.get("TAB_REPLIES") or "nexuses-li-replies"
network_marker = os.environ.get("TAB_NETWORK") or "nexuses-li-network"
campaign_marker = os.environ.get("TAB_CAMPAIGN") or "nexuses-li-campaign"
replies_url = os.environ.get("TAB_REPLIES_URL") or "https://www.linkedin.com/messaging/"
network_url = os.environ.get("TAB_NETWORK_URL") or "https://www.linkedin.com/notifications/"
campaign_url = os.environ.get("TAB_CAMPAIGN_URL") or ""
front = os.environ.get("TAB_FRONT") == "1"
navigate_campaign = os.environ.get("TAB_NAV_CAMPAIGN") != "0"

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

def open_page(item):
    sock = ws_connect(item["webSocketDebuggerUrl"])
    return sock, item

def create_page(url):
    browser = browser_socket()
    created = call(browser, 1, "Target.createTarget", {"url": url or "about:blank"})
    target_id = (created.get("result") or {}).get("targetId")
    for _wait in range(20):
        time.sleep(0.25)
        found = next((item for item in page_targets() if item.get("id") == target_id), None)
        if found:
            return open_page(found)
    raise RuntimeError("no-tab")

def stamp(sock, marker):
    call(sock, 2, "Page.enable", {})
    call(sock, 3, "Page.addScriptToEvaluateOnNewDocument", {"source": "window.name = %s;" % json.dumps(marker)})
    call(sock, 4, "Runtime.evaluate", {"expression": "window.name = %s" % json.dumps(marker), "returnByValue": True})

def evaluate(sock, expression, seq):
    seq[0] += 1
    result = call(sock, seq[0], "Runtime.evaluate", {"expression": expression, "returnByValue": True})
    return (((result.get("result") or {}).get("result") or {}).get("value"))

def navigate(sock, url, expect, seq):
    if not url:
        return str(evaluate(sock, "location.href", seq) or "")
    href = str(evaluate(sock, "location.href", seq) or "")
    need = False
    if "linkedin.com/messaging" in url:
        need = "linkedin.com/messaging" not in href or "/messaging/thread" in href or "/messaging/compose" in href
    elif expect:
        need = expect not in href
    else:
        need = url.split("?")[0] not in href
    if need:
        seq[0] += 1
        call(sock, seq[0], "Page.navigate", {"url": url})
        for _wait in range(18):
            time.sleep(1)
            href = str(evaluate(sock, "location.href", seq) or "")
            if "linkedin.com/messaging" in url:
                if "linkedin.com/messaging" in href and "/messaging/thread" not in href and "/messaging/compose" not in href:
                    break
            elif expect and expect in href:
                break
            elif not expect and url.split("?")[0] in href:
                break
    return href

def find_tab(marker, url_hint):
    pages = page_targets()
    named = []
    for item in pages:
        copied = dict(item)
        copied["_name"] = window_name(item)
        named.append(copied)
    hit = next((item for item in named if item.get("_name") == marker), None)
    if hit:
        return hit
    for item in named:
        name = item.get("_name") or ""
        href = item.get("url") or ""
        if name.startswith("nexuses-li-") and name != marker:
            continue
        if url_hint == "messaging" and "linkedin.com/messaging" in href:
            return item
        if url_hint == "network" and "linkedin.com/notifications" in href:
            return item
        # Campaign tabs are marker-only so we never steal a random /in/ profile tab.
    return None

def ensure(marker, url, expect, url_hint, allow_create_url):
    seq = [20]
    page = find_tab(marker, url_hint)
    if page is None:
        sock, page = create_page(allow_create_url or url or "about:blank")
    else:
        sock, page = open_page(page)
    stamp(sock, marker)
    href = navigate(sock, url, expect, seq)
    stamp(sock, marker)
    return page.get("id"), href, sock, seq

replies_id, replies_href, replies_sock, _ = ensure(
    replies_marker, replies_url, "linkedin.com/messaging", "messaging", replies_url
)
network_id, network_href, network_sock, _ = ensure(
    network_marker, network_url, "linkedin.com/notifications", "network", network_url
)
campaign_target = campaign_url if navigate_campaign and campaign_url else ""
campaign_expect = ""
if campaign_target and "/in/" in campaign_target:
    campaign_expect = campaign_target.rstrip("/").split("/")[-1] or "/in/"
elif campaign_target:
    campaign_expect = "linkedin.com"
campaign_id, campaign_href, campaign_sock, campaign_seq = ensure(
    campaign_marker,
    campaign_target,
    campaign_expect,
    "campaign",
    campaign_target or "https://www.linkedin.com/feed/",
)

keep_ids = {replies_id, network_id, campaign_id}
try:
    browser = browser_socket()
    for item in page_targets():
        if item.get("id") in keep_ids:
            continue
        href = item.get("url") or ""
        name = window_name(item)
        if name.startswith("nexuses-li-"):
            continue
        if "linkedin.com/messaging" in href or "linkedin.com/notifications" in href:
            continue
        junk = (
            href.startswith("about:")
            or href.startswith("chrome:")
            or href.startswith("chrome-error:")
            or "linkedin.com/feed" in href
            or not href
        )
        if junk:
            try:
                call(browser, 90, "Target.closeTarget", {"targetId": item.get("id")})
            except Exception:
                pass
except Exception:
    pass

if front:
    try:
        browser = browser_socket()
        call(browser, 91, "Target.activateTarget", {"targetId": campaign_id})
        call(campaign_sock, campaign_seq[0] + 1, "Page.bringToFront", {})
        stamp(campaign_sock, campaign_marker)
    except Exception:
        pass

print("WORKSPACE\\treplies=%s\\tnetwork=%s\\tcampaign=%s" % (replies_href[:120], network_href[:120], campaign_href[:120]))
print("WORKSPACE_OK\\t3")
`.trim();

/** Open/repair the three LinkedIn workspace tabs in one CDP pass. */
export async function ensureLinkedinWorkspaceTabs(
  sandboxId: string,
  input: {
    campaignMarker: string;
    campaignUrl: string;
    frontCampaign?: boolean;
    navigateCampaign?: boolean;
  },
) {
  const command = [
    `TAB_REPLIES=${shellQuote(LINKEDIN_REPLIES_TAB)}`,
    `TAB_NETWORK=${shellQuote(LINKEDIN_NETWORK_TAB)}`,
    `TAB_CAMPAIGN=${shellQuote(input.campaignMarker)}`,
    `TAB_REPLIES_URL=${shellQuote(LINKEDIN_MESSAGING_URL)}`,
    `TAB_NETWORK_URL=${shellQuote(LINKEDIN_NETWORK_URL)}`,
    `TAB_CAMPAIGN_URL=${shellQuote(input.campaignUrl || "")}`,
    ...(input.frontCampaign ? ["TAB_FRONT=1"] : []),
    ...(input.navigateCampaign === false ? ["TAB_NAV_CAMPAIGN=0"] : []),
    `python3 -c ${shellQuote(LINKEDIN_WORKSPACE_PY)}`,
  ].join(" ");
  const result = await runBoatCommand(sandboxId, command, 90).catch((error) => {
    console.error("[linkedin] workspace tabs failed", error);
    return null;
  });
  const line =
    result?.stdout.split("\n").find((item) => item.startsWith("WORKSPACE\t")) ||
    result?.stdout.split("\n").find((item) => item.startsWith("WORKSPACE_OK")) ||
    "";
  const ok = Boolean(result?.stdout.includes("WORKSPACE_OK"));
  console.info("[linkedin] workspace", line.slice(0, 300) || (ok ? "ok" : "failed"));
  return ok;
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
  headerActions?: string[];
}) {
  const name = input.personName.trim() || "this person";
  const actionsHint = input.headerActions?.length
    ? `The profile header controls already on screen look like: ${input.headerActions.join(", ")}.`
    : "Wait until the profile header shows Connect, Follow, Message, Pending, or More before you click.";
  let job = `Look at ${name}'s profile and say whether a connection request is pending, you are already connected, Connect is still available, or the request was declined. Do not send a request and do not send a message.
${actionsHint}`;
  if (input.kind === "connect") {
    job = `Send ${name} one connection request, with no note.
${actionsHint}
Scroll the top of the profile into view and wait if the header buttons are still loading.
How to send:
1. If Connect is visible in the header, click it, then Send with no note.
2. If Follow or Message is the main button, open More (or …). Connect is usually inside that menu. Click Connect, then Send with no note.
3. If the header already says Pending, or this person is already a 1st-degree connection, do not send another request.
4. If LinkedIn will not allow another invitation, stop and report limited.
Do not report failed until you have waited for the header buttons and opened More when Connect is hidden.`;
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
