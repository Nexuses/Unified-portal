import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isValidEmail, type SenderComposio, type SmtpProviderId } from "@/lib/smtp-senders";

const COMPOSIO_API = "https://backend.composio.dev/api/v3.1";

export type ComposioMailbox = "gmail" | "outlook";

type PendingComposioLink = {
  _id: ObjectId;
  projectId: ObjectId;
  portalUserId: string;
  provider: ComposioMailbox;
  connectedAccountId: string;
  composioUserId: string;
  createdAt: Date;
};

export class ComposioConfigError extends Error {}

function apiKey() {
  const key = process.env.COMPOSIO_API_KEY?.trim();
  if (!key) {
    throw new ComposioConfigError(
      "Add COMPOSIO_API_KEY to the server environment, then try Connect again.",
    );
  }
  return key;
}

function toolkitSlug(provider: ComposioMailbox) {
  return provider === "gmail" ? "gmail" : "outlook";
}

async function composioFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${COMPOSIO_API}${path}`, {
    ...init,
    headers: {
      "x-api-key": apiKey(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    throw new Error(composioErrorMessage(body) || `Composio request failed (${response.status}).`);
  }
  return body;
}

function composioErrorMessage(body: unknown) {
  if (!body) return "";
  if (typeof body === "string") return body.replace(/\s+/g, " ").slice(0, 280);
  if (typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string" && error.trim()) return error.trim().slice(0, 280);
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 280);
  }
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim().slice(0, 280);
  }
  return "";
}

function stringField(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return "";
}

function authConfigFromEnv(provider: ComposioMailbox) {
  const raw =
    provider === "gmail"
      ? process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID
      : process.env.COMPOSIO_OUTLOOK_AUTH_CONFIG_ID;
  return raw?.trim() || "";
}

async function authConfigId(provider: ComposioMailbox) {
  const fromEnv = authConfigFromEnv(provider);
  if (fromEnv) return fromEnv;

  const slug = toolkitSlug(provider);
  const listed = await composioFetch(`/auth_configs?toolkit_slug=${slug}&limit=20`);
  const items = Array.isArray(listed)
    ? listed
    : listed && typeof listed === "object" && Array.isArray((listed as { items?: unknown }).items)
      ? (listed as { items: unknown[] }).items
      : [];
  for (const item of items) {
    const id = stringField(item, ["id", "nanoid"]);
    if (id) return id;
  }

  const created = await composioFetch("/auth_configs", {
    method: "POST",
    body: JSON.stringify({
      toolkit: { slug },
      auth_config: {
        type: "use_composio_managed_auth",
        name: provider === "gmail" ? "Nexgos Gmail" : "Nexgos Outlook",
      },
    }),
  });
  const createdId =
    stringField(created, ["id"]) ||
    stringField(
      created && typeof created === "object" ? (created as { auth_config?: unknown }).auth_config : null,
      ["id"],
    );
  if (!createdId) {
    throw new Error(`Composio did not return an auth config for ${provider}.`);
  }
  return createdId;
}

export function isComposioMailbox(provider: string): provider is ComposioMailbox {
  return provider === "gmail" || provider === "outlook";
}

export async function startComposioSenderLink(input: {
  projectId: string;
  portalUserId: string;
  provider: ComposioMailbox;
  origin: string;
}) {
  const composioUserId = `portal-${input.portalUserId}`;
  const pendingId = new ObjectId();
  const callback = new URL("/api/smtp/senders/composio/callback", input.origin);
  callback.searchParams.set("pending", pendingId.toString());

  const linked = await composioFetch("/connected_accounts/link", {
    method: "POST",
    body: JSON.stringify({
      auth_config_id: await authConfigId(input.provider),
      user_id: composioUserId,
      alias: `sender-${pendingId.toString()}`,
      callback_url: callback.toString(),
    }),
  });

  const redirectUrl = stringField(linked, ["redirect_url", "redirectUrl"]);
  const connectedAccountId = stringField(linked, ["connected_account_id", "connectedAccountId", "id"]);
  if (!redirectUrl || !connectedAccountId) {
    throw new Error("Composio did not return a sign-in link.");
  }

  const db = await getDb();
  await db.collection<PendingComposioLink>("composio_sender_links").insertOne({
    _id: pendingId,
    projectId: new ObjectId(input.projectId),
    portalUserId: input.portalUserId,
    provider: input.provider,
    connectedAccountId,
    composioUserId,
    createdAt: new Date(),
  });

  return { redirectUrl };
}

function payloadData(body: unknown) {
  if (!body || typeof body !== "object" || !("data" in body)) return body;
  const data = (body as { data: unknown }).data;
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return data;
    }
  }
  return data ?? body;
}

function findMailboxAddress(value: unknown, depth = 0): string {
  if (depth > 6 || !value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["emailAddress", "email", "mail", "userPrincipalName", "fromEmail"]) {
    const direct = record[key];
    if (typeof direct === "string" && isValidEmail(direct.trim())) {
      return direct.trim().toLowerCase();
    }
    if (direct && typeof direct === "object") {
      const address = (direct as { address?: unknown }).address;
      if (typeof address === "string" && isValidEmail(address.trim())) {
        return address.trim().toLowerCase();
      }
    }
  }
  for (const key of ["data", "response_data", "val", "state", "params", "user", "profile"]) {
    if (key in record) {
      const found = findMailboxAddress(record[key], depth + 1);
      if (found) return found;
    }
  }
  return "";
}

async function accountIsActive(connectedAccountId: string) {
  const account = await composioFetch(
    `/connected_accounts/${encodeURIComponent(connectedAccountId)}`,
  );
  const status = stringField(account, ["status"]).toUpperCase();
  return { active: status === "ACTIVE", account };
}

async function mailboxAddress(
  provider: ComposioMailbox,
  composio: SenderComposio,
  account: unknown,
) {
  const tool = provider === "gmail" ? "GMAIL_GET_PROFILE" : "OUTLOOK_GET_PROFILE";
  try {
    const profile = await executeComposioTool(tool, composio, { user_id: "me" });
    const fromProfile = findMailboxAddress(payloadData(profile));
    if (fromProfile) return fromProfile;
  } catch {
    /* Fall back to the connected-account payload. */
  }
  const fromAccount = findMailboxAddress(account);
  if (fromAccount) return fromAccount;
  throw new Error("Composio signed in, but did not return the mailbox address.");
}

export async function completeComposioSenderLink(pendingId: string, session: { id: string; projectId: string }) {
  if (!ObjectId.isValid(pendingId)) {
    throw new Error("This Composio sign-in link is not valid.");
  }
  const db = await getDb();
  const pending = await db.collection<PendingComposioLink>("composio_sender_links").findOne({
    _id: new ObjectId(pendingId),
  });
  if (!pending) {
    throw new Error("This Composio sign-in link has already been used.");
  }
  if (pending.projectId.toString() !== session.projectId || pending.portalUserId !== session.id) {
    throw new Error("Sign in to the same project that started this connection.");
  }
  if (Date.now() - pending.createdAt.getTime() > 30 * 60 * 1000) {
    await db.collection("composio_sender_links").deleteOne({ _id: pending._id });
    throw new Error("This Composio sign-in link expired. Connect again.");
  }

  let active = false;
  let account: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const checked = await accountIsActive(pending.connectedAccountId);
    active = checked.active;
    account = checked.account;
    if (active) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!active) {
    throw new Error("Composio has not finished signing in this mailbox yet. Try Connect again.");
  }

  const composio: SenderComposio = {
    connectedAccountId: pending.connectedAccountId,
    userId: pending.composioUserId,
  };
  const fromEmail = await mailboxAddress(pending.provider, composio, account);
  await db.collection("composio_sender_links").deleteOne({ _id: pending._id });

  return {
    projectId: pending.projectId,
    portalUserId: pending.portalUserId,
    provider: pending.provider as SmtpProviderId,
    fromEmail,
    composio,
  };
}

async function executeComposioTool(
  tool: string,
  composio: SenderComposio,
  args: Record<string, unknown>,
) {
  const body = await composioFetch(`/tools/execute/${tool}`, {
    method: "POST",
    body: JSON.stringify({
      connected_account_id: composio.connectedAccountId,
      user_id: composio.userId,
      version: "latest",
      arguments: args,
    }),
  });
  if (body && typeof body === "object" && (body as { successful?: unknown }).successful === false) {
    throw new Error(composioErrorMessage(body) || "Composio could not send the email.");
  }
  return body;
}

export async function sendComposioMail(
  sender: {
    provider: SmtpProviderId;
    fromEmail: string;
    composio?: SenderComposio;
  },
  input: {
    to: string[];
    subject: string;
    html: string;
    cc?: string[];
  },
) {
  const composio = sender.composio;
  if (!composio?.connectedAccountId || !isComposioMailbox(sender.provider)) {
    throw new Error("This sender is not connected through Composio.");
  }
  const to = input.to.map((email) => email.trim()).filter(Boolean);
  if (to.length === 0) {
    throw new Error("Add a recipient before sending.");
  }
  const cc = (input.cc ?? []).map((email) => email.trim()).filter(Boolean);

  if (sender.provider === "gmail") {
    await executeComposioTool("GMAIL_SEND_EMAIL", composio, {
      recipient_email: to[0],
      ...(to.length > 1 ? { extra_recipients: to.slice(1) } : {}),
      ...(cc.length > 0 ? { cc } : {}),
      subject: input.subject,
      body: input.html,
      is_html: true,
      from_email: sender.fromEmail,
      user_id: "me",
      include_signature: false,
    });
    return;
  }

  await executeComposioTool("OUTLOOK_SEND_EMAIL", composio, {
    to: to.join(", "),
    ...(cc.length > 0 ? { cc_emails: cc } : {}),
    subject: input.subject,
    body: input.html,
    is_html: true,
    from_address: sender.fromEmail,
    user_id: "me",
    save_to_sent_items: true,
  });
}
