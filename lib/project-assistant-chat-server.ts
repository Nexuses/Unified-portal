import { ObjectId } from "mongodb";
import { askPortalAssistant, type AssistantMessage } from "@/lib/assistant-server";
import {
  callConnectedApi,
  listProjectAssistantIntegrationDocs,
  listProjectAssistantIntegrations,
} from "@/lib/project-assistant-server";
import {
  extractPresentedForm,
  PROJECT_ACTION_TOOLS,
  runProjectActionTool,
} from "@/lib/project-assistant-actions-server";
import { serializeAgentForm, type AgentForm } from "@/lib/project-assistant-form";
import { ASSISTANT_TOOLS, runAssistantTool } from "@/lib/assistant-tools-server";
import { noteApiUsage, guardApiCredit } from "@/lib/api-credits-server";
import { claudeApiKey, claudeModel } from "@/lib/claude";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type Provider = {
  name: "claude" | "openai" | "deepseek";
  url: string;
  key: string;
  model: string;
};

const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_RESULT_CHARS = 24_000;

const EXTRA_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_connected_tools",
      description:
        "List tools connected to this project's AI Assistant (HubSpot, Attio, Brevo, Lemlist, custom APIs).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "connected_api_request",
      description:
        "Call a connected tool's HTTP API to read or transfer data (HubSpot contacts, Attio records, Brevo, custom APIs). Use list_connected_tools first to get integrationId.",
      parameters: {
        type: "object",
        properties: {
          integrationId: { type: "string" },
          method: {
            type: "string",
            enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          },
          path: {
            type: "string",
            description: "Path or full URL, e.g. /crm/v3/objects/contacts",
          },
          body: { description: "JSON body for write methods" },
          query: {
            type: "object",
            additionalProperties: { type: "string" },
          },
        },
        required: ["integrationId", "path"],
        additionalProperties: false,
      },
    },
  },
  ...PROJECT_ACTION_TOOLS,
];

function providers(): Provider[] {
  const list: Provider[] = [];
  const claudeKey = claudeApiKey();
  if (claudeKey) {
    list.push({
      name: "claude",
      url: "https://api.anthropic.com/v1/messages",
      key: claudeKey,
      model: claudeModel(),
    });
  }
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) {
    list.push({
      name: "openai",
      url: "https://api.openai.com/v1/chat/completions",
      key: openAiKey,
      model: process.env.OPENAI_ASSISTANT_MODEL?.trim() || "gpt-5-mini",
    });
  }
  const deepSeekKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (deepSeekKey) {
    list.push({
      name: "deepseek",
      url: "https://api.deepseek.com/chat/completions",
      key: deepSeekKey,
      model: "deepseek-chat",
    });
  }
  return list;
}

function systemPrompt(
  projectName: string,
  userName: string,
  connectedSummary: string,
) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are the Project AI Assistant for "${projectName}" in the Nexuses Unified Portal. You are talking to ${userName || "a portal user"}. Today is ${today}.

You are a full project agent: the user can do dashboard work in chat — campaigns, senders, lists, launch/schedule, analytics, CRM, inbox, and connected tools (HubSpot, Attio, Brevo, Lemlist, custom APIs).

Connected tools right now:
${connectedSummary}

## Voice & formatting
- Sound calm, precise, and professional — like a senior ops teammate, not a chatbot.
- Keep replies short: 1–3 sentences of context, then the action (form or result).
- Prefer bold for names/emails and backticks for hosts/ids. No filler, no hype.
- When collecting credentials or multi-field setup, **never** ask the user to paste everything in free chat. Call a form tool instead.

## Inline forms (required for inputs)
- Adding a sender → call **request_sender_form** with provider + from_email as soon as you know them.
- Other multi-field needs (campaign subject/body, schedule time, missing setup) → call **present_input_form**.
- After a form tool succeeds, write a brief confirmation only. Do **not** repeat the fields as a bullet list — the UI renders inputs under your message.
- When the user message starts with “Submitted …”, treat those values as answers and call the matching write tool (e.g. add_sender, update_campaign_setup).

## Campaign & sender workflows
1. Clarify kind if needed: drip vs oneone.
2. create_campaign for a new draft, or use an existing name/id.
3. get_campaign_setup_checklist; collect missing pieces via present_input_form.
4. list_senders / list_contact_lists to choose; new sender → request_sender_form → add_sender. Never invent secrets.
5. update_campaign_setup with provided values.
6. Confirm before launch_campaign (now vs later).
7. Summarize results with the campaign link.

## Other rules
- Use portal read tools freely. Use list_connected_tools / connected_api_request for external APIs.
- Never invent tool results. If something fails, explain clearly how to fix it.
- If HubSpot (etc.) is not connected, point them to Connect tools.
- Answer in clean GitHub Markdown.`;
}

async function runProjectTool(
  projectId: ObjectId,
  projectName: string,
  userName: string,
  userId: ObjectId | null,
  name: string,
  args: Record<string, unknown>,
) {
  if (name === "list_connected_tools") {
    const items = await listProjectAssistantIntegrations(projectId);
    return {
      output: {
        count: items.length,
        tools: items.map((item) => ({
          integrationId: item.id,
          provider: item.provider,
          name: item.name,
          baseUrl: item.baseUrl,
          authType: item.authType,
          keyHint: item.keyHint,
        })),
      },
    };
  }
  if (name === "connected_api_request") {
    const integrationId = String(args.integrationId || "").trim();
    const path = String(args.path || "").trim();
    const method = String(args.method || "GET").toUpperCase();
    const query =
      args.query && typeof args.query === "object" && !Array.isArray(args.query)
        ? Object.fromEntries(
            Object.entries(args.query as Record<string, unknown>).map(([key, value]) => [
              key,
              String(value ?? ""),
            ]),
          )
        : undefined;
    return {
      output: await callConnectedApi({
        projectId,
        integrationId,
        method,
        path,
        body: args.body,
        query,
      }),
    };
  }
  const action = await runProjectActionTool(
    { projectId, userId },
    name,
    args,
  );
  if (action.handled) {
    return { output: action.output };
  }
  return runAssistantTool(
    { projectId, projectName, userName },
    name,
    args,
  );
}

async function completeWithClaude(provider: Provider, messages: ChatMessage[]) {
  await guardApiCredit();
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => String(message.content ?? ""))
    .join("\n\n");
  const tools = [...ASSISTANT_TOOLS, ...EXTRA_TOOLS];
  type AnthropicBlock =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    | { type: "tool_result"; tool_use_id: string; content: string };

  const converted: Array<{ role: "user" | "assistant"; content: string | AnthropicBlock[] }> =
    [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      const block: AnthropicBlock = {
        type: "tool_result",
        tool_use_id: message.tool_call_id || "",
        content: String(message.content ?? ""),
      };
      const last = converted[converted.length - 1];
      if (last?.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        converted.push({ role: "user", content: [block] });
      }
      continue;
    }
    if (message.role === "assistant" && message.tool_calls?.length) {
      const blocks: AnthropicBlock[] = [];
      if (message.content) {
        blocks.push({ type: "text", text: message.content });
      }
      for (const call of message.tool_calls) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: call.function.arguments
            ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
            : {},
        });
      }
      converted.push({ role: "assistant", content: blocks });
      continue;
    }
    converted.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content ?? ""),
    });
  }

  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      "x-api-key": provider.key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 6000,
      ...(system ? { system } : {}),
      messages: converted,
      tools: tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      })),
    }),
  });
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string } | null;
    content?: Array<{
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  } | null;
  if (!response.ok) {
    throw new Error(data?.error?.message || `claude request failed (${response.status})`);
  }
  const blocks = data?.content ?? [];
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
  const toolCalls = blocks
    .filter((block) => block.type === "tool_use" && block.name)
    .map((block, index) => ({
      id: block.id || `claude-tool-${index}`,
      type: "function" as const,
      function: {
        name: String(block.name),
        arguments: JSON.stringify(block.input ?? {}),
      },
    }));
  await noteApiUsage({
    provider: "claude",
    model: provider.model,
    inputTokens: data?.usage?.input_tokens,
    outputTokens: data?.usage?.output_tokens,
  });
  return {
    content: text || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

async function completeOpenAiCompatible(provider: Provider, messages: ChatMessage[]) {
  await guardApiCredit();
  const tools = [...ASSISTANT_TOOLS, ...EXTRA_TOOLS];
  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      tools,
      ...(provider.name === "openai"
        ? { reasoning_effort: "low", max_completion_tokens: 6000 }
        : { temperature: 0.3, max_tokens: 3000 }),
    }),
  });
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: ChatMessage["tool_calls"];
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;
  if (!response.ok) {
    throw new Error(data?.error?.message || `${provider.name} request failed`);
  }
  const message = data?.choices?.[0]?.message;
  if (!message) {
    throw new Error(`${provider.name} returned no answer`);
  }
  await noteApiUsage({
    provider: provider.name,
    model: provider.model,
    inputTokens: data?.usage?.prompt_tokens,
    outputTokens: data?.usage?.completion_tokens,
  });
  return message;
}

async function converse(
  provider: Provider,
  projectId: ObjectId,
  projectName: string,
  userName: string,
  userId: ObjectId | null,
  messages: ChatMessage[],
) {
  const thread = [...messages];
  const presentedForms: AgentForm[] = [];
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const message =
      provider.name === "claude"
        ? await completeWithClaude(provider, thread)
        : await completeOpenAiCompatible(provider, thread);
    const calls = message.tool_calls ?? [];
    if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
      const pendingForm = presentedForms[presentedForms.length - 1] ?? null;
      let content = String(message.content ?? "").trim();
      if (!content && pendingForm) {
        content = pendingForm.description
          ? `${pendingForm.title}. ${pendingForm.description}`
          : pendingForm.title;
      }
      if (!content) {
        throw new Error("The assistant returned an empty answer");
      }
      if (pendingForm && !content.includes("```agent-form")) {
        content = `${content}${serializeAgentForm(pendingForm)}`;
      }
      return content;
    }
    thread.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: calls,
    });
    const results = await Promise.all(
      calls.map(async (call) => {
        let output: unknown;
        try {
          const args = call.function.arguments
            ? JSON.parse(call.function.arguments)
            : {};
          const result = await runProjectTool(
            projectId,
            projectName,
            userName,
            userId,
            call.function.name,
            args,
          );
          output = result.output;
          const form = extractPresentedForm(output);
          if (form) {
            presentedForms.push(form);
          }
        } catch (error) {
          output = {
            error: error instanceof Error ? error.message : "Tool failed",
          };
        }
        return {
          role: "tool" as const,
          tool_call_id: call.id,
          content: JSON.stringify(output).slice(0, MAX_TOOL_RESULT_CHARS),
        };
      }),
    );
    thread.push(...results);
  }
  throw new Error("The assistant could not finish the answer");
}

export async function askProjectAssistant(input: {
  projectId: ObjectId;
  projectName: string;
  userName: string;
  userId?: string | null;
  history: AssistantMessage[];
}) {
  const available = providers();
  if (available.length === 0) {
    // Fall back to portal assistant if somehow no keys — still try askPortalAssistant
    const result = await askPortalAssistant(input);
    return result.content;
  }

  const docs = await listProjectAssistantIntegrationDocs(input.projectId);
  const connectedSummary = docs.length
    ? docs
        .map(
          (item) =>
            `- ${item.name} (${item.provider}) id=${item._id.toString()} base=${item.baseUrl} auth=${item.authType}`,
        )
        .join("\n")
    : "- None yet. Ask the user to open Connect tools and add HubSpot or another API.";

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt(input.projectName, input.userName, connectedSummary),
    },
    ...input.history.slice(-16).map((item) => ({
      role: item.role,
      content: item.content.slice(0, 6000),
    })),
  ];

  const userId =
    input.userId && ObjectId.isValid(input.userId)
      ? new ObjectId(input.userId)
      : null;

  let lastError: unknown;
  for (const provider of available) {
    try {
      return await converse(
        provider,
        input.projectId,
        input.projectName,
        input.userName,
        userId,
        messages,
      );
    } catch (error) {
      lastError = error;
      console.warn(
        `[project-assistant] ${provider.name} failed: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("The project assistant is unavailable");
}
