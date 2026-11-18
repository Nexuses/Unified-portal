import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isTransientBoatError, runBoatCommand, shellQuote } from "@/lib/boat";

/**
 * NordVPN on the cloud campaign computer (Boat sandbox), so Gmail/Outlook see an India address.
 *
 * One setting per project, because the project has one cloud computer and every campaign's
 * senders sign in on it; switching location per campaign would look like an account takeover.
 * When the setting is on, every time a campaign readies the computer we make sure NordVPN is
 * installed, signed in (NORDVPN_TOKEN, an access token from the Nord Account dashboard) and
 * connected to India. If it cannot be connected we refuse to go on, so no email ever leaves
 * from a non-India address by accident.
 */

/** NordVPN's country name for the CLI (`nordvpn connect India`). */
export const CLOUD_VPN_COUNTRY = process.env.NORDVPN_COUNTRY?.trim() || "India";

const RELEASE_DEB =
  "https://repo.nordvpn.com/deb/nordvpn/debian/pool/main/n/nordvpn-release/nordvpn-release_1.0.0_all.deb";
const INSTALL_LOG = "/tmp/nx-vpn-install.log";
const INSTALL_DONE = "/tmp/nx-vpn-install.done";
/** Written by the server once it can still reach the computer after connecting. */
const ALIVE_MARK = "/tmp/nx-vpn-ok";
/** If the server has not confirmed it can still reach the computer by then, disconnect. */
const DEADMAN_SECONDS = 75;

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
  /** What the computer was last left in, so turning the VPN off knows to disconnect. */
  applied?: boolean;
  status?: CloudVpnStatus;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** Plain `nordvpn status` text -> fields (the CLI prints a spinner and colours we drop). */
function parseStatus(output: string): Omit<CloudVpnStatus, "checkedAt"> {
  const text = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "\n");
  const field = (name: string) =>
    text.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "im"))?.[1]?.trim() || undefined;
  return {
    connected: /^\s*status:\s*connected/im.test(text),
    country: field("Country"),
    city: field("City"),
    ip: field("IP"),
  };
}

function rightCountry(status: { country?: string }, country: string) {
  return (status.country || "").toLowerCase() === country.toLowerCase();
}

/** Root runs the CLI so we never depend on the desktop user being in the nordvpn group. */
const NORD = "sudo -n nordvpn";

/** nordvpnd needs a tun device and a running daemon; Boat may have neither systemd nor tun. */
const START_DAEMON = [
  "[ -c /dev/net/tun ] || { sudo -n mkdir -p /dev/net && sudo -n mknod /dev/net/tun c 10 200 && sudo -n chmod 600 /dev/net/tun; } || { echo tun-missing; exit 3; };",
  "if ! pgrep -x nordvpnd >/dev/null 2>&1; then",
  "  sudo -n systemctl start nordvpnd >/dev/null 2>&1 ||",
  "  sudo -n sh -c 'nohup \"$(command -v nordvpnd || echo /usr/sbin/nordvpnd)\" >/tmp/nordvpnd.log 2>&1 &';",
  "  for i in 1 2 3 4 5 6 7 8 9 10; do [ -S /run/nordvpn/nordvpnd.sock ] && break; sleep 1; done;",
  "fi;",
].join(" ");

async function installNordvpn(sandboxId: string) {
  const script = [
    "set -e",
    "export DEBIAN_FRONTEND=noninteractive",
    "cd /tmp",
    `curl -fsSL -o nordvpn-release.deb ${shellQuote(RELEASE_DEB)}`,
    "sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ./nordvpn-release.deb",
    "sudo -n apt-get update -qq",
    "sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nordvpn",
  ].join("\n");
  // apt can take longer than one Boat command allows, so run it in the background and poll.
  const start = await runBoatCommand(
    sandboxId,
    [
      "command -v nordvpn >/dev/null && { echo nordvpn-present; exit 0; };",
      `rm -f ${INSTALL_DONE};`,
      `nohup sh -c ${shellQuote(`( ${script} ) >${INSTALL_LOG} 2>&1; echo $? >${INSTALL_DONE}`)} >/dev/null 2>&1 &`,
      "echo install-started",
    ].join(" "),
    20,
  );
  if (/nordvpn-present/.test(start.stdout)) return;
  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const poll = await runBoatCommand(
      sandboxId,
      `if [ -f ${INSTALL_DONE} ]; then echo "done:$(cat ${INSTALL_DONE})"; tail -5 ${INSTALL_LOG}; fi`,
      15,
    );
    const done = poll.stdout.match(/done:(\d+)/);
    if (!done) continue;
    if (done[1] === "0") return;
    throw new Error(
      `NordVPN could not be installed on the cloud computer: ${poll.stdout.replace(/done:\d+\s*/, "").trim() || "apt failed"}`,
    );
  }
  throw new Error("Installing NordVPN on the cloud computer took too long. Try again in a minute.");
}

async function readStatus(sandboxId: string) {
  const result = await runBoatCommand(
    sandboxId,
    `command -v nordvpn >/dev/null || { echo nordvpn-missing; exit 0; }; ${START_DAEMON} ${NORD} status 2>&1`,
    30,
  );
  return {
    missing: /nordvpn-missing/.test(result.stdout),
    tunMissing: /tun-missing/.test(result.stdout),
    ...parseStatus(result.stdout),
    raw: result.stdout,
  };
}

/** Sign in and settle the options that keep the Boat connection reachable. */
async function prepareNordvpn(sandboxId: string) {
  const token = process.env.NORDVPN_TOKEN?.trim();
  if (!token) {
    throw new Error("NordVPN is not set up. An admin needs to add NORDVPN_TOKEN to the server.");
  }
  const result = await runBoatCommand(
    sandboxId,
    [
      START_DAEMON,
      // Never send usage analytics; it also skips the consent prompt on first login.
      `${NORD} set analytics off >/dev/null 2>&1 || true;`,
      `${NORD} account >/dev/null 2>&1 || ${NORD} login --token ${shellQuote(token)} 2>&1 | tail -2;`,
      `${NORD} account >/dev/null 2>&1 || { echo login-failed; exit 4; };`,
      `${NORD} set technology nordlynx >/dev/null 2>&1 || true;`,
      // Kill switch would block Boat's own control traffic if the tunnel drops.
      `${NORD} set killswitch off >/dev/null 2>&1 || true;`,
      // Keep private networks (how Boat reaches the computer) outside the tunnel.
      `${NORD} set lan-discovery enable >/dev/null 2>&1 || ${NORD} set lan-discovery on >/dev/null 2>&1 || true;`,
      `${NORD} set autoconnect on ${shellQuote(CLOUD_VPN_COUNTRY)} >/dev/null 2>&1 || true;`,
      "echo prepared",
    ].join(" "),
    60,
  );
  if (/tun-missing/.test(result.stdout)) {
    throw new Error(
      "This cloud computer has no network tunnel device, so NordVPN cannot run on it. Ask Boat to enable /dev/net/tun.",
    );
  }
  if (/login-failed/.test(result.stdout) || !/prepared/.test(result.stdout)) {
    throw new Error(
      `NordVPN sign-in failed on the cloud computer. Check NORDVPN_TOKEN is a valid access token. ${result.stdout.replace(/prepared/, "").trim()}`.trim(),
    );
  }
}

/**
 * Connect with a dead-man switch: the computer disconnects by itself unless the server proves,
 * right after, that it can still reach it. A tunnel that swallows Boat's control traffic would
 * otherwise leave the computer unreachable.
 */
async function connectNordvpn(sandboxId: string) {
  const connectCommand = [
    `rm -f ${ALIVE_MARK};`,
    `nohup sh -c ${shellQuote(`sleep ${DEADMAN_SECONDS}; [ -f ${ALIVE_MARK} ] || ${NORD} disconnect`)} >/dev/null 2>&1 &`,
    `${NORD} connect ${shellQuote(CLOUD_VPN_COUNTRY)} 2>&1 | tail -3`,
  ].join(" ");
  let connectOutput = "";
  let lostDuringConnect = false;
  try {
    connectOutput = (await runBoatCommand(sandboxId, connectCommand, 60)).stdout;
  } catch (error) {
    lostDuringConnect = true;
    console.warn("Cloud VPN: lost the computer while connecting:", errorText(error));
  }

  // Prove the computer is still reachable; this also cancels the dead-man switch.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const alive = await runBoatCommand(sandboxId, `touch ${ALIVE_MARK}; ${NORD} status 2>&1`, 20);
      return { ...parseStatus(alive.stdout), output: connectOutput };
    } catch {
      if (attempt === 2) break;
      await sleep(4000);
    }
  }

  // Unreachable: wait out the dead-man switch, then make sure the computer came back.
  await sleep((DEADMAN_SECONDS + 10) * 1000);
  try {
    await runBoatCommand(sandboxId, "echo back", 15);
  } catch {
    throw new Error(
      "Connecting NordVPN cut the server off from the cloud computer, and it has not come back yet. Turn the VPN off here, then click Refresh computer.",
    );
  }
  throw new Error(
    `Connecting NordVPN cut the server off from the cloud computer, so it was disconnected again${lostDuringConnect ? "" : ` (${connectOutput.trim()})`}. The VPN cannot be used on this computer as set up.`,
  );
}

/**
 * Bring the cloud computer's VPN in line with the project setting. Called whenever a campaign
 * readies the computer. Throws when the VPN is on but India cannot be confirmed, so nothing is
 * sent from the wrong place.
 */
export async function ensureCloudVpn(projectId: ObjectId, sandboxId: string) {
  const doc = await (await vpnDocs()).findOne({ projectId });
  if (!doc?.enabled) {
    if (doc?.applied) {
      // Turned off since last time: leave the computer on its own connection again.
      await runBoatCommand(
        sandboxId,
        `command -v nordvpn >/dev/null && { ${NORD} set autoconnect off >/dev/null 2>&1; ${NORD} disconnect 2>&1 | tail -1; } || true`,
        30,
      ).catch((error) => console.warn("Cloud VPN: disconnect failed:", errorText(error)));
      await saveStatus(projectId, { connected: false, checkedAt: new Date().toISOString() }, false);
    }
    return null;
  }

  const country = doc.country || CLOUD_VPN_COUNTRY;
  try {
    let status = await readStatus(sandboxId);
    if (status.connected && rightCountry(status, country)) {
      const ok: CloudVpnStatus = {
        connected: true,
        country: status.country,
        city: status.city,
        ip: status.ip,
        checkedAt: new Date().toISOString(),
      };
      await saveStatus(projectId, ok, true);
      return ok;
    }
    if (status.tunMissing) {
      throw new Error(
        "This cloud computer has no network tunnel device, so NordVPN cannot run on it. Ask Boat to enable /dev/net/tun.",
      );
    }
    if (status.missing) await installNordvpn(sandboxId);
    await prepareNordvpn(sandboxId);
    const connected = await connectNordvpn(sandboxId);
    status = { ...status, ...connected };
    if (!connected.connected || !rightCountry(connected, country)) {
      throw new Error(
        `NordVPN did not connect to ${country}${connected.country ? ` (it shows ${connected.country})` : ""}. ${connected.output.trim()}`.trim(),
      );
    }
    const ok: CloudVpnStatus = {
      connected: true,
      country: connected.country,
      city: connected.city,
      ip: connected.ip,
      checkedAt: new Date().toISOString(),
    };
    await saveStatus(projectId, ok, true);
    return ok;
  } catch (error) {
    // A short Boat blip is not a VPN problem; let the caller retry it like any other blip.
    if (isTransientBoatError(error)) throw error;
    const message = errorText(error);
    await saveStatus(
      projectId,
      { connected: false, checkedAt: new Date().toISOString(), error: message },
      true,
    );
    throw new Error(`VPN (${country}) is on for this project but not connected, so the cloud computer was not used. ${message}`);
  }
}
