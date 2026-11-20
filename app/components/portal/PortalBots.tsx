"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Components } from "react-markdown";
import PortalPeopleSearchCard from "@/app/components/portal/PortalPeopleSearchCard";
import PortalPitchResearchCard from "@/app/components/portal/PortalPitchResearchCard";
import { AssistantMarkdownBody, AssistantMarkdownTable } from "@/app/components/portal/PortalAssistant";
import { useConfirmDialog } from "@/app/components/portal/useConfirmDialog";
import {
  BOT_COLORS,
  BOT_ENGINES,
  BOT_MODELS,
  botComputer,
  botFileUrl,
  clearBotChat,
  connectApp,
  createBot,
  deleteBot,
  disconnectApp,
  fetchApps,
  fetchLogins,
  loginAction,
  deleteRoutine,
  fetchBotMessages,
  fetchBots,
  fetchRoutines,
  modelLabel,
  runRoutineNow,
  saveRoutine,
  sendBotMessage,
  updateBot,
  type Bot,
  type BotComputerInfo,
  type BotDraft,
  type BotEngine,
  type BotMessage,
  type BotRoutine,
  type AiLogin,
  type AiLoginProvider,
  type ConnectedApp,
} from "@/lib/ai-bots";
import styles from "./PortalBots.module.css";

export { styles as botStyles };

type Panel = "profile" | "computer" | "tasks" | null;

const TEMPLATES: Array<{ name: string; emoji: string; engine: BotEngine; instructions: string }> = [
  {
    name: "Researcher",
    emoji: "🔎",
    engine: "grok",
    instructions:
      "You research companies and markets for our go-to-market team. Find facts with sources, size the market, list competitors and recent news. Give short summaries and save longer findings as a Markdown or CSV file.",
  },
  {
    name: "Prospector",
    emoji: "🎯",
    engine: "chatgpt",
    instructions:
      "You build lead lists. Given a target (industry, region, company size, roles), find matching companies and decision makers, and return a CSV with company, website, person, title, LinkedIn URL and why they fit. Check the portal's contacts so we don't add people we already have.",
  },
  {
    name: "Writer",
    emoji: "✍️",
    engine: "portal",
    instructions:
      "You write outbound emails: short first lines, subject lines and follow-ups in our brand's voice, based on the knowledge base. Give 2–3 options and keep each email under 120 words.",
  },
  {
    name: "Analyst",
    emoji: "📊",
    engine: "portal",
    instructions:
      "You read our campaign analytics, replies and pipeline and explain what is working, what is not, and what to try next. Lead with the numbers.",
  },
];

export function BotAvatar({ bot, size = 40 }: { bot: Pick<Bot, "name" | "color" | "emoji">; size?: number }) {
  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: Math.round(size * (bot.emoji ? 0.5 : 0.42)), background: bot.color }}
      aria-hidden="true"
    >
      {bot.emoji || bot.name.trim().charAt(0).toUpperCase() || "B"}
    </span>
  );
}

function timeLabel(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (days < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Typing() {
  return (
    <span className={styles.typing} aria-label="Working">
      <i />
      <i />
      <i />
    </span>
  );
}

export function BotIcon({ name }: { name: "plus" | "search" | "computer" | "task" | "edit" | "chevron" | "close" | "send" | "file" | "pin" | "back" | "calendar" | "apps" | "expand" | "shrink" | "key" | "copy" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "plus":
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "search":
      return <svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
    case "computer":
      return <svg {...common}><rect x="3.5" y="4.5" width="17" height="11.5" rx="2" /><path d="M9 20h6M12 16v4" /></svg>;
    case "task":
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "edit":
      return <svg {...common} width={15} height={15}><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>;
    case "chevron":
      return <svg {...common} width={14} height={14}><path d="m6 9 6 6 6-6" /></svg>;
    case "close":
      return <svg {...common}><path d="M6 6l12 12M18 6 6 18" /></svg>;
    case "send":
      return <svg {...common}><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
    case "file":
      return <svg {...common} width={16} height={16}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>;
    case "pin":
      return <svg {...common} width={13} height={13}><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" /></svg>;
    case "back":
      return <svg {...common}><path d="m15 6-6 6 6 6" /></svg>;
    case "calendar":
      return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>;
    case "expand":
      return <svg {...common}><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></svg>;
    case "shrink":
      return <svg {...common}><path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7" /></svg>;
    case "key":
      return <svg {...common}><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 8.7-8.7M16 7l3 3M14 9l2 2" /></svg>;
    case "copy":
      return <svg {...common} width={15} height={15}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>;
    case "apps":
      return <svg {...common}><path d="M10 4h4v3a2 2 0 1 0 4 0V4h2v6h-3a2 2 0 1 0 0 4h3v6h-6v-3a2 2 0 1 0-4 0v3H4v-6h3a2 2 0 1 0 0-4H4V4z" /></svg>;
  }
}

/* ------------------------------------------------------------------ */

function ModelPicker({ bot, onPick, disabled }: { bot: Bot; onPick: (engine: BotEngine, model: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const engines = Object.keys(BOT_ENGINES) as BotEngine[];
  return (
    <div className={styles.pickerWrap} ref={ref}>
      <button type="button" className={styles.pill} onClick={() => setOpen((value) => !value)} disabled={disabled} aria-expanded={open}>
        <span className={styles.engineTag}>{BOT_ENGINES[bot.engine].short}</span>
        {modelLabel(bot.engine, bot.model)}
        <BotIcon name="chevron" />
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          {engines.map((engine) => (
            <div key={engine} className={styles.menuGroup}>
              <div className={styles.menuGroupHead}>
                <strong>{BOT_ENGINES[engine].label}</strong>
                <span>{BOT_ENGINES[engine].blurb}</span>
              </div>
              {BOT_MODELS.filter((option) => option.engine === engine).map((option) => {
                const active = bot.engine === engine && bot.model === option.model;
                return (
                  <button
                    key={`${engine}-${option.model}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={`${styles.menuItem} ${active ? styles.menuItemActive : ""}`}
                    onClick={() => {
                      setOpen(false);
                      if (!active) onPick(engine, option.model);
                    }}
                  >
                    <span>{option.label}</span>
                    {option.note ? <em>{option.note}</em> : null}
                    {active ? <span className={styles.check}>✓</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ProfilePanel({
  bot,
  onSave,
  onDuplicate,
  onClear,
  onDelete,
}: {
  bot: Bot;
  onSave: (draft: BotDraft) => Promise<void>;
  onDuplicate: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<BotDraft>({});
  const [saving, setSaving] = useState(false);
  const value = { ...bot, ...draft };
  const dirty = Object.keys(draft).some((key) => draft[key as keyof BotDraft] !== bot[key as keyof Bot]);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
      setDraft({});
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.panelBody}>
      <div className={styles.profileHero}>
        <BotAvatar bot={value} size={84} />
      </div>

      <label className={styles.field}>
        <span>Name</span>
        <input value={value.name} maxLength={40} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>

      <div className={styles.field}>
        <span>Color</span>
        <div className={styles.swatches}>
          {BOT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Color ${color}`}
              className={`${styles.swatch} ${value.color === color ? styles.swatchOn : ""}`}
              style={{ background: color }}
              onClick={() => setDraft({ ...draft, color })}
            />
          ))}
        </div>
      </div>

      <label className={styles.field}>
        <span>Emoji (optional)</span>
        <input value={value.emoji} maxLength={4} placeholder="Shows the first letter when empty" onChange={(event) => setDraft({ ...draft, emoji: event.target.value })} />
      </label>

      <label className={styles.field}>
        <span>Personality and instructions</span>
        <textarea
          rows={8}
          value={value.instructions}
          placeholder="What this bot does, how it should answer, what to avoid…"
          onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
        />
      </label>

      {BOT_ENGINES[value.engine].runsOnComputer ? (
        <label className={styles.switchRow}>
          <input
            type="checkbox"
            checked={value.ownComputer}
            onChange={(event) => setDraft({ ...draft, ownComputer: event.target.checked })}
          />
          <span className={styles.switch} aria-hidden="true" />
          <span>
            <strong>Own computer</strong>
            <span>Works on a computer of its own instead of the project’s shared one. Good for long or parallel jobs.</span>
          </span>
        </label>
      ) : null}

      <label className={styles.switchRow}>
        <input type="checkbox" checked={value.pinned} onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })} />
        <span className={styles.switch} aria-hidden="true" />
        <span>
          <strong>Pin to top</strong>
          <span>Keeps this bot at the top of the list.</span>
        </span>
      </label>

      <div className={styles.panelActions}>
        <button type="button" className={styles.primaryBtn} disabled={!dirty || saving || !value.name?.trim()} onClick={() => void save()}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className={styles.secondaryBtn} onClick={onDuplicate}>Duplicate</button>
      </div>
      <div className={styles.dangerZone}>
        <button type="button" className={styles.linkBtn} onClick={onClear}>Clear chat</button>
        {!bot.isChief ? (
          <button type="button" className={`${styles.linkBtn} ${styles.danger}`} onClick={onDelete}>Delete bot</button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ComputerPanel({ bot, onDesktop }: { bot: Bot; onDesktop: (url: string) => void }) {
  const [info, setInfo] = useState<BotComputerInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const onComputer = BOT_ENGINES[bot.engine].runsOnComputer;

  const run = useCallback(
    async (action: "status" | "start" | "desktop" | "stop") => {
      setError("");
      if (action !== "status") setBusy(action);
      try {
        const { computer } = await botComputer(bot.id, action);
        setInfo(computer);
        if (action === "desktop" && computer.desktopUrl) onDesktop(computer.desktopUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Computer action failed");
      } finally {
        setBusy(null);
      }
    },
    [bot.id, onDesktop],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void run("status"), 0);
    return () => window.clearTimeout(timer);
  }, [run]);

  return (
    <div className={styles.panelBody}>
      <div className={styles.computerCard}>
        <div className={styles.computerScreen}>
          <BotIcon name="computer" />
        </div>
        <div>
          <strong>{bot.ownComputer ? `${bot.name}’s computer` : "Project computer"}</strong>
          <span className={styles.muted}>
            {info ? (
              <>
                <span className={`${styles.stateDot} ${info.running ? styles.stateLive : ""}`} />
                {info.state === "none" ? "Not created yet" : info.running ? "Running" : "Asleep"}
              </>
            ) : (
              "Checking…"
            )}
          </span>
        </div>
      </div>

      <p className={styles.muted}>
        {onComputer
          ? bot.ownComputer
            ? "This bot has a Linux computer of its own with a browser. It starts when the bot gets work and sleeps when idle."
            : "This bot works on the project’s shared Linux computer with a browser, together with the other computer bots."
          : "Portal AI bots answer from portal data and don’t need a computer. Switch the brain to ChatGPT, Grok or Claude to let this bot use one."}
      </p>

      <div className={styles.panelActions}>
        <button type="button" className={styles.primaryBtn} disabled={busy !== null} onClick={() => void run("desktop")}>
          {busy === "desktop" ? "Opening…" : "Open desktop"}
        </button>
        {info?.running ? (
          <button type="button" className={styles.secondaryBtn} disabled={busy !== null} onClick={() => void run("stop")}>
            {busy === "stop" ? "Stopping…" : "Put to sleep"}
          </button>
        ) : (
          <button type="button" className={styles.secondaryBtn} disabled={busy !== null} onClick={() => void run("start")}>
            {busy === "start" ? "Starting…" : "Start"}
          </button>
        )}
      </div>
      {error ? <p className={styles.errorText}>{error}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const ZONE = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

export function RoutinesPanel({ bots, bot }: { bots: Bot[]; bot: Bot | null }) {
  const [routines, setRoutines] = useState<BotRoutine[] | null>(null);
  const [editing, setEditing] = useState<Partial<BotRoutine> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirmDialog();

  const load = useCallback(
    () =>
      fetchRoutines().then(
        (data) => setRoutines(data.routines),
        (err: unknown) => setError(err instanceof Error ? err.message : "Could not load routines"),
      ),
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visible = (routines ?? []).filter((routine) => !bot || routine.botId === bot.id);
  const botName = (id: string) => bots.find((item) => item.id === id)?.name ?? "Deleted bot";

  async function save() {
    if (!editing?.botId) return;
    setBusy(true);
    setError("");
    try {
      await saveRoutine({ timezone: ZONE, ...editing, botId: editing.botId });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.panelBody}>
      {confirmDialog}
      {editing ? (
        <>
          <label className={styles.field}>
            <span>Bot</span>
            <select value={editing.botId} onChange={(event) => setEditing({ ...editing, botId: event.target.value })}>
              {bots.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Name</span>
            <input value={editing.title ?? ""} placeholder="Morning lead list" onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
          </label>
          <label className={styles.field}>
            <span>What should the bot do?</span>
            <textarea
              rows={6}
              value={editing.prompt ?? ""}
              placeholder="Find 20 new Series A fintech companies in the UAE with their head of growth, as a CSV. Skip anyone already in our contacts."
              onChange={(event) => setEditing({ ...editing, prompt: event.target.value })}
            />
          </label>
          <div className={styles.field}>
            <span>When</span>
            <div className={styles.segmented}>
              <button type="button" className={editing.kind !== "hours" ? styles.segOn : ""} onClick={() => setEditing({ ...editing, kind: "daily" })}>Every day</button>
              <button type="button" className={editing.kind === "hours" ? styles.segOn : ""} onClick={() => setEditing({ ...editing, kind: "hours" })}>Every few hours</button>
            </div>
            {editing.kind === "hours" ? (
              <label className={styles.inline}>
                Every
                <input type="number" min={1} max={168} value={editing.everyHours ?? 24} onChange={(event) => setEditing({ ...editing, everyHours: Number(event.target.value) })} />
                hours
              </label>
            ) : (
              <label className={styles.inline}>
                At
                <input type="time" value={editing.time ?? "09:00"} onChange={(event) => setEditing({ ...editing, time: event.target.value })} />
                <em>{editing.timezone ?? ZONE}</em>
              </label>
            )}
          </div>
          <div className={styles.panelActions}>
            <button type="button" className={styles.primaryBtn} disabled={busy || !editing.prompt?.trim()} onClick={() => void save()}>
              {busy ? "Saving…" : editing.id ? "Save routine" : "Create routine"}
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            className={styles.newRoutine}
            onClick={() => setEditing({ botId: bot?.id ?? bots[0]?.id, kind: "daily", time: "09:00", everyHours: 24, timezone: ZONE, enabled: true })}
          >
            <BotIcon name="plus" /> New routine
          </button>
          {routines === null ? <p className={styles.muted}>Loading…</p> : null}
          {routines !== null && !visible.length ? (
            <p className={styles.muted}>
              No routines yet. A routine gives a bot a task on a schedule, like a fresh lead list every morning. Results land in its chat.
            </p>
          ) : null}
          <ul className={styles.routineList}>
            {visible.map((routine) => (
              <li key={routine.id} className={styles.routine}>
                <div className={styles.routineHead}>
                  <strong>{routine.title}</strong>
                  <label className={styles.miniSwitch}>
                    <input
                      type="checkbox"
                      checked={routine.enabled}
                      onChange={async (event) => {
                        await saveRoutine({ id: routine.id, botId: routine.botId, enabled: event.target.checked }).catch(() => undefined);
                        void load();
                      }}
                    />
                    <span className={styles.switch} aria-hidden="true" />
                  </label>
                </div>
                <span className={styles.muted}>
                  {!bot ? `${botName(routine.botId)} · ` : ""}
                  {routine.kind === "hours" ? `Every ${routine.everyHours} h` : `Daily at ${routine.time}`}
                  {routine.nextRunAt && routine.enabled ? ` · next ${timeLabel(routine.nextRunAt)}` : ""}
                </span>
                <p>{routine.prompt}</p>
                {routine.lastError ? <p className={styles.errorText}>Last run: {routine.lastError}</p> : null}
                <div className={styles.routineActions}>
                  <button type="button" className={styles.linkBtn} onClick={async () => { await runRoutineNow(routine.id).catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not run")); void load(); }}>Run now</button>
                  <button type="button" className={styles.linkBtn} onClick={() => setEditing(routine)}>Edit</button>
                  <button
                    type="button"
                    className={`${styles.linkBtn} ${styles.danger}`}
                    onClick={async () => {
                      if (await confirm(`Delete “${routine.title}”?`, { title: "Delete routine", confirmLabel: "Delete", danger: true })) {
                        await deleteRoutine(routine.id).catch(() => undefined);
                        void load();
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {error ? <p className={styles.errorText}>{error}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function NewBotDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (draft: BotDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<BotDraft>({ name: "", engine: "portal", color: BOT_COLORS[1], emoji: "", instructions: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      await onCreate(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the bot");
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="New bot" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={styles.dialog}>
        <div className={styles.dialogHead}>
          <h2>New bot</h2>
          <button type="button" className={styles.iconBtn} aria-label="Close" onClick={onClose}><BotIcon name="close" /></button>
        </div>
        <p className={styles.muted}>Start from a template or from scratch. You can change everything later.</p>
        <div className={styles.templates}>
          {TEMPLATES.map((template) => (
            <button
              key={template.name}
              type="button"
              className={`${styles.template} ${draft.name === template.name ? styles.templateOn : ""}`}
              onClick={() => setDraft({ ...draft, ...template })}
            >
              <span>{template.emoji}</span>
              <strong>{template.name}</strong>
              <em>{BOT_ENGINES[template.engine].label}</em>
            </button>
          ))}
        </div>
        <div className={styles.dialogGrid}>
          <label className={styles.field}>
            <span>Name</span>
            <input autoFocus value={draft.name} maxLength={40} placeholder="e.g. Researcher" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className={styles.field}>
            <span>Brain</span>
            <select value={draft.engine} onChange={(event) => setDraft({ ...draft, engine: event.target.value as BotEngine, model: "" })}>
              {(Object.keys(BOT_ENGINES) as BotEngine[]).map((engine) => (
                <option key={engine} value={engine}>{BOT_ENGINES[engine].label}</option>
              ))}
            </select>
          </label>
        </div>
        <p className={styles.hint}>{BOT_ENGINES[draft.engine ?? "portal"].blurb}</p>
        <label className={styles.field}>
          <span>Personality and instructions</span>
          <textarea rows={5} value={draft.instructions} placeholder="What should this bot do?" onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} />
        </label>
        {error ? <p className={styles.errorText}>{error}</p> : null}
        <div className={styles.panelActions}>
          <button type="button" className={styles.primaryBtn} disabled={busy || !draft.name?.trim()} onClick={() => void create()}>
            {busy ? "Creating…" : "Create bot"}
          </button>
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Pieces the floating chatbot is built from                           */
/* ------------------------------------------------------------------ */

/** The project's bots, refreshed while the chatbot is open. Late answers never overwrite newer ones. */
export function useBots(active: boolean) {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState("");
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    return fetchBots().then(
      (data) => {
        if (mine === seq.current) {
          setBots(data.bots);
          setError("");
        }
      },
      (err: unknown) => setError(err instanceof Error ? err.message : "Could not load bots"),
    );
  }, []);

  useEffect(() => {
    if (!active) return;
    const first = window.setTimeout(() => void reload(), 0);
    const timer = window.setInterval(() => void reload(), 15000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [active, reload]);

  return { bots, setBots, reload, error };
}

/** MausBot's avatar-only roster: the assistant first, then the bots, then routines and apps. */
export function BotsRail({
  bots,
  active,
  assistant,
  drawer,
  expanded,
  onSelect,
  onNew,
  onDrawer,
  onExpand,
}: {
  bots: Bot[] | null;
  active: string;
  assistant: ReactNode;
  drawer: "accounts" | "routines" | "apps" | null;
  expanded: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDrawer: (drawer: "accounts" | "routines" | "apps") => void;
  onExpand: () => void;
}) {
  return (
    <nav className={styles.rail2} aria-label="Bots">
      <button
        type="button"
        className={`${styles.railBtn} ${active === "assistant" ? styles.railOn : ""}`}
        title="Portal assistant"
        aria-label="Portal assistant"
        aria-current={active === "assistant"}
        onClick={() => onSelect("assistant")}
      >
        {assistant}
      </button>
      <span className={styles.railSep} aria-hidden="true" />
      <div className={styles.railBots}>
        {(bots ?? []).map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.railBtn} ${active === item.id ? styles.railOn : ""}`}
            title={`${item.name} · ${BOT_ENGINES[item.engine].label}`}
            aria-label={item.unread ? `${item.name}, ${item.unread} unread` : item.name}
            aria-current={active === item.id}
            onClick={() => onSelect(item.id)}
          >
            <BotAvatar bot={item} size={38} />
            {item.running ? <span className={styles.railBusy} aria-hidden="true" /> : null}
            {item.unread > 0 && active !== item.id ? <span className={styles.railBadge}>{item.unread}</span> : null}
          </button>
        ))}
        <button type="button" className={`${styles.railBtn} ${styles.railAdd}`} title="New bot" aria-label="New bot" onClick={onNew}>
          <BotIcon name="plus" />
        </button>
      </div>
      <div className={styles.railFoot2}>
        <button
          type="button"
          className={`${styles.railBtn} ${styles.railTool} ${drawer === "accounts" ? styles.railOn : ""}`}
          title="AI accounts (ChatGPT, SuperGrok)"
          aria-label="AI accounts"
          onClick={() => onDrawer("accounts")}
        >
          <BotIcon name="key" />
        </button>
        <button
          type="button"
          className={`${styles.railBtn} ${styles.railTool} ${drawer === "routines" ? styles.railOn : ""}`}
          title="Tasks & routines"
          aria-label="Tasks & routines"
          onClick={() => onDrawer("routines")}
        >
          <BotIcon name="calendar" />
        </button>
        <button
          type="button"
          className={`${styles.railBtn} ${styles.railTool} ${drawer === "apps" ? styles.railOn : ""}`}
          title="Connected apps"
          aria-label="Connected apps"
          onClick={() => onDrawer("apps")}
        >
          <BotIcon name="apps" />
        </button>
        <button
          type="button"
          className={`${styles.railBtn} ${styles.railTool}`}
          title={expanded ? "Smaller window" : "Bigger window"}
          aria-label={expanded ? "Make the window smaller" : "Make the window bigger"}
          aria-pressed={expanded}
          onClick={onExpand}
        >
          <BotIcon name={expanded ? "shrink" : "expand"} />
        </button>
      </div>
    </nav>
  );
}

/** A panel that slides over the right side of the chat window. */
export function BotsDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <aside className={styles.drawer} aria-label={title}>
      <div className={styles.panelHead}>
        <h2>{title}</h2>
        <button type="button" className={styles.iconBtn} aria-label="Close panel" onClick={onClose}>
          <BotIcon name="close" />
        </button>
      </div>
      {children}
    </aside>
  );
}

/** Connected apps (Composio): connect once, and every bot of the project can use the app. */
export function AppsPanel() {
  const [state, setState] = useState<{ configured: boolean; apps: ConnectedApp[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirm, confirmDialog] = useConfirmDialog();

  const load = useCallback(
    () =>
      fetchApps().then(
        (data) => {
          setState(data);
          setError("");
        },
        (err: unknown) => setError(err instanceof Error ? err.message : "Could not load apps"),
      ),
    [],
  );

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    // Coming back from the sign-in tab: show the new connection.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  async function connect(app: ConnectedApp) {
    setBusy(app.slug);
    setError("");
    const tab = window.open("about:blank", "_blank");
    try {
      const { url } = await connectApp(app.slug);
      if (tab) tab.location.assign(url);
      else window.location.assign(url);
    } catch (err) {
      tab?.close();
      setError(err instanceof Error ? err.message : "Could not start the sign-in");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(app: ConnectedApp) {
    if (!app.accountId) return;
    if (!(await confirm(`Disconnect ${app.name}? Bots stop using it until it's connected again.`, { title: "Disconnect app", confirmLabel: "Disconnect", danger: true }))) return;
    setBusy(app.slug);
    try {
      await disconnectApp(app.accountId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.panelBody}>
      {confirmDialog}
      <p className={styles.muted}>Connect an app once and every bot can use it: look up CRM records, add notes, read and draft email, update docs and sheets.</p>
      {state === null && !error ? <p className={styles.muted}>Loading…</p> : null}
      {state && !state.configured ? <p className={styles.muted}>Connected apps aren’t set up on this server yet.</p> : null}
      <ul className={styles.appList}>
        {state?.apps.map((app) => (
          <li key={app.slug} className={styles.app2}>
            {app.logo ? (
              // Logos come from Composio's logo server, which next/image isn't configured for.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={app.logo} alt="" className={styles.appLogo} />
            ) : (
              <span className={styles.appLogo} />
            )}
            <span className={styles.appText}>
              <strong>{app.name}</strong>
              <span>{app.connected ? "Connected" : app.description}</span>
            </span>
            {app.connected ? (
              <button type="button" className={styles.secondaryBtn} disabled={busy !== null} onClick={() => void disconnect(app)}>
                {busy === app.slug ? "…" : "Disconnect"}
              </button>
            ) : (
              <button type="button" className={styles.primaryBtn} disabled={busy !== null} onClick={() => void connect(app)}>
                {busy === app.slug ? "Opening…" : "Connect"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {state?.configured ? <p className={styles.fineprint}>Sign-in happens on Composio’s page in a new tab. Come back here when it’s done.</p> : null}
      {error ? <p className={styles.errorText}>{error}</p> : null}
    </div>
  );
}

const LOGIN_MARK: Record<AiLoginProvider, { short: string; color: string }> = {
  chatgpt: { short: "GPT", color: "#10a37f" },
  grok: { short: "Grok", color: "#111111" },
};

/**
 * AI plan sign-ins: ChatGPT and SuperGrok through their device-code sign-in on the project's computer.
 * Bots on those brains then run on the plan instead of API credits.
 */
export function AccountsPanel() {
  const [state, setState] = useState<{ configured: boolean; logins: AiLogin[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [confirm, confirmDialog] = useConfirmDialog();
  const waiting = Boolean(state?.logins.some((login) => login.state === "pending"));

  const load = useCallback(
    () =>
      fetchLogins().then(
        (data) => {
          setState(data);
          setError("");
        },
        (err: unknown) => setError(err instanceof Error ? err.message : "Could not load sign-ins"),
      ),
    [],
  );

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    // While a code waits for approval, check often so "Connected" shows right after approving.
    const timer = window.setInterval(() => void load(), waiting ? 3000 : 20000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load, waiting]);

  async function act(login: AiLogin, action: "connect" | "cancel" | "disconnect") {
    if (
      action === "disconnect" &&
      !(await confirm(`Sign ${login.label} out of this project's computer? Bots on ${login.label} stop working until someone signs in again.`, {
        title: `Disconnect ${login.label}`,
        confirmLabel: "Disconnect",
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(`${login.provider}:${action}`);
    setError("");
    try {
      const data = await loginAction(login.provider, action);
      setState((current) => ({ configured: current?.configured ?? true, logins: data.logins }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in action failed");
    } finally {
      setBusy(null);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      // Clipboard can be blocked; the code is on screen.
    }
  }

  return (
    <div className={styles.panelBody}>
      {confirmDialog}
      <p className={styles.muted}>
        Sign in with an AI plan so bots run on the subscription instead of API credits. The sign-in stays on this project’s computer and every ChatGPT or Grok bot uses it. We never see your password.
      </p>
      {state === null && !error ? <p className={styles.muted}>Loading…</p> : null}
      {state && !state.configured ? <p className={styles.muted}>Cloud computers aren’t set up on this server yet.</p> : null}
      <ul className={styles.appList}>
        {state?.logins.map((login) => {
          const mark = LOGIN_MARK[login.provider];
          const starting = busy === `${login.provider}:connect`;
          return (
            <li key={login.provider} className={styles.account}>
              <div className={styles.accountHead}>
                <span className={styles.accountMark} style={{ background: mark.color }}>{mark.short}</span>
                <span className={styles.appText}>
                  <strong>{login.label} plan</strong>
                  <span>{login.plan}</span>
                </span>
                {login.state === "connected" ? (
                  <span className={styles.connectedPill}>Connected</span>
                ) : login.state === "pending" ? (
                  <span className={styles.waitingPill}>Waiting</span>
                ) : null}
              </div>

              {login.state === "pending" && login.code && login.url ? (
                <div className={styles.codeBox}>
                  <span className={styles.codeStep}>1. Open the sign-in page and sign in to {login.label}</span>
                  <a className={styles.primaryBtn} href={login.url} target="_blank" rel="noopener noreferrer">
                    Open {login.provider === "grok" ? "accounts.x.ai" : "openai.com"} sign-in
                  </a>
                  <span className={styles.codeStep}>2. Enter this code there</span>
                  <button type="button" className={styles.code} onClick={() => void copy(login.code!)} title="Copy code">
                    <span>{login.code}</span>
                    <BotIcon name="copy" />
                    {copied === login.code ? <em>Copied</em> : null}
                  </button>
                  <span className={styles.working}>
                    <Typing /> Waiting for you to approve…
                  </span>
                  <button type="button" className={styles.linkBtn} disabled={busy !== null} onClick={() => void act(login, "cancel")}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className={styles.accountActions}>
                  {login.state === "connected" ? (
                    <>
                      <span className={styles.muted}>Bots on {login.label} use this plan.</span>
                      <button type="button" className={styles.secondaryBtn} disabled={busy !== null} onClick={() => void act(login, "disconnect")}>
                        {busy === `${login.provider}:disconnect` ? "…" : "Disconnect"}
                      </button>
                    </>
                  ) : (
                    <>
                      {login.state === "error" && login.error ? <span className={styles.errorText}>{login.error}</span> : null}
                      <button type="button" className={styles.primaryBtn} disabled={busy !== null || !state.configured} onClick={() => void act(login, "connect")}>
                        {starting ? "Starting the computer…" : `Connect ${login.label}`}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {state?.configured ? (
        <p className={styles.fineprint}>
          The first sign-in can take up to a minute while the project’s computer starts. The code works for 15 minutes.
        </p>
      ) : null}
      {error ? <p className={styles.errorText}>{error}</p> : null}
    </div>
  );
}

/** One bot's chat: header, messages, message box, and its own drawers (profile, computer, tasks). */
export function BotChat({
  bot,
  bots,
  onBotsChange,
  onSelect,
  onDeleted,
}: {
  bot: Bot;
  bots: Bot[];
  onBotsChange: () => Promise<unknown>;
  onSelect: (id: string) => void;
  onDeleted: () => void;
}) {
  // Messages and the bot they belong to: a slow answer for one bot must never show in another's chat.
  const [chat, setChat] = useState<{ botId: string; list: BotMessage[] } | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [desktopUrl, setDesktopUrl] = useState("");
  const [confirm, confirmDialog] = useConfirmDialog();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const localId = useRef(0);
  const chatSeq = useRef(0);

  const messages = chat && chat.botId === bot.id ? chat.list : null;
  const running = Boolean(messages?.some((message) => message.status === "running"));

  const setMessages = useCallback((id: string, update: (current: BotMessage[]) => BotMessage[]) => {
    chatSeq.current += 1;
    setChat((current) => ({ botId: id, list: update(current?.botId === id ? current.list : []) }));
  }, []);

  const load = useCallback((id: string) => {
    const mine = ++chatSeq.current;
    return fetchBotMessages(id).then(
      (data) => {
        if (mine === chatSeq.current) setChat({ botId: id, list: data.messages });
      },
      (err: unknown) => setError(err instanceof Error ? err.message : "Could not load the chat"),
    );
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(bot.id), 0);
    const timer = window.setInterval(() => void load(bot.id), running ? 2500 : 15000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [bot.id, running, load]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, bot.id]);

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    }
  }, [draft]);

  async function send(text = draft) {
    if (!text.trim() || sending) return;
    setSending(true);
    setError("");
    localId.current += 1;
    const optimistic: BotMessage = {
      id: `local-${localId.current}`,
      role: "user",
      content: text.trim(),
      status: "done",
      authorName: "You",
      createdAt: messages?.[messages.length - 1]?.createdAt ?? "",
    };
    setMessages(bot.id, (current) => [...current, optimistic]);
    setDraft("");
    try {
      const data = await sendBotMessage(bot.id, text);
      setMessages(bot.id, () => data.messages);
      void onBotsChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send");
      setMessages(bot.id, (current) => current.filter((message) => message.id !== optimistic.id));
      setDraft(text);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  async function patchBot(values: BotDraft) {
    try {
      await updateBot(bot.id, values);
      await onBotsChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  const markdown: Components = {
    a: ({ href = "", children }) =>
      href.startsWith("/") ? <Link href={href}>{children}</Link> : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    table: ({ children }) => <AssistantMarkdownTable>{children}</AssistantMarkdownTable>,
  };

  const onComputer = BOT_ENGINES[bot.engine].runsOnComputer;

  return (
    <section className={styles.chat2} aria-label={`Chat with ${bot.name}`}>
      {confirmDialog}
      <header className={styles.chatHead}>
        <button type="button" className={styles.chatTitle} onClick={() => setPanel(panel === "profile" ? null : "profile")}>
          <BotAvatar bot={bot} size={36} />
          <span>
            <strong>{bot.name}</strong>
            <em>{running ? "working…" : onComputer ? (bot.ownComputer ? "own computer" : "project computer") : "portal data"}</em>
          </span>
          <span className={styles.editMark}><BotIcon name="edit" /></span>
        </button>
        <div className={styles.headActions}>
          <button type="button" className={styles.ghostPill} aria-label={`Tasks for ${bot.name}`} onClick={() => setPanel(panel === "tasks" ? null : "tasks")}>
            <BotIcon name="task" /> Task
          </button>
          <ModelPicker bot={bot} onPick={(engine, model) => void patchBot({ engine, model })} disabled={running} />
          <button
            type="button"
            className={`${styles.iconBtn} ${panel === "computer" ? styles.iconOn : ""}`}
            aria-label="Computer"
            title="Computer"
            onClick={() => setPanel(panel === "computer" ? null : "computer")}
          >
            <BotIcon name="computer" />
          </button>
        </div>
      </header>

      <div className={styles.messages} ref={listRef}>
        {messages === null ? <p className={styles.centerNote}>Loading…</p> : null}
        {messages !== null && messages.length === 0 ? (
          <div className={styles.intro}>
            <BotAvatar bot={bot} size={64} />
            <h2>Hey — I’m {bot.name}.</h2>
            <p>
              {bot.isChief
                ? "I run your bot team. Ask me about your portal, or ask me to set up a bot for a job."
                : bot.instructions.slice(0, 200) || BOT_ENGINES[bot.engine].blurb}
            </p>
            <div className={styles.suggestions}>
              {(bot.isChief
                ? ["How did my campaigns do this month?", "Make me a researcher bot for B2B SaaS in the UAE", "What can my bots do?"]
                : onComputer
                  ? ["Find 15 fintech companies in Dubai with their heads of growth, as a CSV", "Research our top competitor's pricing", "What can you do?"]
                  : ["What can you do?", "Summarise our analytics this week", "Write 3 subject lines for our next campaign"]
              ).map((text) => (
                <button key={text} type="button" onClick={() => void send(text)}>{text}</button>
              ))}
            </div>
          </div>
        ) : null}
        {messages?.map((message, index) => {
          const previous = messages[index - 1];
          // A message still being sent has no time yet.
          const newDay =
            Boolean(message.createdAt) &&
            (!previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString());
          return (
            <div key={message.id}>
              {newDay ? <div className={styles.dayChip}>{dayLabel(message.createdAt)}</div> : null}
              {message.role === "user" ? (
                <div className={`${styles.row} ${message.source ? styles.rowIn : styles.rowOut}`}>
                  <div className={`${styles.bubble} ${message.source ? styles.bubbleSystem : styles.bubbleOut}`}>
                    {message.source ? (
                      <span className={styles.sourceTag}>
                        {message.source === "routine" ? `Scheduled · ${message.authorName}` : `From ${message.authorName}`}
                      </span>
                    ) : null}
                    <p className={styles.plain}>{message.content}</p>
                  </div>
                </div>
              ) : (
                <div className={`${styles.row} ${styles.rowIn}`}>
                  <BotAvatar bot={bot} size={28} />
                  <div className={`${styles.bubble} ${styles.bubbleIn} ${message.status === "error" ? styles.bubbleError : ""}`}>
                    {message.status === "running" ? (
                      <span className={styles.working}>
                        <Typing />
                        {onComputer ? "Working on its computer — you can close this window." : "Thinking…"}
                      </span>
                    ) : message.status === "error" ? (
                      <p className={styles.plain}>{message.error || "Something went wrong."}</p>
                    ) : (
                      <div className="pa-md">
                        <AssistantMarkdownBody content={message.content} components={markdown} />
                      </div>
                    )}
                    {message.cards?.map((card, cardIndex) =>
                      card.kind === "pitch-research" ? (
                        <PortalPitchResearchCard key={card.jobId} card={card} />
                      ) : (
                        <PortalPeopleSearchCard key={cardIndex} card={card} onOpen={() => undefined} />
                      ),
                    )}
                    {message.files?.length ? (
                      <div className={styles.files}>
                        {message.files.map((file) => (
                          <a key={file.path} className={styles.fileChip} href={botFileUrl(bot.id, file.path)} download>
                            <BotIcon name="file" />
                            <span>{file.name}</span>
                            <em>{formatBytes(file.size)}</em>
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.composerWrap}>
        {error ? <p className={styles.composerError} role="alert">{error}</p> : null}
        <div className={styles.composer}>
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            placeholder={running ? `${bot.name} is working…` : `Message ${bot.name}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKey}
            disabled={sending}
          />
          <button type="button" className={styles.sendBtn} aria-label="Send" disabled={!draft.trim() || sending || running} onClick={() => void send()}>
            <BotIcon name="send" />
          </button>
        </div>
      </div>

      {panel === "profile" ? (
        <BotsDrawer title="Bot profile" onClose={() => setPanel(null)}>
          <ProfilePanel
            key={bot.id}
            bot={bot}
            onSave={patchBot}
            onDuplicate={async () => {
              const { bot: copy } = await createBot({ duplicateOf: bot.id });
              await onBotsChange();
              setPanel(null);
              onSelect(copy.id);
            }}
            onClear={async () => {
              if (await confirm(`Clear the chat with ${bot.name}? It also forgets the conversation.`, { title: "Clear chat", confirmLabel: "Clear" })) {
                await clearBotChat(bot.id).catch(() => undefined);
                setMessages(bot.id, () => []);
                void onBotsChange();
              }
            }}
            onDelete={async () => {
              if (await confirm(`Delete ${bot.name} and its chat? This can't be undone.`, { title: "Delete bot", confirmLabel: "Delete", danger: true })) {
                try {
                  await deleteBot(bot.id);
                  setPanel(null);
                  onDeleted();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not delete");
                }
              }
            }}
          />
        </BotsDrawer>
      ) : panel === "computer" ? (
        <BotsDrawer title="Computer" onClose={() => setPanel(null)}>
          <ComputerPanel key={`${bot.id}-${bot.ownComputer}`} bot={bot} onDesktop={setDesktopUrl} />
        </BotsDrawer>
      ) : panel === "tasks" ? (
        <BotsDrawer title={`${bot.name}’s tasks`} onClose={() => setPanel(null)}>
          <RoutinesPanel key={bot.id} bots={bots} bot={bot} />
        </BotsDrawer>
      ) : null}

      {desktopUrl ? (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Computer desktop">
          <div className={styles.desktop}>
            <div className={styles.dialogHead}>
              <h2>{bot.ownComputer ? `${bot.name}’s computer` : "Project computer"}</h2>
              <button type="button" className={styles.iconBtn} aria-label="Close desktop" onClick={() => setDesktopUrl("")}>
                <BotIcon name="close" />
              </button>
            </div>
            <iframe src={desktopUrl} title="Computer desktop" allow="clipboard-read; clipboard-write" />
          </div>
        </div>
      ) : null}
    </section>
  );
}
