import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  boatRaw,
  countBotComputers,
  forgetBotComputer,
  gtmBotMaxComputers,
  ownsBotComputer,
  projectForRelayToken,
  recordBotComputer,
} from "@/lib/gtm-bot-server";

/**
 * Boat relay for GTM Bot workspaces (OpenMausBot's OMB_CLOUD_BOAT_URL). The workspace sends Boat v1 calls
 * here with its own per-project token; we forward them with our Boat key, but only for computers that
 * this project's bots created, and never more than the project's cap. The workspace's own (home) computer
 * cannot be reached through here.
 */

export const maxDuration = 300;

type Context = { params: Promise<{ path?: string[] }> };

const SANDBOX_ID = /^bx_[a-z0-9]+$/i;
/** Sub-paths of one sandbox the workspace may use, by method. */
const ALLOWED: Record<string, RegExp[]> = {
  GET: [/^$/, /^commands\/\d+$/, /^files$/, /^artifacts$/, /^usage$/],
  POST: [/^resume$/, /^stop$/, /^commands$/, /^desktop$/, /^files\/[a-z-]+$/],
  PATCH: [/^$/],
  DELETE: [/^$/],
};
const deletionOps = new Map<string, string>();

function refuse(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

async function forward(request: NextRequest, path: string, body?: string) {
  const headers: Record<string, string> = {};
  const idempotency = request.headers.get("idempotency-key");
  if (idempotency) headers["Idempotency-Key"] = idempotency;
  const response = await boatRaw(path, {
    method: request.method,
    headers,
    ...(body !== undefined ? { body } : {}),
    signal: AbortSignal.timeout(280_000),
  });
  const data = await response.arrayBuffer();
  return new NextResponse(data, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "application/json" },
  });
}

async function readBody(request: NextRequest) {
  if (request.method === "GET" || request.method === "DELETE") return undefined;
  const text = await request.text();
  return text || undefined;
}

async function handle(request: NextRequest, context: Context) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const projectId = await projectForRelayToken(token).catch(() => null);
  if (!projectId) return refuse(401, "unauthorized", "This workspace is not linked to the portal any more.");

  const segments = (await context.params).path ?? [];
  const search = request.nextUrl.searchParams;
  const method = request.method.toUpperCase();

  // Deletion progress, only for deletions this project started.
  if (segments[0] === "deletion-operations" && segments.length === 2 && method === "GET") {
    if (deletionOps.get(segments[1]) !== projectId.toHexString()) return refuse(404, "not_found", "Not found");
    return forward(request, `/deletion-operations/${encodeURIComponent(segments[1])}`);
  }

  if (segments[0] !== "sandboxes") return refuse(404, "not_found", "Not available for GTM Bot workspaces.");

  // The collection: list this project's bot computers, or create one.
  if (segments.length === 1) {
    if (method === "GET") {
      const query = new URLSearchParams();
      for (const key of ["limit", "cursor", "sort", "state"]) {
        const value = search.get(key);
        if (value) query.set(key, value);
      }
      query.append("label", `gtmProject=${projectId.toHexString()}`);
      query.append("label", "gtmRole=bot");
      return forward(request, `/sandboxes?${query}`);
    }
    if (method === "POST") {
      const cap = gtmBotMaxComputers();
      if ((await countBotComputers(projectId)) >= cap) {
        return refuse(
          403,
          "computer_limit",
          cap === 0
            ? "Extra computers are turned off for this workspace."
            : `This workspace can have ${cap} extra computers. Delete one in the bot's computer panel to make another.`,
        );
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse((await readBody(request)) || "{}") as Record<string, unknown>;
      } catch {
        return refuse(400, "bad_request", "Invalid request body");
      }
      const labels = (parsed.labels && typeof parsed.labels === "object" ? parsed.labels : {}) as Record<string, string>;
      const body = JSON.stringify({
        ...parsed,
        // None of our account's keys may reach a bot's computer, and we must be able to find it again.
        noEnv: true,
        env: undefined,
        environment: undefined,
        labels: { ...labels, gtmProject: projectId.toHexString(), gtmRole: "bot" },
      });
      const response = await forward(request, "/sandboxes", body);
      if (response.ok) {
        const created = (await response.clone().json().catch(() => null)) as
          | { sandbox?: { id?: string; name?: string }; id?: string }
          | null;
        const id = created?.sandbox?.id || created?.id;
        if (id) await recordBotComputer(projectId, id, created?.sandbox?.name);
      }
      return response;
    }
    return refuse(405, "method_not_allowed", "Not allowed");
  }

  const sandboxId = segments[1];
  if (!SANDBOX_ID.test(sandboxId) || !(await ownsBotComputer(projectId as ObjectId, sandboxId))) {
    return refuse(404, "not_found", "No such computer in this workspace.");
  }
  const rest = segments.slice(2).join("/");
  if (!(ALLOWED[method] ?? []).some((pattern) => pattern.test(rest))) {
    return refuse(403, "not_allowed", "Not allowed for GTM Bot workspaces.");
  }

  let body = await readBody(request);
  if (method === "PATCH") {
    // Only the auto-stop timer and the name; never labels, environment or ownership.
    const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
    body = JSON.stringify({
      ...(parsed.ttlSeconds !== undefined ? { ttlSeconds: parsed.ttlSeconds } : {}),
      ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
    });
  }
  const query = search.toString();
  const path = `/sandboxes/${encodeURIComponent(sandboxId)}${rest ? `/${rest}` : ""}${query ? `?${query}` : ""}`;
  const response = await forward(request, path, body);

  if (method === "DELETE" && (response.ok || response.status === 404 || response.status === 410)) {
    await forgetBotComputer(sandboxId);
    const result = (await response.clone().json().catch(() => null)) as { operation?: { id?: string } } | null;
    if (result?.operation?.id) deletionOps.set(result.operation.id, projectId.toHexString());
  }
  return response;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
