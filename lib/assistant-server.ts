import { ObjectId } from "mongodb";
import { CSV_MARKER, UPLOAD_MARKER, type AssistantCard } from "@/lib/assistant";
import { PITCH_RESEARCH_MARKER } from "@/lib/pitch-research";
import {
  ASSISTANT_TOOLS,
  runAssistantTool,
  type AssistantToolContext,
} from "@/lib/assistant-tools-server";
import { PORTAL_ROUTES } from "@/lib/portal-nav";

export type AssistantMessage = { role: "user" | "assistant"; content: string };

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type Provider = { name: "openai" | "deepseek"; url: string; key: string; model: string };

const MAX_TOOL_ROUNDS = 5;
const MAX_TOOL_RESULT_CHARS = 24_000;

function systemPrompt(projectName: string, userName: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are the Nexuses Portal assistant for the project "${projectName}". You are talking to ${userName || "a portal user"}. Today is ${today}.

The portal has:
- CRM: Contacts (${PORTAL_ROUTES.contacts}), Lists (${PORTAL_ROUTES.lists}), Companies (${PORTAL_ROUTES.companies}), Enrich (${PORTAL_ROUTES.enrich}).
- Marketing: Drip campaigns (${PORTAL_ROUTES.drip}) for bulk emails, 1-1 campaigns (${PORTAL_ROUTES.oneone}) for personal sequences sent from Gmail or Outlook, Personalise campaigns (${PORTAL_ROUTES.personalise}) built from an uploaded doc or sheet with a unique email per contact, Automation (${PORTAL_ROUTES.automation}), EDM generator (${PORTAL_ROUTES.edm}) for designing HTML emails with AI.
- Analytics (${PORTAL_ROUTES.analytics}) and Kanban boards (${PORTAL_ROUTES["analytics-kanban"]}) that sort contacts into stages by sent, open, click and reply.
- SMTP senders (${PORTAL_ROUTES.smtp}), Master inbox (${PORTAL_ROUTES.inbox}) with campaign replies and AI reply drafts, Suppression list (${PORTAL_ROUTES.unsub}), Integrations (${PORTAL_ROUTES.integrations}).
- Drip campaigns cannot send from Gmail. 1-1 and Personalise send from Gmail or Outlook only. Clicks from link scanners and opens within the first seconds after sending are filtered out of reports.

Rules:
- Use the tools to get real numbers. Never invent data. If a tool returns nothing, say so.
- For date questions ("this month", "last week") work out exact YYYY-MM-DD dates from today.
- You can only read data. If the user asks you to change something (send, pause, delete, create, edit), explain the steps briefly and link the page where they can do it.
- Answer in clean GitHub Markdown:
  - Start with the direct answer in one or two sentences.
  - For section titles use "### Title" headings, never a bare line of text or a bold line ending in a colon.
  - Lists always use "- " bullets (or "1. " for steps), one item per line, with a blank line before the list.
  - Use **bold** only for key numbers or names, and always close every ** pair on the same line.
  - Use a table when comparing campaigns, periods or 3+ items with the same fields (keep to the useful columns, include a header row).
  - End with at most one short follow-up suggestion line, not a list of offers.
- CSV downloads: you may offer "Would you like this as a CSV?" after a table. When the user accepts (e.g. "yes") or asks to export/download data, reply with one short sentence, then the data as a single complete table (all rows, one header row, plain numbers without commas), and put ${CSV_MARKER} alone on the last line. The chat turns that marker into a Download CSV button. Never use the marker otherwise, and never claim you attached or emailed a file.
- File uploads: the chat can upload a file (image, PDF, doc, etc.) to the project's S3 bucket and return a public link. When the user wants to upload a file, host an image, or get an S3/CDN link, reply with one short sentence telling them to choose the file and then pick a bucket, and put ${UPLOAD_MARKER} alone on the last line. The chat turns it into an Upload file button. Users can also use the paperclip button in the message box. Never use the marker otherwise.
- People/lead data requests ("find CTOs in Saudi Arabia", "get me HR managers at banks in Dubai"): call search_people with structured filters. Put roles in jobTitles (add managementLevels only when the user names a seniority), places in locations, sectors in industries, and specific named companies only in companyNames. If it returns 0, try once more with broader filters (fewer titles, the country instead of a city, or lookup_filter_values for exact spellings). The chat shows the result as a card with the filters, match count, sample people and an Open in Enrich button, so your reply must be only one or two plain sentences: the match count and what was searched, then that they can open it in Enrich to review, remove unsubscribed/existing contacts and save to a list. No headings, lists or tables, and do not repeat the filters or sample people. Only set filters the user asked for.
- Web search: you can search the live web with web_search. Use it for anything not in the portal's data, such as a company's website, what a company does, recent news, a person's role, competitors, market or industry facts. Never say you cannot browse the web. Answer briefly from the result and end with a "Sources:" line of up to 3 Markdown links from the tool's sources, separated by " · ". If the search finds nothing reliable, say so.
- Custom pitch research ("research these companies", "create pitches for my company list", "find the right people at these accounts and write a pitch"): the portal researches each company with Grok, finds the right decision makers, writes a tailored pitch per person using the project's Knowledge Base, checks people against the Data Portal and returns everything with sources and an Excel export. If the user typed the company names in the chat, call start_pitch_research with those names and what they want to pitch (as focus), then reply in one or two plain sentences. If they have a list or file of companies (or did not name any), reply with one short sentence asking them to upload the list (CSV, Excel or text, one company per row or a Company column, up to 25 companies) and mention they can say what to pitch, and put ${PITCH_RESEARCH_MARKER} alone on the last line. The chat turns that marker into an Upload company list button. Never use the marker otherwise. Only use pitch research when the user wants pitches, outreach or decision makers for a set of companies; for a simple question about one company (website, what they do, news) use web_search instead. If research cannot start because no research key is set, say an admin needs to add it.
- Link portal pages and campaigns with Markdown links using the paths from tool results, e.g. [Campaign name](/portal/marketing/campaigns/123).
- Keep answers short and practical. No filler.`;
}

function providers(): Provider[] {
  const list: Provider[] = [];
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

async function complete(provider: Provider, messages: ChatMessage[]) {
  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      tools: ASSISTANT_TOOLS,
      ...(provider.name === "openai"
        ? { reasoning_effort: "low", max_completion_tokens: 6000 }
        : { temperature: 0.3, max_tokens: 3000 }),
    }),
  });
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
  } | null;
  if (!response.ok) {
    throw new Error(data?.error?.message || `${provider.name} request failed (${response.status})`);
  }
  const message = data?.choices?.[0]?.message;
  if (!message) {
    throw new Error(`${provider.name} returned no answer`);
  }
  return message;
}

async function converse(provider: Provider, context: AssistantToolContext, messages: ChatMessage[]) {
  const thread = [...messages];
  const cards: AssistantCard[] = [];
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const message = await complete(provider, thread);
    const calls = message.tool_calls ?? [];
    if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
      const content = String(message.content ?? "").trim();
      if (!content) {
        throw new Error("The assistant returned an empty answer");
      }
      // Only the latest card of each kind is shown; earlier ones were retries.
      const latest = cards.filter(
        (card, index) => !cards.slice(index + 1).some((later) => later.kind === card.kind),
      );
      return { content, cards: latest };
    }
    thread.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
    const results = await Promise.all(
      calls.map(async (call) => {
        let output: unknown;
        try {
          const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          const result = await runAssistantTool(context, call.function.name, args);
          output = result.output;
          if (result.card) {
            cards.push(result.card);
          }
        } catch (error) {
          output = { error: error instanceof Error ? error.message : "Lookup failed" };
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

export async function askPortalAssistant(input: {
  projectId: ObjectId;
  projectName: string;
  userName: string;
  history: AssistantMessage[];
}) {
  const available = providers();
  if (available.length === 0) {
    throw new Error("Set OPENAI_API_KEY or DEEPSEEK_API_KEY to use the assistant.");
  }
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(input.projectName, input.userName) },
    ...input.history.slice(-12).map((item) => ({
      role: item.role,
      content: item.content.slice(0, 4000),
    })),
  ];

  let lastError: unknown;
  for (const provider of available) {
    try {
      return await converse(
        provider,
        { projectId: input.projectId, projectName: input.projectName, userName: input.userName },
        messages,
      );
    } catch (error) {
      lastError = error;
      console.warn(
        `[assistant] ${provider.name} failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The assistant is unavailable");
}
