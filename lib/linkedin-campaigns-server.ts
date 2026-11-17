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

const PROFILE_READER_PY = `
import json, os, socket, base64, time, urllib.request

people = json.loads(os.environ["PEOPLE"])
campaign_id = "".join(ch for ch in (os.environ.get("CAMPAIGN_ID") or "campaign") if ch.isalnum()) or "campaign"
tab_marker = "nexuses-li-" + campaign_id
EXPR = """(() => {
  const label = (el) => ((el.innerText || "") + " " + (el.getAttribute("aria-label") || "")).replace(/\\\\s+/g, " ").trim();
  const main = document.querySelector("main");
  const h1 = document.querySelector("h1");
  const card = (h1 && h1.closest("section")) || (main && main.querySelector("section")) || main;
  const text = ((card && card.innerText) || "").replace(/\\\\s+/g, " ").slice(0, 500);
  const buttons = [...((card && card.querySelectorAll("button")) || [])].slice(0, 12).map(label).filter(Boolean);
  const joined = buttons.join(" | ");
  const title = document.title || "";
  if (/sign in|s.identifier|join linkedin|authwall/i.test(title) && !/\\\\b1st\\\\b|\\\\b1er\\\\b/i.test(text)) return "login|" + joined;
  const pending = /\\\\bpending\\\\b|en attente/i.test(joined);
  const first = /\\\\b1st\\\\b|\\\\b1er\\\\b/i.test(text);
  const connect = buttons.some((item) => /^(connect|se connecter)\\\\b/i.test(item));
  let state = "unknown";
  if (pending) state = "pending";
  else if (first) state = "connected";
  else if (connect) state = "connect";
  const name = ((h1 && h1.innerText) || "").replace(/\\s+/g, " ").trim();
  return state + "|" + joined + "|" + text.slice(0, 160) + "|" + name.slice(0, 60);
})()"""

CLICK_REPLY = """(() => {
  const label = (el) => ((el.innerText || "") + " " + (el.getAttribute("aria-label") || "")).replace(/\\\\s+/g, " ").trim();
  const button = [...document.querySelectorAll("button, a, [role='button']")].find((el) => /reply to this message|r.pondre . ce message/i.test(label(el)));
  if (!button) return "no-reply";
  button.scrollIntoView({block: "center"});
  button.click();
  const rect = button.getBoundingClientRect();
  return [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)].join(",");
})()"""

CLICK_LIKE = """(() => {
  const label = (el) => ((el.getAttribute("aria-label") || "") + " " + (el.innerText || "")).replace(/\\\\s+/g, " ").trim();
  const buttons = [...document.querySelectorAll("button")];
  const already = buttons.find((el) => {
    const text = label(el);
    if (!/unlike|liked|je n.aime plus/i.test(text)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 8 && rect.top > 60 && rect.top < window.innerHeight - 20;
  });
  if (already) return "already";
  const like = buttons.find((el) => {
    const text = label(el);
    if (!/^(like|j.aime|react like|r.agir)( |$)/i.test(text)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 8 && rect.top > 60 && rect.top < window.innerHeight - 20;
  });
  if (!like) return "no-like";
  like.scrollIntoView({block: "center"});
  const rect = like.getBoundingClientRect();
  return [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)].join(",");
})()"""

CLICK_MESSAGE = """(() => {
  const label = (el) => ((el.innerText || "") + " " + (el.getAttribute("aria-label") || "")).replace(/\\\\s+/g, " ").trim();
  const nodes = [...document.querySelectorAll("main button, main a, main [role='button']")];
  const info = nodes.filter((el) => /message|envoyer/i.test(label(el))).slice(0, 6).map((el) => {
    const rect = el.getBoundingClientRect();
    return label(el).slice(0, 24) + "@" + Math.round(rect.top);
  });
  const button = nodes.find((el) => {
    const rect = el.getBoundingClientRect();
    const text = label(el);
    return /^message\\\\b|^envoyer\\\\b/i.test(text) && !/^messaging\\\\b/i.test(text) && rect.top > 100 && rect.top < 900 && rect.width > 20 && rect.height > 10;
  });
  if (!button) return "no-visible-message " + info.join(";");
  button.scrollIntoView({block: "center"});
  button.click();
  const rect = button.getBoundingClientRect();
  const href = button.href || button.getAttribute("href") || "";
  return [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2), Math.round(rect.width), Math.round(rect.height)].join(",") + "|" + button.tagName + "|" + String(href).slice(0, 180);
})()"""

CLICK_CONNECT = """(() => {
  const label = (el) => ((el.innerText || "") + " " + (el.getAttribute("aria-label") || "")).replace(/\\\\s+/g, " ").trim();
  const h1 = document.querySelector("h1");
  const card = (h1 && h1.closest("section")) || document.querySelector("main") || document;
  const menu = document.querySelector("[role='menu']");
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 20 && rect.height > 10 && rect.top > 40 && rect.top < 900;
  };
  const connect = [...(menu || card).querySelectorAll("button, [role='menuitem']")].find((el) => visible(el) && /^(connect|se connecter)\\\\b/i.test(label(el)));
  if (connect) { connect.click(); return "clicked"; }
  const more = [...card.querySelectorAll("button")].find((el) => visible(el) && /^(more|plus)$/i.test(label(el)));
  if (more) { more.click(); return "more"; }
  return "no-connect";
})()"""

CLICK_INVITE = """(() => {
  const label = (el) => ((el.innerText || "") + " " + (el.getAttribute("aria-label") || "")).replace(/\\\\s+/g, " ").trim();
  const dialog = document.querySelector("[role='dialog']");
  if (!dialog) return "no-dialog";
  const buttons = [...dialog.querySelectorAll("button")];
  const send = buttons.find((el) => /send without a note|envoyer sans note|send now/i.test(label(el)))
    || buttons.find((el) => /^(send|envoyer)$/i.test(label(el)) && !el.disabled);
  if (send) { send.click(); return "sent"; }
  const other = buttons.find((el) => /^(other|autre)$/i.test(label(el)));
  if (other) { other.click(); return "other"; }
  return "no-invite " + buttons.map(label).filter(Boolean).slice(0, 6).join(";");
})()"""

FOCUS_BOX = """(() => {
  const box = document.querySelector(".msg-form__contenteditable") || document.querySelector("[contenteditable='true'][role='textbox']") || document.querySelector("[contenteditable='true']");
  if (!box) {
    const fields = [...document.querySelectorAll("[contenteditable], [role='textbox'], textarea")].slice(0, 4).map((el) => el.tagName + ":" + (el.getAttribute("aria-label") || el.getAttribute("role") || "").slice(0, 30));
    return "no-composer " + fields.join(",");
  }
  box.focus();
  document.execCommand("selectAll", false, null);
  return "focused";
})()"""

CLICK_SEND = """(() => {
  const label = (el) => ((el.innerText || "") + " " + (el.getAttribute("aria-label") || "")).replace(/\\\\s+/g, " ").trim();
  const buttons = [...document.querySelectorAll("button")];
  const button = buttons.find((el) => el.className && String(el.className).indexOf("msg-form__send-button") >= 0 && !el.disabled) || buttons.find((el) => /^(send|envoyer)\\\\b/i.test(label(el)) && !el.disabled);
  if (!button) return "no-send";
  button.click();
  return "clicked";
})()"""

BOX_TEXT = """(() => {
  const box = document.querySelector(".msg-form__contenteditable") || document.querySelector("[contenteditable='true'][role='textbox']");
  return ((box && box.innerText) || "").trim().slice(0, 80);
})()"""

REPLY_EXPR = """(() => {
  const own = __OWN__;
  const who = __WHO__;
  const norm = (value) => (value || "").replace(/\\\\s+/g, " ").trim().toLowerCase();
  const ownNorm = own.map(norm).filter(Boolean);
  const blob = norm(document.body ? document.body.innerText : "").slice(0, 2500);
  if (who && blob.indexOf(who) < 0) return "unknown";
  const events = [...document.querySelectorAll(".msg-s-message-list__event, .msg-s-message-group")];
  if (!events.length) return "empty";
  let reply = false;
  let sawOwn = false;
  for (const el of events) {
    const cls = String(el.className || "");
    if (/time-heading|system|date-heading/.test(cls)) continue;
    const self = cls.indexOf("self") >= 0 || !!el.querySelector("[class*='--self']");
    const body = el.querySelector(".msg-s-event-listitem__body, .msg-s-event__content");
    const text = norm(body ? body.innerText : "");
    if (!text || text.length < 2) continue;
    if (/is now a connection|you are now connected|linkedin member|seen by|write a message|suggested recipients|sent the following|view .+ profile|inmail|sponsored/.test(text)) continue;
    const ours = ownNorm.some((item) => text === item || (item.length > 20 && (text.indexOf(item.slice(0, 40)) === 0 || item.indexOf(text.slice(0, 40)) === 0)));
    if (self || ours) {
      sawOwn = true;
      continue;
    }
    reply = true;
  }
  if (reply) return "yes";
  if (sawOwn) return "no";
  return "unknown";
})()"""

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

done = []
try:
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
    page = next((item for item in pages if window_name(item) == tab_marker), None)
    if page is None:
        browser = browser_socket()
        created = call(browser, 1, "Target.createTarget", {"url": "about:blank"})
        target_id = (created.get("result") or {}).get("targetId")
        for _wait in range(10):
            time.sleep(0.3)
            pages = page_targets()
            page = next((item for item in pages if item.get("id") == target_id), None)
            if page:
                break
        if page is None:
            raise RuntimeError("no-tab")
        sock = ws_connect(page["webSocketDebuggerUrl"])
        call(sock, 2, "Runtime.evaluate", {"expression": "window.name = %s" % json.dumps(tab_marker), "returnByValue": True})
    else:
        sock = ws_connect(page["webSocketDebuggerUrl"])
    try:
        browser = browser_socket()
        call(browser, 3, "Target.activateTarget", {"targetId": page.get("id")})
    except Exception:
        pass
    call(sock, 4, "Page.bringToFront", {})
    call(sock, 1, "Page.enable", {})
    print("TAB\\t%s" % tab_marker, flush=True)
    seq = [10]
    def evaluate(expression):
        seq[0] += 1
        result = call(sock, seq[0], "Runtime.evaluate", {"expression": expression, "returnByValue": True})
        return (((result.get("result") or {}).get("result") or {}).get("value"))
    def like_recent(person):
        activity = person["url"].split("?")[0].rstrip("/") + "/recent-activity/all/"
        seq[0] += 1
        call(sock, seq[0], "Page.bringToFront", {})
        seq[0] += 1
        call(sock, seq[0], "Page.navigate", {"url": activity})
        opened = False
        for _wait in range(8):
            time.sleep(1)
            href = str(evaluate("location.href") or "")
            if "recent-activity" in href:
                opened = True
                break
        if not opened:
            print("LIKE_FAIL\\t%s\\tno-activity" % person["id"], flush=True)
            return
        time.sleep(1)
        evaluate("window.scrollTo(0, 280)")
        time.sleep(1)
        point = str(evaluate(CLICK_LIKE) or "")
        if point == "already":
            print("LIKED\\t%s" % person["id"], flush=True)
            return
        xy = point.split(",")
        if len(xy) < 2 or not xy[0].lstrip("-").isdigit():
            print("LIKE_FAIL\\t%s\\t%s" % (person["id"], point[:80].replace("\\t", " ")), flush=True)
            return
        x, y = int(xy[0]), int(xy[1])
        seq[0] += 1
        call(sock, seq[0], "Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
        seq[0] += 1
        call(sock, seq[0], "Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})
        time.sleep(1)
        print("LIKED\\t%s" % person["id"], flush=True)
    for person in people:
        seq[0] += 1
        call(sock, seq[0], "Page.bringToFront", {})
        for key_type in ("keyDown", "keyUp"):
            seq[0] += 1
            call(sock, seq[0], "Input.dispatchKeyEvent", {"type": key_type, "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27})
        evaluate("""(() => {
          const label = (el) => ((el.getAttribute("aria-label") || "") + " " + (el.innerText || "")).replace(/\\s+/g, " ").trim();
          const close = [...document.querySelectorAll("button")].find((el) => /close your conversation|close conversation|dismiss/i.test(label(el)));
          if (close) close.click();
          return "closed";
        })()""")
        seq[0] += 1
        call(sock, seq[0], "Page.navigate", {"url": person["url"]})
        slug = person["url"].rstrip("/").split("/")[-1].split("?")[0]
        first = (person.get("name") or "").split(" ")[0].lower()
        landed = False
        for _wait in range(12):
            time.sleep(1)
            href = str(evaluate("location.href") or "")
            body = str(evaluate("(document.body && document.body.innerText || '').slice(0, 600).toLowerCase()") or "")
            if slug and slug in href and (not first or first in body):
                landed = True
                break
        if not landed:
            done.append(person["id"])
            print("RESULT\\t%s\\tunknown" % person["id"], flush=True)
            if person.get("checkReply"):
                print("REPLY\\t%s\\tunknown" % person["id"], flush=True)
            continue
        time.sleep(1)
        evaluate("window.scrollTo(0,0)")
        time.sleep(1)
        for _see in range(3):
            seen = str(evaluate("(() => { const h1 = document.querySelector('h1'); if (!h1) return 'no'; h1.scrollIntoView({block:'center'}); const box = h1.getBoundingClientRect(); return box.width > 20 && box.height > 10 ? 'yes' : 'no'; })()") or "")
            if seen == "yes":
                break
            time.sleep(1)
        found = "unknown"
        detail = ""
        allowed = ("pending", "connected", "connect", "rejected", "login")
        for _attempt in (1, 2):
            value = str(evaluate(EXPR) or "unknown")
            found, _, detail = value.partition("|")
            if found not in allowed:
                found = "unknown"
            if found != "unknown":
                break
            time.sleep(3)
        done.append(person["id"])
        print("DETAIL\\t%s\\t%s\\t%s" % (person["id"], found, detail.replace("\\t", " ")[:180]), flush=True)
        print("RESULT\\t%s\\t%s" % (person["id"], found), flush=True)
        if person.get("sendConnect") and found == "connect":
            action = str(evaluate(CLICK_CONNECT) or "")
            if action == "more":
                time.sleep(0.8)
                action = str(evaluate(CLICK_CONNECT) or "")
            if action == "clicked":
                time.sleep(1.2)
                invite = str(evaluate(CLICK_INVITE) or "")
                if invite in ("other", "email"):
                    time.sleep(0.6)
                    invite = str(evaluate(CLICK_INVITE) or "")
                time.sleep(1.2)
                value = str(evaluate(EXPR) or "unknown")
                found, _, detail = value.partition("|")
                if found not in allowed:
                    found = "unknown"
                print("DETAIL\\t%s\\t%s\\t%s" % (person["id"], found, detail.replace("\\t", " ")[:180]), flush=True)
                print("RESULT\\t%s\\t%s" % (person["id"], found), flush=True)
                if found in ("pending", "connected"):
                    print("REQUESTED\\t%s" % person["id"], flush=True)
                else:
                    print("CONNECT_FAIL\\t%s\\t%s" % (person["id"], str(invite)[:80].replace("\\t", " ")), flush=True)
                    page = str(evaluate("(document.body && document.body.innerText || '').slice(0, 800).toLowerCase()") or "")
                    if "invitation limit" in page or "weekly limit" in page or "limit reached" in page:
                        print("LIMITED", flush=True)
                        for later in people:
                            later["sendConnect"] = False
            else:
                print("CONNECT_FAIL\\t%s\\t%s" % (person["id"], action[:80].replace("\\t", " ")), flush=True)
        if person.get("checkReply"):
            opened = ""
            point = []
            for _try in range(6):
                opened = str(evaluate(CLICK_MESSAGE) or "")
                point = opened.split(",")
                if len(point) >= 2 and point[0].lstrip("-").isdigit():
                    break
                time.sleep(1)
            if len(point) < 2 or not point[0].lstrip("-").isdigit():
                opened = str(evaluate(CLICK_REPLY) or "") + " | " + opened[:80]
                point = opened.split(",")
            if len(point) >= 2 and point[0].lstrip("-").isdigit():
                coords, _, extra = opened.partition("|")
                xy = coords.split(",")
                x, y = int(xy[0]), int(xy[1])
                seq[0] += 1
                call(sock, seq[0], "Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
                seq[0] += 1
                call(sock, seq[0], "Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})
                href = extra.split("|", 1)[-1] if extra else ""
                if href.startswith("http") and "/messaging/thread/" in href:
                    seq[0] += 1
                    call(sock, seq[0], "Page.navigate", {"url": href})
                time.sleep(2)
                verdict = "unknown"
                expression = REPLY_EXPR.replace("__OWN__", json.dumps(person.get("ownMessages") or []), 1).replace("__WHO__", json.dumps(first), 1)
                for _look in (1, 2, 3, 4):
                    verdict = str(evaluate(expression) or "unknown")
                    if verdict in ("yes", "no"):
                        break
                    time.sleep(1)
                if verdict not in ("yes", "no"):
                    reply_click = str(evaluate(CLICK_REPLY) or "")
                    reply_point = reply_click.split(",")
                    if len(reply_point) >= 2 and reply_point[0].lstrip("-").isdigit():
                        rx, ry = int(reply_point[0]), int(reply_point[1])
                        seq[0] += 1
                        call(sock, seq[0], "Input.dispatchMouseEvent", {"type": "mousePressed", "x": rx, "y": ry, "button": "left", "clickCount": 1})
                        seq[0] += 1
                        call(sock, seq[0], "Input.dispatchMouseEvent", {"type": "mouseReleased", "x": rx, "y": ry, "button": "left", "clickCount": 1})
                        time.sleep(2)
                        for _look in (1, 2, 3, 4):
                            verdict = str(evaluate(expression) or "unknown")
                            if verdict in ("yes", "no"):
                                break
                            time.sleep(1)
                if verdict not in ("yes", "no") and "linkedin.com/messaging" in href:
                    seq[0] += 1
                    call(sock, seq[0], "Page.navigate", {"url": href})
                    time.sleep(3)
                    for _look in (1, 2, 3, 4, 5):
                        verdict = str(evaluate(expression) or "unknown")
                        if verdict in ("yes", "no"):
                            break
                        time.sleep(1)
                if verdict not in ("yes", "no"):
                    verdict = "unknown"
            else:
                verdict = "unknown"
            print("REPLY\\t%s\\t%s" % (person["id"], verdict), flush=True)
            if verdict == "yes":
                if person.get("likeRecent") and found == "connected":
                    like_recent(person)
                continue
        messages = person.get("messages") or []
        if found != "connected":
            messages = []
        for message in messages:
            number = int(message.get("number") or 0)
            text = message.get("text") or ""
            if not text:
                continue
            focused = str(evaluate(FOCUS_BOX) or "")
            opened = ""
            if not focused.startswith("focused"):
                opened = str(evaluate(CLICK_MESSAGE) or "")
                point = opened.split(",")
                if len(point) < 2 or not point[0].lstrip("-").isdigit():
                    opened = str(evaluate(CLICK_REPLY) or "")
                    point = opened.split(",")
                    if len(point) < 2 or not point[0].lstrip("-").isdigit():
                        print("SEND_FAIL\\t%s\\t%s\\t%s" % (person["id"], number, opened[:120]), flush=True)
                        break
                coords, _, extra = opened.partition("|")
                point = coords.split(",")
                x, y = int(point[0]), int(point[1])
                seq[0] += 1
                call(sock, seq[0], "Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
                seq[0] += 1
                call(sock, seq[0], "Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})
                href = extra.split("|", 1)[-1] if extra else ""
                if href.startswith("http") and "messaging" in href:
                    seq[0] += 1
                    call(sock, seq[0], "Page.navigate", {"url": href})
                    time.sleep(3)
                focused = ""
                for _wait in (1, 2, 3):
                    time.sleep(1.5)
                    focused = str(evaluate(FOCUS_BOX) or "")
                    if focused.startswith("focused"):
                        break
                if not focused.startswith("focused"):
                    print("SEND_FAIL\\t%s\\t%s\\t%s | %s" % (person["id"], number, opened[:160], focused[:120]), flush=True)
                    break
            seq[0] += 1
            call(sock, seq[0], "Input.insertText", {"text": text})
            time.sleep(0.4)
            evaluate("""(() => { const box = document.querySelector(".msg-form__contenteditable") || document.querySelector("[contenteditable='true'][role='textbox']"); if (box) box.dispatchEvent(new InputEvent("input", {bubbles: true})); return "ok"; })()""")
            time.sleep(0.4)
            if evaluate(CLICK_SEND) != "clicked":
                print("SEND_FAIL\\t%s\\t%s\\tno-send" % (person["id"], number), flush=True)
                break
            time.sleep(1.5)
            left = str(evaluate(BOX_TEXT) or "")
            if left and text.strip()[:40] == left[:40]:
                print("SEND_FAIL\\t%s\\t%s\\tstill-in-box" % (person["id"], number), flush=True)
                break
            print("SENT\\t%s\\t%s" % (person["id"], number), flush=True)
            time.sleep(1)
        if person.get("likeRecent") and found == "connected":
            like_recent(person)
except Exception as error:
    print("READ_ERROR", type(error).__name__, flush=True)
    for person in people:
        if person["id"] in done:
            continue
        print("RESULT\\t%s\\tunknown" % person["id"], flush=True)
`.trim();

async function chromeDebugOpen(sandboxId: string) {
  const result = await runBoatCommand(
    sandboxId,
    "python3 -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:9222/json/version', timeout=2).read(); print('open')\"",
    10,
  ).catch(() => null);
  return Boolean(result?.stdout.includes("open"));
}

/** Read the profile header, and send any messages included for someone who is already 1st. */
export async function readLinkedinProfileStates(
  sandboxId: string,
  campaignId: string,
  people: {
    id: string;
    url: string;
    messages?: { number: number; text: string }[];
    checkReply?: boolean;
    ownMessages?: string[];
    name?: string;
    sendConnect?: boolean;
    likeRecent?: boolean;
  }[],
) {
  const states = new Map<string, ProfileVisit>();
  if (!people.length) return { states, limited: false };
  if (!(await chromeDebugOpen(sandboxId))) {
    await openLinkedinChrome(sandboxId, "https://www.linkedin.com/feed/", true);
    for (let attempt = 0; attempt < 10 && !(await chromeDebugOpen(sandboxId)); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!(await chromeDebugOpen(sandboxId))) return { states, limited: false };
  await fillLinkedinChrome(sandboxId);
  const result = await runBoatCommand(
    sandboxId,
    `CAMPAIGN_ID=${shellQuote(campaignId)} PEOPLE=${shellQuote(JSON.stringify(people))} python3 -c ${shellQuote(PROFILE_READER_PY)}`,
    90,
  );
  for (const line of result.stdout.split("\n")) {
    if (
      line.startsWith("DETAIL\t") ||
      line.startsWith("SENT\t") ||
      line.startsWith("SEND_FAIL\t") ||
      line.startsWith("REPLY\t") ||
      line.startsWith("REQUESTED\t") ||
      line.startsWith("CONNECT_FAIL\t") ||
      line.startsWith("LIKED\t") ||
      line.startsWith("LIKE_FAIL\t") ||
      line.startsWith("TAB\t") ||
      line.startsWith("LIMITED")
    ) {
      console.info("[linkedin]", line.slice(0, 500));
    }
    const match = line.match(/^RESULT\t(\S+)\t(pending|connected|connect|rejected|login|unknown)$/);
    if (match) {
      const visit = states.get(match[1]) || {
        state: match[2] as ProfileRead,
        sent: [],
        replied: null,
        requested: false,
      };
      visit.state = match[2] as ProfileRead;
      states.set(match[1], visit);
    }
    const sent = line.match(/^SENT\t(\S+)\t(\d+)$/);
    if (sent) {
      const visit = states.get(sent[1]) || {
        state: "connected" as ProfileRead,
        sent: [],
        replied: null,
        requested: false,
      };
      visit.sent.push(Number(sent[2]));
      states.set(sent[1], visit);
    }
    const requested = line.match(/^REQUESTED\t(\S+)$/);
    if (requested) {
      const visit = states.get(requested[1]) || {
        state: "pending" as ProfileRead,
        sent: [],
        replied: null,
        requested: false,
      };
      visit.requested = true;
      if (visit.state === "connect" || visit.state === "unknown") visit.state = "pending";
      states.set(requested[1], visit);
    }
    const liked = line.match(/^LIKED\t(\S+)$/);
    if (liked) {
      const visit = states.get(liked[1]) || {
        state: "connected" as ProfileRead,
        sent: [],
        replied: null,
        requested: false,
      };
      visit.liked = true;
      states.set(liked[1], visit);
    }
    const reply = line.match(/^REPLY\t(\S+)\t(yes|no|unknown)$/);
    if (reply) {
      const visit = states.get(reply[1]) || {
        state: "connected" as ProfileRead,
        sent: [],
        replied: null,
        requested: false,
      };
      visit.replied = reply[2] === "yes" ? true : reply[2] === "no" ? false : null;
      states.set(reply[1], visit);
    }
  }
  if (result.stdout.includes("READ_ERROR") || !result.stdout.includes("RESULT")) {
    console.error("[linkedin] profile read failed", result.stdout.slice(0, 500), result.stderr.slice(0, 300));
  }
  return { states, limited: /(^|\n)LIMITED(\n|$)/.test(result.stdout) };
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
    note: person.statusNote || "",
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
  if (stage === "reply" || stage.startsWith("custom_")) return false;
  if (stage !== "connected" && !stage.startsWith("message_")) return false;
  if (!person.nextActionAt || person.nextActionAt.getTime() > now.getTime()) return false;
  const sent = person.messagesSent || 0;
  return Boolean(person.messages[sent]?.trim());
}

const PROFILE_READ_WAIT_MS = 60 * 1000;
const COMPLETE_REPLY_WAIT_MS = 15 * 60 * 1000;
const VISIT_BATCH = 2;
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

/** Check accepts and replies, and send every message whose wait is already over. */
export function processDueLinkedinMessages(now = new Date()) {
  if (followUpRun) return followUpRun;
  followUpRun = runLinkedinFollowUps(now).finally(() => {
    followUpRun = null;
  });
  return followUpRun;
}

(globalThis as typeof globalThis & { __nexusesLinkedinFollowUp?: typeof processDueLinkedinMessages }).__nexusesLinkedinFollowUp =
  processDueLinkedinMessages;

async function runLinkedinFollowUps(now = new Date()) {
  await sessions();
  const db = await getDb();
  const docs = await db
    .collection<CampaignDoc>("linkedin_campaigns")
    .find({ status: { $in: ["running", "complete"] } })
    .toArray();
  docs.sort((a, b) => Number(a.status !== "running") - Number(b.status !== "running"));
  let sent = 0;
  const busyProjects = new Set<string>();
  if (!boatConfigured()) return { sent };
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
        await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
          { _id: doc._id },
          { $unset: { activePromptId: "", activePromptAt: "", activeTargets: "" }, $set: { updatedAt: now } },
        );
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
    if (doc.status === "complete" && busyProjects.has(String(doc.projectId))) continue;

    if (doc.activePromptId === "desktop-send") {
      const age = now.getTime() - (doc.activePromptAt?.getTime() || 0);
      if (age < 3 * 60 * 1000) continue;
      doc.activePromptId = undefined;
    }

    if (doc.activePromptId) {
      await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
        { _id: doc._id },
        { $unset: { activePromptId: "", activePromptAt: "", activeTargets: "" }, $set: { updatedAt: now } },
      );
      doc.activePromptId = undefined;
    }

    const headerWaitOver =
      !doc.connectionCheckAt || now.getTime() - doc.connectionCheckAt.getTime() >= PROFILE_READ_WAIT_MS;
    const replyWaitMs = doc.status === "complete" ? COMPLETE_REPLY_WAIT_MS : PROFILE_READ_WAIT_MS;
    const targets = doc.people
      .flatMap((person, index) => {
        if (!person.linkedinUrl) return [];
        const id = person.id || `p${index + 1}`;
        const stage = personStage(person);
        const needsRequest =
          stage === "request_sent" &&
          !person.connectionRequested &&
          (person.messagesSent || 0) === 0 &&
          headerWaitOver;
        const waiting = stage === "request_sent" && Boolean(person.connectionRequested) && headerWaitOver;
        const recheck =
          stage === "connection_rejected" &&
          (person.messagesSent || 0) === 0 &&
          person.statusNote === "They rejected the connection request." &&
          headerWaitOver;
        const due = messageDue(person, now);
        const replyDue =
          stage.startsWith("message_") &&
          (person.messagesSent || 0) > 0 &&
          (!person.replyCheckedAt || now.getTime() - person.replyCheckedAt.getTime() >= replyWaitMs);
        const likeDue =
          person.likeRecentPost === true &&
          person.likedRecentPost !== true &&
          (stage === "connected" || stage.startsWith("message_") || stage === "reply");
        if (!needsRequest && !waiting && !recheck && !due && !replyDue && !likeDue) return [];
        const messages =
          due || ((needsRequest || waiting || recheck) && doc.delayAfterAcceptDays === 0)
            ? messagesToSend(person, doc.delayAfterMessageDays)
            : [];
        const priority = needsRequest || due ? 0 : waiting || recheck || likeDue ? 1 : 2;
        return [
          {
            priority,
            id,
            url: person.linkedinUrl,
            name: person.name,
            messages,
            ...(needsRequest ? { sendConnect: true } : {}),
            ...(person.likeRecentPost && !person.likedRecentPost ? { likeRecent: true } : {}),
            ...(replyDue
              ? {
                  checkReply: true,
                  ownMessages: person.messages
                    .slice(0, person.messagesSent || 0)
                    .map((text) => text.trim())
                    .filter(Boolean),
                }
              : {}),
          },
        ];
      })
      .sort((a, b) => a.priority - b.priority)
      .slice(0, VISIT_BATCH)
      .map(({ priority: _priority, ...target }) => target);
    if (!targets.length) continue;
    if (doc.status === "running") busyProjects.add(String(doc.projectId));
    await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
      { _id: doc._id },
      { $set: { activePromptId: "desktop-send", activePromptAt: now, updatedAt: now } },
    );
    const read = await readLinkedinProfileStates(sandbox.id, doc._id.toString(), targets).catch((error) => {
      console.error("[linkedin] profile read failed:", error);
      return { states: new Map<string, ProfileVisit>(), limited: false };
    });
    const states = read.states;
    const people = doc.people.map((person, index) => {
      const id = person.id || `p${index + 1}`;
      const visit = states.get(id);
      if (!visit) return person;
      console.info(
        `[linkedin] ${person.name}: ${visit.state} sent=${visit.sent.join(",") || "none"} replied=${visit.replied === true ? "yes" : visit.replied === false ? "no" : "unknown"}`,
      );
      const stage = personStage(person);
      if (visit.replied === true && stage.startsWith("message_")) {
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
      if ((visit.state === "unknown" || visit.state === "login") && stage.startsWith("message_") && !visit.sent.length) {
        return { ...person, replyCheckedAt: now };
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
          statusNote: "Connection request sent. Waiting for them to accept.",
        });
      }
      if (state === "connect" || state === "rejected") {
        if (person.connectionRequested) {
          return withoutNextAction(person, {
            stage: "connection_rejected",
            replyCheckedAt: now,
            statusNote: "Opened the profile header. Connect is showing, so the request was not accepted.",
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
        const triedToSend = targets.some((target) => target.id === id && target.messages.length > 0);
        if (unsent.length && triedToSend) {
          return {
            ...marked,
            connectionRequested: true,
            replyCheckedAt: now,
            statusNote: "They accepted. The message could not be sent. It will try again.",
            nextActionAt: new Date(now.getTime() + PROFILE_READ_WAIT_MS),
          };
        }
        if (stage.startsWith("message_")) {
          if (unsent.length) return { ...person, connectionRequested: true, replyCheckedAt: now };
          const note =
            !person.statusNote || STALE_MESSAGE_NOTES.has(person.statusNote)
              ? "All messages were sent."
              : person.statusNote;
          return { ...person, connectionRequested: true, replyCheckedAt: now, statusNote: note };
        }
        return withoutNextAction(marked, {
          connectionRequested: true,
          replyCheckedAt: now,
          statusNote: "They accepted the connection request.",
        });
      }
      if (stage !== "request_sent") return person;
      return {
        ...person,
        replyCheckedAt: now,
        statusNote:
          state === "login"
            ? "LinkedIn needs a sign-in before this profile can be checked."
            : "Opened the profile, but the buttons were not visible yet. It will try again.",
      };
    });
    people.forEach((person, index) => {
      const id = person.id || `p${index + 1}`;
      if (!states.get(id)?.liked) return;
      person.likedRecentPost = true;
    });
    const previous = doc.people;
    sent += people.filter((person, index) => (person.messagesSent || 0) > (previous[index]?.messagesSent || 0)).length;
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
    await db.collection<CampaignDoc>("linkedin_campaigns").updateOne(
      { _id: doc._id },
      {
        $set: {
          people: merged,
          status: campaignStatus(merged),
          connectionCheckAt: read.limited ? new Date(now.getTime() + 30 * 60 * 1000) : now,
          updatedAt: now,
        },
        $unset: { activePromptId: "", activePromptAt: "", activeTargets: "" },
      },
    );
  }
  return { sent };
}
