import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { projectForMcpToken } from "@/lib/ai-bots-server";
import { runInApiCredit } from "@/lib/api-credits-server";
import { ASSISTANT_TOOLS, runAssistantTool } from "@/lib/assistant-tools-server";
import { getDb } from "@/lib/mongodb";
import { composioExtraTools, runComposioTool } from "@/lib/composio-server";

/**
 * The portal's read-only tools as an MCP server (streamable HTTP, JSON replies) for AI bots that run on a
 * project computer. The token in the path is per project and per computer; it is registered on that
 * computer when a bot first works there.
 */

export const maxDuration = 120;

type Params = { params: Promise<{ token: string }> };
type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

// The computer tools would let a bot drive computers from inside a computer; leave them out.
const TOOLS = ASSISTANT_TOOLS.filter((tool) => !tool.function.name.startsWith("boat_"));
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

function result(id: RpcRequest["id"], value: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result: value };
}

function failure(id: RpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function projectName(projectId: ObjectId) {
  const db = await getDb();
  const project = await db.collection<{ _id: ObjectId; name?: string }>("projects").findOne({ _id: projectId });
  return project?.name || "Project";
}

async function handle(rpc: RpcRequest, projectId: ObjectId) {
  switch (rpc.method) {
    case "initialize": {
      const asked = String(rpc.params?.protocolVersion ?? "");
      return result(rpc.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "nexuses-portal", version: "1.0.0" },
        instructions: "Read this project's portal data: contacts, lists, companies, campaigns, analytics, replies, knowledge base, people search and web search.",
      });
    }
    case "ping":
      return result(rpc.id, {});
    case "tools/list": {
      // Connected apps (Composio) come through here too, so the Composio key never reaches a computer.
      const apps = await composioExtraTools(projectId).catch(() => null);
      return result(rpc.id, {
        tools: [...TOOLS, ...(apps?.tools ?? [])].map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          inputSchema: tool.function.parameters,
        })),
      });
    }
    case "tools/call": {
      const name = String(rpc.params?.name ?? "");
      const args = (rpc.params?.arguments && typeof rpc.params.arguments === "object" ? rpc.params.arguments : {}) as Record<string, unknown>;
      if (name.startsWith("COMPOSIO_")) {
        try {
          const output = await runComposioTool(projectId, name, args);
          return result(rpc.id, { content: [{ type: "text", text: JSON.stringify(output).slice(0, 60_000) }], isError: false });
        } catch (error) {
          return result(rpc.id, {
            content: [{ type: "text", text: error instanceof Error ? error.message : "App tool failed" }],
            isError: true,
          });
        }
      }
      if (!TOOLS.some((tool) => tool.function.name === name)) return failure(rpc.id, -32602, `Unknown tool: ${name}`);
      try {
        const output = await runInApiCredit(projectId.toHexString(), "assistant", async () =>
          runAssistantTool({ projectId, projectName: await projectName(projectId), userName: "AI bot" }, name, args),
        );
        return result(rpc.id, {
          content: [{ type: "text", text: JSON.stringify(output.output).slice(0, 60_000) }],
          isError: false,
        });
      } catch (error) {
        return result(rpc.id, {
          content: [{ type: "text", text: error instanceof Error ? error.message : "Tool failed" }],
          isError: true,
        });
      }
    }
    default:
      return failure(rpc.id, -32601, `Method not found: ${rpc.method}`);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { token } = await params;
  const projectId = await projectForMcpToken(token).catch(() => null);
  if (!projectId) return NextResponse.json(failure(null, -32001, "Unauthorized"), { status: 401 });
  const body = (await request.json().catch(() => null)) as RpcRequest | RpcRequest[] | null;
  if (!body) return NextResponse.json(failure(null, -32700, "Parse error"), { status: 400 });

  const list = Array.isArray(body) ? body : [body];
  // Notifications (no id) need no answer.
  const calls = list.filter((rpc) => rpc.id !== undefined && rpc.id !== null);
  if (!calls.length) return new NextResponse(null, { status: 202 });
  const answers = await Promise.all(calls.map((rpc) => handle(rpc, projectId)));
  return NextResponse.json(Array.isArray(body) ? answers : answers[0]);
}

export async function GET() {
  // No server-to-client stream; clients fall back to plain POST.
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 204 });
}
