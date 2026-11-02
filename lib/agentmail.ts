const AGENTMAIL_API_BASE = "https://api.agentmail.to/v0";

export type AgentMailAuthResult =
  | "pass"
  | "fail"
  | "none"
  | "neutral"
  | "softfail"
  | "temperror"
  | "permerror";

export type AgentMailAuthenticationResults = {
  spf?: AgentMailAuthResult;
  dkim?: AgentMailAuthResult;
  dmarc?: AgentMailAuthResult;
  spf_domain?: string;
  dkim_domain?: string;
  dmarc_domain?: string;
  arc_sealer?: string;
};

export type AgentMailInbox = {
  inbox_id: string;
  email: string;
  created_at?: string;
  client_id?: string;
  display_name?: string;
};

export type AgentMailMessageItem = {
  inbox_id: string;
  message_id: string;
  thread_id: string;
  subject?: string;
  from: string;
  to: string[];
  labels: string[];
  created_at: string;
  timestamp: string;
  authentication_results?: AgentMailAuthenticationResults;
};

export type AgentMailMessage = AgentMailMessageItem & {
  html?: string;
  text?: string;
  preview?: string;
  headers?: Record<string, string>;
  authentication_results?: AgentMailAuthenticationResults;
};

function getApiKey() {
  return process.env.AGENTMAIL_API_KEY?.trim() ?? "";
}

export function isAgentMailConfigured() {
  return Boolean(getApiKey());
}

async function agentMailFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "AgentMail is not configured. Add AGENTMAIL_API_KEY to the server env.",
    );
  }

  const response = await fetch(`${AGENTMAIL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let message = `AgentMail request failed (${response.status})`;
    try {
      const parsed = JSON.parse(detail) as { message?: string; error?: string };
      message = parsed.message || parsed.error || message;
    } catch {
      if (detail.trim()) {
        message = detail.trim().slice(0, 240);
      }
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function listAgentMailInboxes(limit = 50) {
  const data = await agentMailFetch<{
    count: number;
    inboxes: AgentMailInbox[];
  }>(`/inboxes?limit=${limit}`);
  return data.inboxes ?? [];
}

export async function createAgentMailInbox(input?: {
  displayName?: string;
  username?: string;
  clientId?: string;
}): Promise<AgentMailInbox> {
  return agentMailFetch<AgentMailInbox>("/inboxes", {
    method: "POST",
    body: JSON.stringify({
      display_name: input?.displayName ?? "Nexuses Deliverability Test",
      ...(input?.username ? { username: input.username } : {}),
      ...(input?.clientId ? { client_id: input.clientId } : {}),
      metadata: { purpose: "deliverability_test" },
    }),
  });
}

const DELIVERABILITY_CLIENT_ID = "nxs-deliverability";

/**
 * Free AgentMail plans cap inboxes (often 3). Reuse one dedicated inbox
 * instead of create/delete on every test.
 */
export async function getOrCreateDeliverabilityInbox(): Promise<AgentMailInbox> {
  const existing = await listAgentMailInboxes(50);
  const match =
    existing.find((inbox) => /nxs-deliverability/i.test(inbox.inbox_id)) ||
    existing.find((inbox) => inbox.client_id === DELIVERABILITY_CLIENT_ID) ||
    existing.find((inbox) =>
      String(inbox.display_name ?? "")
        .toLowerCase()
        .includes("deliverability"),
    ) ||
    // Prefer the stable org inbox if present (often cannot be deleted).
    existing.find((inbox) => /nexuses/i.test(inbox.inbox_id));

  if (match) {
    return match;
  }

  try {
    return await createAgentMailInbox({
      displayName: "Nexuses Deliverability",
      username: "nxs-deliverability",
      clientId: DELIVERABILITY_CLIENT_ID,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/limit/i.test(message) && existing[0]) {
      // Plan full — reuse any inbox we already have.
      return existing[0];
    }
    throw error;
  }
}

export async function deleteAgentMailInbox(inboxId: string) {
  try {
    await agentMailFetch<void>(`/inboxes/${encodeURIComponent(inboxId)}`, {
      method: "DELETE",
    });
  } catch {
    // Best-effort cleanup — do not fail the report.
  }
}

export async function listAgentMailMessages(
  inboxId: string,
  options?: {
    limit?: number;
    after?: string;
    includeSpam?: boolean;
    includeUnauthenticated?: boolean;
    includeBlocked?: boolean;
    subject?: string;
  },
) {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 10));
  if (options?.after) {
    params.set("after", options.after);
  }
  if (options?.includeSpam) {
    params.set("include_spam", "true");
  }
  if (options?.includeUnauthenticated) {
    params.set("include_unauthenticated", "true");
  }
  if (options?.includeBlocked) {
    params.set("include_blocked", "true");
  }
  if (options?.subject) {
    params.append("subject", options.subject);
  }

  const data = await agentMailFetch<{
    count: number;
    messages: AgentMailMessageItem[];
  }>(`/inboxes/${encodeURIComponent(inboxId)}/messages?${params.toString()}`);

  return data.messages ?? [];
}

export async function getAgentMailMessage(inboxId: string, messageId: string) {
  return agentMailFetch<AgentMailMessage>(
    `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
  );
}

export async function getAgentMailRawMessage(
  inboxId: string,
  messageId: string,
) {
  const meta = await agentMailFetch<{
    message_id: string;
    size: number;
    download_url: string;
    expires_at: string;
  }>(
    `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/raw`,
  );

  const rawResponse = await fetch(meta.download_url, { cache: "no-store" });
  if (!rawResponse.ok) {
    throw new Error(
      `Could not download raw message (${rawResponse.status})`,
    );
  }

  return {
    messageId: meta.message_id,
    size: meta.size,
    raw: await rawResponse.text(),
  };
}

export async function waitForAgentMailMessage(input: {
  inboxId: string;
  afterIso: string;
  subjectMarker?: string;
  timeoutMs?: number;
  pollMs?: number;
}) {
  const timeoutMs = input.timeoutMs ?? 60_000;
  const pollMs = input.pollMs ?? 2_000;
  const started = Date.now();
  let lastSeenSubjects: string[] = [];

  while (Date.now() - started < timeoutMs) {
    // Do NOT pass `subject` to AgentMail list — with include_* flags the
    // search path often returns 0 even when the message is already there.
    // Match the marker client-side instead.
    const messages = await listAgentMailMessages(input.inboxId, {
      limit: 20,
      after: input.afterIso,
      includeSpam: true,
      includeUnauthenticated: true,
      includeBlocked: true,
    });

    lastSeenSubjects = messages.map((message) => message.subject ?? "(no subject)");

    const match = messages.find((message) => {
      if (!input.subjectMarker) {
        return true;
      }
      return (message.subject ?? "").includes(input.subjectMarker);
    });

    if (match) {
      return match;
    }

    // No subject marker: accept newest message in the after-window.
    if (!input.subjectMarker && messages[0]) {
      return messages[0];
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  const seen =
    lastSeenSubjects.length > 0
      ? ` Inbox currently has: ${lastSeenSubjects.slice(0, 3).join(" | ")}.`
      : " Inbox stayed empty.";

  throw new Error(
    `Timed out waiting for the test email in AgentMail.${seen} If empty, the SMTP send may have been dropped (DMARC quarantine/reject) or delayed.`,
  );
}
