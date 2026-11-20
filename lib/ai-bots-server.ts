import { createHash, randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { runInApiCredit } from "@/lib/api-credits-server";
import { askPortalAssistant, type AssistantExtraTools } from "@/lib/assistant-server";
import {
  BoatError,
  boatConfigured,
  boatFetch,
  ensureProjectBoat,
  getBoatSandbox,
  getSavedBoatSandboxId,
  isBoatRunning,
  openBoatDesktop,
  runBoatCommand,
  shellQuote,
  stampBoatActivity,
  stopBoatSandbox,
  stopProjectBoat,
  waitForBoat,
} from "@/lib/boat";
import type { AssistantCard } from "@/lib/assistant";
import { composioExtraTools, hasConnectedApps, mergeExtraTools } from "@/lib/composio-server";
import {
  BOT_COLORS,
  BOT_ENGINES,
  type Bot,
  type BotComputerInfo,
  type BotEngine,
  type BotFile,
  type BotMessage,
} from "@/lib/ai-bots";

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

type BotDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  name: string;
  color: string;
  emoji: string;
  instructions: string;
  engine: BotEngine;
  model: string;
  ownComputer: boolean;
  pinned: boolean;
  isChief: boolean;
  /** The bot's own computer, when ownComputer is on. */
  sandboxId?: string;
  /** Boat agent conversation (its memory) and the computer it lives on. */
  conversationId?: string | null;
  conversationSandboxId?: string | null;
  conversationEngine?: BotEngine | null;
  lastMessageAt?: Date | null;
  lastPreview?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
};

type MessageDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  botId: ObjectId;
  role: "user" | "bot";
  content: string;
  status: "done" | "running" | "error";
  authorName: string;
  authorId?: string;
  source?: "routine" | "handoff";
  cards?: AssistantCard[];
  files?: BotFile[];
  error?: string;
  engine?: BotEngine;
  sandboxId?: string;
  promptId?: string;
  conversationId?: string | null;
  startedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

type ReadDoc = { projectId: ObjectId; userId: string; botId: ObjectId; readAt: Date };

type McpTokenDoc = {
  projectId: ObjectId;
  sandboxId: string;
  tokenHash: string;
  version: number;
  createdAt: Date;
};

let indexed = false;

export async function botCollections() {
  const db = await getDb();
  const bots = db.collection<BotDoc>("ai_bots");
  const messages = db.collection<MessageDoc>("ai_bot_messages");
  const reads = db.collection<ReadDoc>("ai_bot_reads");
  const mcpTokens = db.collection<McpTokenDoc>("ai_bot_mcp_tokens");
  if (!indexed) {
    await Promise.all([
      bots.createIndex({ projectId: 1, deletedAt: 1 }),
      messages.createIndex({ botId: 1, createdAt: -1 }),
      messages.createIndex({ status: 1, updatedAt: 1 }),
      reads.createIndex({ userId: 1, botId: 1 }, { unique: true }),
      mcpTokens.createIndex({ tokenHash: 1 }, { unique: true }),
      mcpTokens.createIndex({ projectId: 1, sandboxId: 1 }),
    ]);
    indexed = true;
  }
  return { bots, messages, reads, mcpTokens };
}

const ENGINES = Object.keys(BOT_ENGINES) as BotEngine[];
const RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MCP_VERSION = 1;

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function preview(text: string) {
  return text
    .replace(/[#*`>|_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function toBot(doc: BotDoc, unread = 0, running = false): Bot {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    color: doc.color,
    emoji: doc.emoji,
    instructions: doc.instructions,
    engine: doc.engine,
    model: doc.model,
    ownComputer: doc.ownComputer,
    pinned: doc.pinned,
    isChief: doc.isChief,
    createdAt: doc.createdAt.toISOString(),
    lastMessageAt: doc.lastMessageAt?.toISOString() ?? null,
    lastPreview: doc.lastPreview ?? "",
    unread,
    running,
  };
}

function toMessage(doc: MessageDoc): BotMessage {
  return {
    id: doc._id.toHexString(),
    role: doc.role,
    content: doc.content,
    status: doc.status,
    authorName: doc.authorName,
    ...(doc.source ? { source: doc.source } : {}),
    ...(doc.cards?.length ? { cards: doc.cards } : {}),
    ...(doc.files?.length ? { files: doc.files } : {}),
    ...(doc.error ? { error: doc.error } : {}),
    createdAt: doc.createdAt.toISOString(),
  };
}

const CHIEF_INSTRUCTIONS = `You are the Chief of Staff for this project's team of AI bots. You answer portal questions yourself, and you set up and brief the other bots.
- When the user wants a specialist (a researcher, a prospector, an email writer, an analyst), create it with create_bot, with clear instructions, and tell the user it is in the bot list.
- When work fits another bot better, hand it over with message_bot and say who is on it. Bots on a computer (ChatGPT, Grok, Claude) are best for long research, browsing and building files such as CSV or Excel sheets.
- Keep your own answers short.`;

async function seedChief(projectId: ObjectId) {
  const { bots } = await botCollections();
  const now = new Date();
  await bots.updateOne(
    { projectId, isChief: true, deletedAt: null },
    {
      $setOnInsert: {
        projectId,
        name: "Chief of Staff",
        color: "#8b5cf6",
        emoji: "",
        instructions: CHIEF_INSTRUCTIONS,
        engine: "portal",
        model: "",
        ownComputer: false,
        pinned: true,
        isChief: true,
        createdAt: now,
        updatedAt: now,
        lastMessageAt: null,
        lastPreview: "",
        deletedAt: null,
      },
    },
    { upsert: true },
  );
}

export async function listBots(projectId: ObjectId, userId: string): Promise<Bot[]> {
  await seedChief(projectId);
  const { bots, messages, reads } = await botCollections();
  const docs = await bots.find({ projectId, deletedAt: null }).toArray();
  const readDocs = await reads.find({ projectId, userId }).toArray();
  const readAt = new Map(readDocs.map((doc) => [doc.botId.toHexString(), doc.readAt]));
  const running = new Set(
    (await messages.distinct("botId", { projectId, status: "running" })).map((id) => String(id)),
  );
  const list = await Promise.all(
    docs.map(async (doc) => {
      const since = readAt.get(doc._id.toHexString()) ?? new Date(0);
      const unread = doc.lastMessageAt && doc.lastMessageAt > since
        ? await messages.countDocuments({ botId: doc._id, role: "bot", status: { $ne: "running" }, createdAt: { $gt: since } })
        : 0;
      return toBot(doc, Math.min(unread, 99), running.has(doc._id.toHexString()));
    }),
  );
  return list.sort((a, b) => {
    if (a.isChief !== b.isChief) return a.isChief ? -1 : 1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt);
  });
}

async function getBotDoc(projectId: ObjectId, botId: string) {
  if (!ObjectId.isValid(botId)) return null;
  const { bots } = await botCollections();
  return bots.findOne({ _id: new ObjectId(botId), projectId, deletedAt: null });
}

function readDraft(input: Record<string, unknown>, current?: BotDoc) {
  const engine = ENGINES.includes(input.engine as BotEngine) ? (input.engine as BotEngine) : current?.engine ?? "portal";
  const color = BOT_COLORS.includes(input.color as (typeof BOT_COLORS)[number])
    ? (input.color as string)
    : current?.color ?? BOT_COLORS[Math.floor(Math.random() * BOT_COLORS.length)];
  const emoji = input.emoji === undefined ? current?.emoji ?? "" : [...cleanText(input.emoji, 16)].slice(0, 2).join("");
  return {
    name: cleanText(input.name, 40) || current?.name || "New bot",
    color,
    emoji,
    instructions: input.instructions === undefined ? current?.instructions ?? "" : cleanText(input.instructions, 6000),
    engine,
    model: input.model === undefined && current?.engine === engine ? current.model : cleanText(input.model, 60),
    ownComputer: input.ownComputer === undefined ? current?.ownComputer ?? false : input.ownComputer === true,
    pinned: input.pinned === undefined ? current?.pinned ?? false : input.pinned === true,
  };
}

export async function createBot(projectId: ObjectId, input: Record<string, unknown>) {
  const { bots } = await botCollections();
  const source = typeof input.duplicateOf === "string" ? await getBotDoc(projectId, input.duplicateOf) : null;
  if ((await bots.countDocuments({ projectId, deletedAt: null })) >= 50) {
    throw new Error("A project can have up to 50 bots.");
  }
  const base = source
    ? { ...readDraft({}, source), name: `${source.name} copy`.slice(0, 40), pinned: false }
    : readDraft(input);
  const now = new Date();
  const doc: BotDoc = {
    _id: new ObjectId(),
    projectId,
    ...base,
    isChief: false,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: null,
    lastPreview: "",
    deletedAt: null,
  };
  await bots.insertOne(doc);
  return toBot(doc);
}

export async function updateBot(projectId: ObjectId, botId: string, input: Record<string, unknown>) {
  const current = await getBotDoc(projectId, botId);
  if (!current) throw new Error("Bot not found");
  const next = readDraft(input, current);
  const { bots } = await botCollections();
  const brainChanged = next.engine !== current.engine || next.ownComputer !== current.ownComputer;
  await bots.updateOne(
    { _id: current._id },
    {
      $set: {
        ...next,
        updatedAt: new Date(),
        // A new brain or computer starts a fresh agent conversation (memory is per harness and computer).
        ...(brainChanged ? { conversationId: null, conversationSandboxId: null, conversationEngine: null } : {}),
      },
    },
  );
  return toBot({ ...current, ...next });
}

export async function deleteBot(projectId: ObjectId, botId: string) {
  const current = await getBotDoc(projectId, botId);
  if (!current) throw new Error("Bot not found");
  if (current.isChief) throw new Error("The Chief of Staff can't be deleted.");
  const { bots } = await botCollections();
  await bots.updateOne({ _id: current._id }, { $set: { deletedAt: new Date(), updatedAt: new Date() } });
  if (current.sandboxId) await stopBoatSandbox(current.sandboxId).catch(() => undefined);
}

export async function listMessages(projectId: ObjectId, botId: string, userId: string) {
  const bot = await getBotDoc(projectId, botId);
  if (!bot) throw new Error("Bot not found");
  await refreshRunning(projectId, bot._id).catch((error) => console.warn("[bots] refresh failed", error));
  const { messages, reads } = await botCollections();
  const docs = await messages.find({ botId: bot._id }).sort({ createdAt: -1 }).limit(120).toArray();
  await reads.updateOne(
    { userId, botId: bot._id },
    { $set: { projectId, readAt: new Date() } },
    { upsert: true },
  );
  return docs.reverse().map(toMessage);
}

export async function clearMessages(projectId: ObjectId, botId: string) {
  const bot = await getBotDoc(projectId, botId);
  if (!bot) throw new Error("Bot not found");
  const { messages, bots } = await botCollections();
  await messages.deleteMany({ botId: bot._id });
  await bots.updateOne(
    { _id: bot._id },
    { $set: { lastPreview: "", lastMessageAt: null, conversationId: null, conversationSandboxId: null, updatedAt: new Date() } },
  );
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

type Sender = { id?: string; name: string; source?: "routine" | "handoff" };

/**
 * Posts a message to a bot and starts its reply in the background. Returns at once; the reply message is
 * "running" until the brain finishes (the page polls).
 */
export async function sendToBot(
  projectId: ObjectId,
  projectName: string,
  botId: string,
  content: string,
  sender: Sender,
) {
  const bot = await getBotDoc(projectId, botId);
  if (!bot) throw new Error("Bot not found");
  const text = cleanText(content, 8000);
  if (!text) throw new Error("Write a message first");
  const { messages, bots } = await botCollections();
  if (await messages.findOne({ botId: bot._id, status: "running" })) {
    throw new Error(`${bot.name} is still working on the last message.`);
  }
  const now = new Date();
  const userMessage: MessageDoc = {
    _id: new ObjectId(),
    projectId,
    botId: bot._id,
    role: "user",
    content: text,
    status: "done",
    authorName: sender.name,
    ...(sender.id ? { authorId: sender.id } : {}),
    ...(sender.source ? { source: sender.source } : {}),
    createdAt: now,
    updatedAt: now,
  };
  const reply: MessageDoc = {
    _id: new ObjectId(),
    projectId,
    botId: bot._id,
    role: "bot",
    content: "",
    status: "running",
    authorName: bot.name,
    engine: bot.engine,
    startedAt: now,
    createdAt: new Date(now.getTime() + 1),
    updatedAt: now,
  };
  await messages.insertMany([userMessage, reply]);
  await bots.updateOne(
    { _id: bot._id },
    { $set: { lastMessageAt: now, lastPreview: preview(`${sender.name}: ${text}`), updatedAt: now } },
  );

  const work = BOT_ENGINES[bot.engine].runsOnComputer
    ? startComputerTurn(projectId, projectName, bot, reply, text, sender)
    : runPortalTurn(projectId, projectName, bot, reply, sender);
  void work.catch((error) => finishWithError(reply._id, bot, error));
  return toMessage(userMessage);
}

async function finishWithError(replyId: ObjectId, bot: BotDoc, error: unknown) {
  const message = error instanceof Error ? error.message : "The bot could not answer.";
  console.warn(`[bots] ${bot.name} failed:`, message);
  const { messages, bots } = await botCollections();
  await messages.updateOne(
    { _id: replyId, status: "running" },
    { $set: { status: "error", error: message, updatedAt: new Date() } },
  );
  await bots.updateOne({ _id: bot._id }, { $set: { lastMessageAt: new Date(), lastPreview: preview(`Error: ${message}`) } });
}

async function finishReply(replyId: ObjectId, bot: BotDoc, content: string, extra: Partial<MessageDoc> = {}) {
  const { messages, bots } = await botCollections();
  const now = new Date();
  await messages.updateOne(
    { _id: replyId, status: "running" },
    { $set: { status: "done", content, updatedAt: now, ...extra } },
  );
  await bots.updateOne(
    { _id: bot._id },
    { $set: { lastMessageAt: now, lastPreview: preview(content), updatedAt: now } },
  );
}

/* ---- Portal brain (portal assistant on API keys) ---- */

async function runPortalTurn(projectId: ObjectId, projectName: string, bot: BotDoc, reply: MessageDoc, sender: Sender) {
  const { messages } = await botCollections();
  const history = (
    await messages
      .find({ botId: bot._id, status: "done", _id: { $ne: reply._id } })
      .sort({ createdAt: -1 })
      .limit(14)
      .toArray()
  )
    .reverse()
    .filter((doc) => doc.content.trim())
    .map((doc) => ({
      role: doc.role === "user" ? ("user" as const) : ("assistant" as const),
      content: doc.role === "user" && doc.authorName ? `${doc.source ? `[${doc.authorName}] ` : ""}${doc.content}` : doc.content,
    }));
  if (!history.length || history[history.length - 1].role !== "user") {
    throw new Error("Nothing to answer");
  }
  const apps = await composioExtraTools(projectId).catch(() => null);
  const extraTools = mergeExtraTools(bot.isChief ? chiefTools(projectId, projectName, bot) : null, apps);
  const answer = await runInApiCredit(projectId.toHexString(), "assistant", () =>
    askPortalAssistant({
      projectId,
      projectName,
      userName: sender.name,
      history,
      persona: { name: bot.name, instructions: bot.instructions },
      ...(extraTools ? { extraTools } : {}),
    }),
  );
  await finishReply(reply._id, bot, answer.content, answer.cards.length ? { cards: answer.cards } : {});
}

/** Tools only the Chief of Staff has: see, create and brief the other bots. */
function chiefTools(projectId: ObjectId, projectName: string, chief: BotDoc): AssistantExtraTools {
  return {
    tools: [
      {
        type: "function",
        function: {
          name: "list_bots",
          description: "The project's AI bots: name, brain (portal, chatgpt, grok, claude), whether they are busy, and their instructions.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
      {
        type: "function",
        function: {
          name: "create_bot",
          description:
            "Create a new AI bot for the user. engine: portal (fast, portal data only), chatgpt, grok or claude (agents on a cloud computer with a browser, best for long research and building files).",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "Short name, e.g. Researcher" },
              instructions: { type: "string", description: "Its role, what it should do and how to answer" },
              engine: { type: "string", enum: ENGINES },
              emoji: { type: "string", description: "One emoji for its avatar" },
            },
            required: ["name", "instructions", "engine"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "message_bot",
          description: "Hand a task to another bot. It starts working in its own chat; the user sees the reply there.",
          parameters: {
            type: "object",
            properties: {
              bot: { type: "string", description: "The bot's name" },
              message: { type: "string", description: "The full task, with everything the bot needs" },
            },
            required: ["bot", "message"],
            additionalProperties: false,
          },
        },
      },
    ],
    run: async (name, args) => {
      const { bots, messages } = await botCollections();
      if (name === "list_bots") {
        const docs = await bots.find({ projectId, deletedAt: null }).toArray();
        const busy = new Set((await messages.distinct("botId", { projectId, status: "running" })).map(String));
        return docs.map((doc) => ({
          name: doc.name,
          engine: doc.engine,
          busy: busy.has(doc._id.toHexString()),
          instructions: doc.instructions.slice(0, 300),
        }));
      }
      if (name === "create_bot") {
        const bot = await createBot(projectId, { ...args, ownComputer: false });
        return { created: bot.name, engine: bot.engine, where: "It is now in the bot list on the left of the chat window." };
      }
      if (name === "message_bot") {
        const wanted = cleanText(args.bot, 40).toLowerCase();
        const docs = await bots.find({ projectId, deletedAt: null, isChief: false }).toArray();
        const target = docs.find((doc) => doc.name.toLowerCase() === wanted) || docs.find((doc) => doc.name.toLowerCase().includes(wanted));
        if (!target) return { error: `No bot called "${args.bot}". Use list_bots or create_bot first.` };
        await sendToBot(projectId, projectName, target._id.toHexString(), cleanText(args.message, 8000), {
          name: chief.name,
          source: "handoff",
        });
        return { handedOffTo: target.name, where: `The reply shows in ${target.name}'s chat in the bot list.` };
      }
      return { error: "Unknown tool" };
    },
  };
}

/* ---- Computer brains (coding agents on Boat, company subscriptions) ---- */

const HARNESS: Record<Exclude<BotEngine, "portal">, { provider: string; defaultModel?: string }> = {
  chatgpt: { provider: "codex" },
  grok: { provider: "opencode", defaultModel: "grok-4.7" },
  claude: { provider: "claude" },
};

function outputsDir(bot: BotDoc) {
  return `/home/user/outputs/${bot._id.toHexString()}`;
}

function computerPreface(bot: BotDoc, projectName: string, toolsOn: boolean, appsOn: boolean) {
  return [
    `You are "${bot.name}", an AI bot for the project "${projectName}" in the Nexuses portal. People talk to you in a chat app.`,
    bot.instructions.trim() ? `Your role and personality, set by the user:\n${bot.instructions.trim()}` : "",
    "How you work:",
    toolsOn
      ? "- The portal's data (contacts, lists, companies, campaigns, analytics, inbox replies, knowledge base, people search, web search) is in the MCP tools of the server named \"portal\". Use them for anything about this project instead of guessing."
      : "",
    toolsOn && appsOn
      ? "- The project's connected apps (HubSpot, Apollo, Notion, Gmail and others) are reachable through the same \"portal\" server: call COMPOSIO_SEARCH_TOOLS first, then COMPOSIO_MULTI_EXECUTE_TOOL."
      : "",
    `- You run on a Linux computer with a browser and a desktop. Keep working files in ~/work/${bot._id.toHexString()}/.`,
    `- Save every file the user should get (CSV, XLSX, PDF, Markdown) in ${outputsDir(bot)}/ and mention each by file name. Those files are attached to your reply automatically.`,
    "- Reply in short GitHub Markdown. Never paste secrets or keys.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function startComputerTurn(
  projectId: ObjectId,
  projectName: string,
  bot: BotDoc,
  reply: MessageDoc,
  text: string,
  sender: Sender,
) {
  if (!boatConfigured()) throw new Error("Cloud computers aren't set up. An admin needs to add BOAT_API_KEY.");
  const harness = HARNESS[bot.engine as Exclude<BotEngine, "portal">];
  const sandbox = await ensureBotComputer(projectId, bot);
  const toolsOn = await ensurePortalTools(projectId, sandbox.id).catch((error) => {
    console.warn("[bots] portal tools not registered:", error instanceof Error ? error.message : error);
    return false;
  });
  await runBoatCommand(sandbox.id, `mkdir -p ${shellQuote(outputsDir(bot))} ~/work/${bot._id.toHexString()}`, 20).catch(
    () => undefined,
  );

  const sameConversation =
    bot.conversationId && bot.conversationSandboxId === sandbox.id && bot.conversationEngine === bot.engine;
  const from = sender.source ? `${sender.name} (${sender.source === "routine" ? "scheduled task" : "hand-off"})` : sender.name;
  const prompt = sameConversation
    ? `Message from ${from}:\n${text}`
    : `${computerPreface(bot, projectName, toolsOn, toolsOn && (await hasConnectedApps(projectId)))}\n\nMessage from ${from}:\n${text}`;

  const model = bot.model || harness.defaultModel;
  const queue = async (conversationId: string | null) =>
    (await boatFetch(`/sandboxes/${encodeURIComponent(sandbox.id)}/prompt`, {
      method: "POST",
      body: JSON.stringify({
        provider: harness.provider,
        prompt,
        ...(model ? { model } : {}),
        ...(conversationId ? { conversationId } : { new: true }),
      }),
    })) as Record<string, unknown>;

  let data: Record<string, unknown>;
  try {
    data = await queue(sameConversation ? bot.conversationId ?? null : null);
  } catch (error) {
    if (sameConversation && error instanceof BoatError && error.status === 404) {
      data = await queue(null);
    } else if (
      error instanceof BoatError &&
      (error.code === "provider_not_configured" || /needs one of|agents page|no credential/i.test(error.message))
    ) {
      throw new Error(
        `${BOT_ENGINES[bot.engine].label} isn't signed in for the company yet. An admin signs in once on the Boat dashboard under Agents & Proxying.`,
      );
    } else {
      throw error;
    }
  }
  const run = (data.promptRun && typeof data.promptRun === "object" ? data.promptRun : data) as Record<string, unknown>;
  const promptId = String(run.promptId || data.promptId || run.id || "");
  const conversationId = String(run.conversationId || data.conversationId || "") || null;
  if (!promptId) throw new Error("The computer did not accept the task.");

  const { messages, bots } = await botCollections();
  await messages.updateOne(
    { _id: reply._id },
    { $set: { sandboxId: sandbox.id, promptId, conversationId, updatedAt: new Date() } },
  );
  await bots.updateOne(
    { _id: bot._id },
    { $set: { conversationId, conversationSandboxId: sandbox.id, conversationEngine: bot.engine } },
  );
}

type BoatEvent = { type?: string; conversationId?: string; data?: Record<string, unknown> };

/** Reads the agent's final answer, or its error, from the conversation's events. */
async function readOutcome(sandboxId: string, conversationId: string | null) {
  const params = new URLSearchParams({ sort: "asc" });
  if (conversationId) params.set("conversation", conversationId);
  const data = (await boatFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/events?${params}`)) as Record<string, unknown>;
  const events = (Array.isArray(data.events) ? data.events : Array.isArray(data.items) ? data.items : []) as BoatEvent[];
  let lastPrompt = -1;
  events.forEach((event, index) => {
    if (event.type === "prompt") lastPrompt = index;
  });
  const promptEvent = lastPrompt >= 0 ? events[lastPrompt] : undefined;
  let answer = "";
  for (const event of events.slice(lastPrompt + 1)) {
    if (event.type !== "response" || !event.data) continue;
    const content = typeof event.data.content === "string" ? event.data.content.trim() : "";
    if (content && event.data.is_streaming !== true) answer = content;
  }
  const error = typeof promptEvent?.data?.error === "string" ? promptEvent.data.error : "";
  return { answer, error };
}

async function listNewFiles(sandboxId: string, bot: BotDoc, since: Date): Promise<BotFile[]> {
  const epoch = Math.floor(since.getTime() / 1000) - 5;
  const result = await runBoatCommand(
    sandboxId,
    `find ${shellQuote(outputsDir(bot))} -type f -newermt @${epoch} -printf '%s\\t%p\\n' 2>/dev/null | head -40`,
    20,
  );
  return result.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((parts) => parts.length === 2 && parts[1].startsWith(`${outputsDir(bot)}/`))
    .map(([size, path]) => ({ path, name: path.split("/").pop() || path, size: Number(size) || 0 }));
}

/** Brings running computer replies up to date (called when a chat is opened or polled, and by the worker). */
export async function refreshRunning(projectId: ObjectId, botId?: ObjectId) {
  const { messages, bots } = await botCollections();
  const running = await messages
    .find({ projectId, status: "running", ...(botId ? { botId } : {}), promptId: { $exists: true } })
    .limit(10)
    .toArray();
  for (const message of running) {
    const bot = await bots.findOne({ _id: message.botId });
    if (!bot || !message.sandboxId || !message.promptId) continue;
    try {
      const data = (await boatFetch(
        `/sandboxes/${encodeURIComponent(message.sandboxId)}/prompts/${encodeURIComponent(message.promptId)}`,
      )) as Record<string, unknown>;
      const run = (data.promptRun && typeof data.promptRun === "object" ? data.promptRun : data) as Record<string, unknown>;
      const status = String(run.status || data.status || "");
      const done = run.done === true || data.done === true;
      if (!done) {
        if (message.startedAt && Date.now() - message.startedAt.getTime() > RUN_TIMEOUT_MS) {
          await finishWithError(message._id, bot, new Error("The task ran for over two hours and was stopped."));
        } else if (!bot.ownComputer) {
          await stampBoatActivity(projectId).catch(() => undefined);
        }
        continue;
      }
      const outcome = await readOutcome(message.sandboxId, message.conversationId ?? null);
      const files = await listNewFiles(message.sandboxId, bot, message.startedAt ?? message.createdAt).catch(() => []);
      if (status === "failed" || (!outcome.answer && outcome.error)) {
        const friendly = /no (openai|anthropic|xai)? ?key|no credential|provider_not_configured/i.test(outcome.error)
          ? `${BOT_ENGINES[bot.engine].label} isn't signed in for the company yet. An admin signs in once on the Boat dashboard under Agents & Proxying.`
          : outcome.error || "The task failed on the computer.";
        await finishWithError(message._id, bot, new Error(friendly));
        continue;
      }
      // Boat can report "finished" when the agent only got an API error back; show that as an error.
      if (/^API Error: \d{3}/.test(outcome.answer)) {
        await finishWithError(message._id, bot, new Error(outcome.answer.slice(0, 400)));
        continue;
      }
      await finishReply(message._id, bot, outcome.answer || (files.length ? "Done. The files are attached." : "Done."), {
        ...(files.length ? { files } : {}),
      });
    } catch (error) {
      if (error instanceof BoatError && (error.status === 404 || error.status === 410)) {
        await finishWithError(message._id, bot, new Error("The computer lost this task. Send it again."));
      } else {
        console.warn("[bots] refresh failed:", error instanceof Error ? error.message : error);
      }
    }
  }
}

/* ---- Computers ---- */

async function ensureOwnComputer(projectId: ObjectId, bot: BotDoc) {
  const { bots } = await botCollections();
  if (bot.sandboxId) {
    try {
      const current = await getBoatSandbox(bot.sandboxId);
      if (!isBoatRunning(current.state)) {
        if (current.state === "cancelled" || current.state === "deleted") throw new BoatError("removed", 404, "not_found");
        await boatFetch(`/sandboxes/${encodeURIComponent(bot.sandboxId)}/resume`, { method: "POST", body: "{}" });
      }
      const ready = await waitForBoat(bot.sandboxId, 45, 120_000);
      if (isBoatRunning(ready.state)) return ready;
      throw new BoatError(`The computer is ${ready.state}. Try again in a minute.`, 409, "not_ready");
    } catch (error) {
      if (!(error instanceof BoatError) || (error.status !== 404 && error.status !== 410)) throw error;
    }
  }
  const data = (await boatFetch("/sandboxes", {
    method: "POST",
    body: JSON.stringify({
      type: "default",
      ttlSeconds: 3600,
      labels: { aiBotProject: projectId.toHexString(), aiBot: bot._id.toHexString() },
    }),
  })) as Record<string, unknown>;
  const created = (data.sandbox ?? data) as { id?: string };
  if (!created.id) throw new Error("Boat did not return a computer.");
  await bots.updateOne({ _id: bot._id }, { $set: { sandboxId: created.id } });
  bot.sandboxId = created.id;
  const ready = await waitForBoat(created.id, 45, 120_000);
  if (!isBoatRunning(ready.state)) throw new BoatError(`The new computer is ${ready.state}.`, 409, "not_ready");
  return ready;
}

async function ensureBotComputer(projectId: ObjectId, bot: BotDoc) {
  if (bot.ownComputer) return ensureOwnComputer(projectId, bot);
  const sandbox = await ensureProjectBoat(projectId);
  if (!isBoatRunning(sandbox.state)) {
    const ready = await waitForBoat(sandbox.id, 45, 120_000);
    if (!isBoatRunning(ready.state)) throw new BoatError(`The computer is ${ready.state}. Try again in a minute.`, 409, "not_ready");
    return ready;
  }
  return sandbox;
}

export async function botComputer(
  projectId: ObjectId,
  botId: string,
  action: "status" | "start" | "desktop" | "stop",
): Promise<BotComputerInfo> {
  const bot = await getBotDoc(projectId, botId);
  if (!bot) throw new Error("Bot not found");
  if (!boatConfigured()) throw new Error("Cloud computers aren't set up. An admin needs to add BOAT_API_KEY.");
  const shared = !bot.ownComputer;
  if (action === "stop") {
    if (shared) await stopProjectBoat(projectId);
    else if (bot.sandboxId) await stopBoatSandbox(bot.sandboxId);
    return { sandboxId: shared ? null : bot.sandboxId ?? null, state: "stopping", running: false, shared };
  }
  if (action === "status") {
    const id = shared ? await getSavedBoatSandboxId(projectId) : bot.sandboxId ?? null;
    if (!id) return { sandboxId: null, state: "none", running: false, shared };
    const sandbox = await getBoatSandbox(id).catch(() => null);
    return { sandboxId: id, state: sandbox?.state ?? "unknown", running: sandbox ? isBoatRunning(sandbox.state) : false, shared };
  }
  const sandbox = await ensureBotComputer(projectId, bot);
  const info: BotComputerInfo = { sandboxId: sandbox.id, state: sandbox.state, running: true, shared };
  if (action === "desktop") info.desktopUrl = await openBoatDesktop(sandbox.id);
  return info;
}

/** Reads one output file of a bot (only from its outputs folder). */
export async function readBotFile(projectId: ObjectId, botId: string, path: string) {
  const bot = await getBotDoc(projectId, botId);
  if (!bot) throw new Error("Bot not found");
  if (!path.startsWith(`${outputsDir(bot)}/`) || path.includes("..")) throw new Error("Not a file of this bot");
  const { messages } = await botCollections();
  const owner = await messages.findOne({ botId: bot._id, "files.path": path }, { sort: { createdAt: -1 } });
  if (!owner?.sandboxId) throw new Error("File not found");
  const sandbox = await getBoatSandbox(owner.sandboxId);
  if (!isBoatRunning(sandbox.state)) {
    throw new BoatError("The bot's computer is asleep. Start it from the computer panel, then download again.", 409, "asleep");
  }
  const data = (await boatFetch(
    `/sandboxes/${encodeURIComponent(owner.sandboxId)}/files?path=${encodeURIComponent(path)}&encoding=base64`,
  )) as { content?: string };
  return { name: path.split("/").pop() || "file", bytes: Buffer.from(data.content ?? "", "base64") };
}

/* ------------------------------------------------------------------ */
/* Portal tools for computer bots (an MCP server in the portal)        */
/* ------------------------------------------------------------------ */

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Public https origin the computers can reach. Null in local dev. */
function portalOrigin() {
  const base = (process.env.AI_BOTS_PUBLIC_ORIGIN || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "")
    .trim()
    .replace(/\/+$/, "");
  return /^https:\/\//.test(base) ? base : null;
}

export async function projectForMcpToken(token: string) {
  if (!token || token.length < 20) return null;
  const { mcpTokens } = await botCollections();
  const doc = await mcpTokens.findOne({ tokenHash: hashToken(token) });
  return doc?.projectId ?? null;
}

/** Registers the portal's MCP server in every harness on this computer, once per computer. */
async function ensurePortalTools(projectId: ObjectId, sandboxId: string) {
  const origin = portalOrigin();
  if (!origin) return false;
  const { mcpTokens } = await botCollections();
  const existing = await mcpTokens.findOne({ projectId, sandboxId, version: MCP_VERSION });
  if (existing) return true;
  const token = randomBytes(32).toString("base64url");
  const url = `${origin}/api/bots/mcp/${token}`;
  const quoted = shellQuote(url);
  const result = await runBoatCommand(
    sandboxId,
    [
      'export PATH="$HOME/.local/bin:$PATH"',
      "codex mcp remove portal >/dev/null 2>&1; codex mcp add portal --url " + quoted + " >/dev/null 2>&1 || true",
      "claude mcp remove --scope user portal >/dev/null 2>&1; claude mcp add --scope user --transport http portal " + quoted + " >/dev/null 2>&1 || true",
      // OpenCode keeps MCP servers in its JSON config.
      `node -e 'const f=process.env.HOME+"/.config/opencode/opencode.json";const fs=require("fs");let c={};try{c=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}c.mcp=c.mcp||{};c.mcp.portal={type:"remote",url:process.argv[1],enabled:true};fs.mkdirSync(require("path").dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(c,null,2))' ${quoted}`,
      "echo REGISTERED",
    ].join("\n"),
    60,
  );
  if (!result.stdout.includes("REGISTERED")) return false;
  await mcpTokens.deleteMany({ projectId, sandboxId });
  await mcpTokens.insertOne({ projectId, sandboxId, tokenHash: hashToken(token), version: MCP_VERSION, createdAt: new Date() });
  return true;
}
