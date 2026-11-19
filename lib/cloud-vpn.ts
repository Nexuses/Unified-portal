import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isTransientBoatError, runBoatCommand, shellQuote } from "@/lib/boat";

/**
 * India address for the cloud campaign senders, through NordVPN.
 *
 * Only the senders' Chrome goes through NordVPN, never the whole computer. A full-computer VPN
 * (the first version) also tunnelled Boat's own traffic: backups failed from the moment it
 * connected, Boat then refused to stop the computer ("no snapshot in the last 30 minutes"), and
 * eventually lost the machine. Now each computer runs a tiny relay on 127.0.0.1 that forwards
 * Chrome's traffic to a NordVPN HTTPS proxy server in India (adding the login Chrome can't send),
 * and the sender Chrome starts with `--proxy-server` pointing at it. Everything else, including
 * Boat, uses the normal connection.
 *
 * One setting per project (the project has one cloud computer, and switching location per
 * campaign would look like an account takeover). When it is on and India can't be confirmed, we
 * refuse to go on, so no email leaves from the wrong place by accident. The NordVPN login comes
 * from NORDVPN_TOKEN (an access token), which also fetches the proxy credentials.
 */

/** NordVPN's name for the country (its server list and IP lookup use it). */
export const CLOUD_VPN_COUNTRY = process.env.NORDVPN_COUNTRY?.trim() || "India";

const NORD_API = "https://api.nordvpn.com/v1";
const RELAY_PORT = 18089;
const RELAY_URL = `http://127.0.0.1:${RELAY_PORT}`;
const RELAY_DIR = "/var/tmp/nexuses-relay";
const RELAY_CONFIG = `${RELAY_DIR}/config.json`;
const RELAY_SCRIPT = `${RELAY_DIR}/relay.mjs`;
const RELAY_LOG = `${RELAY_DIR}/relay.log`;
/**
 * The relay is stopped by its PID, never by `pkill -f`: the shell command that starts it
 * contains the same text, so a pattern match would kill that command too.
 */
const RELAY_PID = `${RELAY_DIR}/relay.pid`;
const STOP_RELAY = `[ -s ${RELAY_PID} ] && kill $(cat ${RELAY_PID}) 2>/dev/null; rm -f ${RELAY_PID};`;
/** Sender Chrome reads this (lib/cloud-sender ensureSenderChrome): present = use the proxy. */
export const SENDER_PROXY_MARKER = "/var/tmp/nexuses-sender-proxy";

export type CloudVpnStatus = {
  connected: boolean;
  country?: string;
  city?: string;
  ip?: string;
  checkedAt: string;
  error?: string;
};

type CloudVpnDoc = {
  projectId: ObjectId;
  enabled: boolean;
  country: string;
  /** What the computer was last left in, so turning it off knows to undo it. */
  applied?: boolean;
  status?: CloudVpnStatus;
  /** Computers already checked for the old full-computer VPN and cleared of it. */
  systemVpnCleared?: string[];
  updatedAt: Date;
  updatedBy?: string;
};

export type CloudVpnSetting = {
  enabled: boolean;
  country: string;
  configured: boolean;
  status: CloudVpnStatus | null;
};

let indexed = false;

async function vpnDocs() {
  const db = await getDb();
  const collection = db.collection<CloudVpnDoc>("cloud_vpn");
  if (!indexed) {
    await collection.createIndex({ projectId: 1 }, { unique: true });
    indexed = true;
  }
  return collection;
}

export function cloudVpnConfigured() {
  return Boolean(process.env.NORDVPN_TOKEN?.trim());
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

export async function getCloudVpnSetting(projectId: ObjectId): Promise<CloudVpnSetting> {
  const doc = await (await vpnDocs()).findOne({ projectId });
  return {
    enabled: doc?.enabled === true,
    country: doc?.country || CLOUD_VPN_COUNTRY,
    configured: cloudVpnConfigured(),
    status: doc?.status ?? null,
  };
}

export async function setCloudVpnEnabled(
  projectId: ObjectId,
  enabled: boolean,
  updatedBy?: string,
) {
  if (enabled && !cloudVpnConfigured()) {
    throw new Error("NordVPN is not set up. An admin needs to add NORDVPN_TOKEN to the server.");
  }
  await (await vpnDocs()).updateOne(
    { projectId },
    {
      $set: { enabled, country: CLOUD_VPN_COUNTRY, updatedAt: new Date(), updatedBy },
      $setOnInsert: { projectId },
    },
    { upsert: true },
  );
}

async function saveStatus(projectId: ObjectId, status: CloudVpnStatus, applied: boolean) {
  await (await vpnDocs()).updateOne(
    { projectId },
    { $set: { status, applied, updatedAt: new Date() } },
  );
}

/* ------------------------------------------------------------------ NordVPN account */

type ProxyCredentials = { username: string; password: string };
let credentialsCache: { value: ProxyCredentials; at: number } | null = null;

/** The proxy login (NordVPN "service credentials"), fetched with the access token. */
async function proxyCredentials(): Promise<ProxyCredentials> {
  if (credentialsCache && Date.now() - credentialsCache.at < 60 * 60 * 1000) return credentialsCache.value;
  const token = process.env.NORDVPN_TOKEN?.trim();
  if (!token) throw new Error("NordVPN is not set up. An admin needs to add NORDVPN_TOKEN to the server.");
  const response = await fetch(`${NORD_API}/users/services/credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`token:${token}`).toString("base64")}` },
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => null)) as Partial<ProxyCredentials> | null;
  if (!response.ok || !data?.username || !data.password) {
    throw new Error(
      `NordVPN didn't accept NORDVPN_TOKEN (${response.status}). Check it is a valid access token from the Nord Account dashboard.`,
    );
  }
  credentialsCache = { value: { username: data.username, password: data.password }, at: Date.now() };
  return credentialsCache.value;
}

let serversCache: { country: string; hosts: string[]; at: number } | null = null;

/** Least-loaded NordVPN servers in the country that offer the HTTPS proxy. */
async function proxyServers(country: string): Promise<string[]> {
  if (serversCache && serversCache.country === country && Date.now() - serversCache.at < 30 * 60 * 1000) {
    return serversCache.hosts;
  }
  const countries = (await fetch(`${NORD_API}/servers/countries`, { signal: AbortSignal.timeout(20_000) })
    .then((r) => r.json())
    .catch(() => [])) as { id: number; name: string; code: string }[];
  const match = countries.find(
    (c) => c.name.toLowerCase() === country.toLowerCase() || c.code.toLowerCase() === country.toLowerCase(),
  );
  if (!match) throw new Error(`NordVPN has no servers in "${country}".`);
  const url =
    `${NORD_API}/servers/recommendations?filters[country_id]=${match.id}` +
    `&filters[servers_technologies][identifier]=proxy_ssl&limit=5`;
  const list = (await fetch(url, { signal: AbortSignal.timeout(20_000) })
    .then((r) => r.json())
    .catch(() => [])) as { hostname?: string; status?: string }[];
  // The proxy's certificate is for *.proxy.nordvpn.com, so use that name (in201.proxy.nordvpn.com).
  const hosts = list
    .filter((s) => s.hostname && s.status !== "offline")
    .map((s) => String(s.hostname).replace(/\.nordvpn\.com$/, ".proxy.nordvpn.com"));
  if (!hosts.length) throw new Error(`NordVPN has no proxy servers online in ${country} right now.`);
  serversCache = { country, hosts, at: Date.now() };
  return hosts;
}

/* ------------------------------------------------------------------ Relay on the computer */

/**
 * Local HTTP proxy for Chrome: CONNECT (https) and plain http requests go to the NordVPN HTTPS
 * proxy with the login added. Reads its upstream from config.json and picks up changes live.
 * Plain JS for the VM's Node; keep it free of backticks and "${".
 */
const RELAY_SOURCE = String.raw`import http from "node:http";
import tls from "node:tls";
import fs from "node:fs";
const CONFIG = process.argv[2];
let cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
fs.watchFile(CONFIG, { interval: 3000 }, () => {
  try { cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch {}
});
const auth = () => "Basic " + Buffer.from(cfg.username + ":" + cfg.password).toString("base64");

/** Open a tunnel to target ("host:port") through the NordVPN proxy. */
function tunnel(target, onReady, onFail) {
  const up = tls.connect({ host: cfg.host, port: 89, servername: cfg.host });
  let buf = Buffer.alloc(0);
  let settled = false;
  const fail = () => { if (settled) return; settled = true; up.destroy(); onFail(); };
  up.setTimeout(60000, () => up.destroy());
  up.on("error", fail);
  up.on("secureConnect", () => {
    up.write("CONNECT " + target + " HTTP/1.1\r\nHost: " + target + "\r\nProxy-Authorization: " + auth() + "\r\n\r\n");
  });
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf("\r\n\r\n");
    if (end < 0) { if (buf.length > 16384) fail(); return; }
    up.removeListener("data", onData);
    if (!/^HTTP\/1\.[01] 200/.test(buf.slice(0, end).toString("latin1"))) return fail();
    settled = true;
    up.removeListener("error", fail);
    onReady(up, buf.slice(end + 4));
  };
  up.on("data", onData);
}

const server = http.createServer((req, res) => {
  // Plain http: tunnel to the site's port and replay the request there in origin form.
  let url;
  try { url = new URL(req.url); } catch { res.writeHead(400); res.end(); return; }
  const target = url.hostname + ":" + (url.port || "80");
  tunnel(target, (up, rest) => {
    const lines = [req.method + " " + (url.pathname + url.search) + " HTTP/1.1"];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (!/^(proxy-|connection$)/i.test(req.rawHeaders[i])) lines.push(req.rawHeaders[i] + ": " + req.rawHeaders[i + 1]);
    }
    lines.push("Connection: close", "", "");
    up.write(lines.join("\r\n"));
    if (rest.length) req.socket.write(rest);
    // Don't half-close the tunnel when the request ends; the reply still has to come back.
    req.pipe(up, { end: false });
    up.pipe(req.socket);
    up.on("error", () => req.socket.destroy());
    req.socket.on("error", () => up.destroy());
  }, () => { try { res.writeHead(502); res.end(); } catch {} });
});

server.on("connect", (req, client, head) => {
  tunnel(req.url, (up, rest) => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (rest.length) client.write(rest);
    if (head && head.length) up.write(head);
    up.pipe(client);
    client.pipe(up);
    up.on("error", () => client.destroy());
    client.on("error", () => up.destroy());
  }, () => { try { client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); } catch {} });
  client.on("error", () => {});
});

server.on("clientError", (err, socket) => { try { socket.destroy(); } catch {} });
server.listen(Number(process.argv[3]), "127.0.0.1");
`;

/** Write config + relay, start it if it isn't running, and point the sender Chrome at it. */
async function startRelay(sandboxId: string, host: string, credentials: ProxyCredentials) {
  const config = JSON.stringify({ host, username: credentials.username, password: credentials.password });
  const scriptB64 = Buffer.from(RELAY_SOURCE, "utf8").toString("base64");
  const configB64 = Buffer.from(config, "utf8").toString("base64");
  const probe = `ss -ltn 2>/dev/null | grep -q ':${RELAY_PORT} '`;
  const command = [
    `mkdir -p ${RELAY_DIR} && chmod 700 ${RELAY_DIR};`,
    `echo ${shellQuote(scriptB64)} | base64 -d > ${RELAY_SCRIPT}.new;`,
    // Replace the script (and restart) only when it changed.
    `if ! cmp -s ${RELAY_SCRIPT}.new ${RELAY_SCRIPT}; then mv ${RELAY_SCRIPT}.new ${RELAY_SCRIPT}; ${STOP_RELAY} sleep 1; else rm -f ${RELAY_SCRIPT}.new; fi;`,
    `umask 077; echo ${shellQuote(configB64)} | base64 -d > ${RELAY_CONFIG};`,
    `if ! (${probe}); then nohup node ${RELAY_SCRIPT} ${RELAY_CONFIG} ${RELAY_PORT} >${RELAY_LOG} 2>&1 < /dev/null & echo $! > ${RELAY_PID}; sleep 1; fi;`,
    `for i in 1 2 3 4 5; do if (${probe}); then echo relay-up; break; fi; sleep 1; done;`,
    `echo ${shellQuote(RELAY_URL)} > ${SENDER_PROXY_MARKER};`,
  ].join(" ");
  const result = await runBoatCommand(sandboxId, command, 40);
  if (!/relay-up/.test(result.stdout)) {
    throw new Error(`The NordVPN relay didn't start on the cloud computer. ${(result.stdout + result.stderr).trim().slice(-200)}`);
  }
}

/** Ask NordVPN, through the relay, where the sender Chrome appears to be. */
async function relayLocation(sandboxId: string) {
  const result = await runBoatCommand(
    sandboxId,
    `curl -s --max-time 25 -x ${RELAY_URL} ${NORD_API}/helpers/ips/insights`,
    35,
  );
  try {
    const data = JSON.parse(result.stdout.trim()) as {
      ip?: string;
      country?: string;
      country_code?: string;
      city?: string;
      protected?: boolean;
    };
    return data;
  } catch {
    return null;
  }
}

/** Stop the relay and let the sender Chrome go direct (it restarts without the proxy). */
async function stopRelay(sandboxId: string) {
  await runBoatCommand(
    sandboxId,
    `rm -f ${SENDER_PROXY_MARKER}; ${STOP_RELAY} echo relay-off`,
    20,
  );
}

/**
 * The first version ran NordVPN on the whole computer. If this computer still has it (installed
 * and possibly auto-connecting), switch it off for good: it blocks Boat's backups and stops.
 */
async function clearSystemVpn(projectId: ObjectId, sandboxId: string, doc: CloudVpnDoc | null) {
  if (doc?.systemVpnCleared?.includes(sandboxId)) return;
  await runBoatCommand(
    sandboxId,
    "command -v nordvpn >/dev/null 2>&1 && { sudo -n nordvpn set autoconnect off >/dev/null 2>&1; sudo -n nordvpn disconnect >/dev/null 2>&1; }; echo cleared",
    40,
  );
  await (await vpnDocs()).updateOne(
    { projectId },
    { $addToSet: { systemVpnCleared: sandboxId }, $setOnInsert: { enabled: false, country: CLOUD_VPN_COUNTRY, updatedAt: new Date() } },
    { upsert: true },
  );
}

function rightCountry(location: { country?: string; country_code?: string }, country: string) {
  const want = country.toLowerCase();
  return (location.country || "").toLowerCase() === want || (location.country_code || "").toLowerCase() === want;
}

/**
 * Bring the cloud computer in line with the project setting. Called whenever a campaign readies
 * the computer. Throws when the VPN is on but India can't be confirmed, so nothing is sent from
 * the wrong place.
 */
export async function ensureCloudVpn(projectId: ObjectId, sandboxId: string) {
  const doc = await (await vpnDocs()).findOne({ projectId });
  await clearSystemVpn(projectId, sandboxId, doc).catch((error) => {
    if (isTransientBoatError(error)) throw error;
    console.warn("Cloud VPN: couldn't check for the old full-computer VPN:", errorText(error));
  });

  if (!doc?.enabled) {
    if (doc?.applied) {
      await stopRelay(sandboxId).catch((error) => console.warn("Cloud VPN: stopping the relay failed:", errorText(error)));
      await saveStatus(projectId, { connected: false, checkedAt: new Date().toISOString() }, false);
    }
    return null;
  }

  const country = doc.country || CLOUD_VPN_COUNTRY;
  try {
    const credentials = await proxyCredentials();
    const hosts = await proxyServers(country);
    let lastProblem = "";
    // Try the least-loaded server first, then two more.
    for (const host of hosts.slice(0, 3)) {
      await startRelay(sandboxId, host, credentials);
      const location = await relayLocation(sandboxId);
      if (location && rightCountry(location, country)) {
        const ok: CloudVpnStatus = {
          connected: true,
          country: location.country,
          city: location.city,
          ip: location.ip,
          checkedAt: new Date().toISOString(),
        };
        await saveStatus(projectId, ok, true);
        return ok;
      }
      lastProblem = location
        ? `${host} showed ${location.country || "an unknown country"}`
        : `${host} didn't answer`;
    }
    throw new Error(`NordVPN didn't give an address in ${country} (${lastProblem}).`);
  } catch (error) {
    // A short Boat blip is not a VPN problem; let the caller retry it like any other blip.
    if (isTransientBoatError(error)) throw error;
    const message = errorText(error);
    // Don't leave Chrome pointed at a relay that doesn't work.
    await stopRelay(sandboxId).catch(() => undefined);
    await saveStatus(
      projectId,
      { connected: false, checkedAt: new Date().toISOString(), error: message },
      true,
    );
    throw new Error(`VPN (${country}) is on for this project but not connected, so the cloud computer was not used. ${message}`);
  }
}
