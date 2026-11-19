"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useConfirmDialog } from "@/app/components/portal/useConfirmDialog";
import {
  GTM_BOT_SETUP_STEPS,
  fetchGtmBotStatus,
  gtmBotAction,
  type GtmBotComputer,
  type GtmBotPhase,
  type GtmBotStatus,
} from "@/lib/gtm-bot";
import styles from "./PortalGtmBotPage.module.css";

const ROSTER = [
  { name: "Chief of Staff", role: "Plans the work and hands it out", initial: "C", tone: "violet" },
  { name: "Researcher", role: "Finds companies and decision makers", initial: "R", tone: "teal" },
  { name: "Prospector", role: "Builds and enriches lead sheets", initial: "P", tone: "amber" },
  { name: "Writer", role: "Drafts first lines and follow-ups", initial: "W", tone: "rose" },
] as const;

const STEP_ORDER: GtmBotPhase[] = ["creating", "installing", "starting", "ready"];

const GETTING_STARTED = [
  {
    title: "Connect Grok",
    body: "In the workspace, open Connect an AI → Grok → Sign in to Grok. Approve the code at accounts.x.ai with your SuperGrok account. Bots then run on your plan, not on API credits.",
  },
  {
    title: "Connect your apps",
    body: "Use Connect apps (bottom left) to link HubSpot, Apollo, Notion, Gmail and more. Each app is signed in once and every bot can use it.",
  },
  {
    title: "Build your GTM team",
    body: "Ask the Chief of Staff: “Make me a GTM team: a researcher, a prospector and a writer for B2B SaaS in India.” It creates the bots for you.",
  },
  {
    title: "Get results as sheets",
    body: "Give a bot a goal like “Find 25 Series A fintech companies with their heads of growth, as a CSV.” It works in the background and hands back a file.",
  },
];

function phaseLabel(status: GtmBotStatus | null) {
  if (!status) return { text: "Loading", tone: "muted" as const };
  if (!status.configured) return { text: "Not available", tone: "muted" as const };
  if (status.busy) return { text: status.phaseDetail || "Starting", tone: "busy" as const };
  switch (status.phase) {
    case "ready":
      return { text: "Online", tone: "live" as const };
    case "stopped":
      return { text: "Asleep", tone: "muted" as const };
    case "error":
      return { text: "Needs attention", tone: "error" as const };
    case "none":
      return { text: "Not set up", tone: "muted" as const };
    default:
      return { text: status.phaseDetail || "Starting", tone: "busy" as const };
  }
}

function formatDollars(value: number | null) {
  if (value == null) return "—";
  return value < 0.01 && value > 0 ? "<$0.01" : `$${value.toFixed(2)}`;
}

function relativeTime(iso: string | null) {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function Spinner() {
  return <span className={styles.spinner} aria-hidden="true" />;
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4h5v5M16 4l-7 7" />
      <path d="M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5" />
    </svg>
  );
}

function SetupSteps({ status }: { status: GtmBotStatus }) {
  const current = STEP_ORDER.indexOf(status.phase);
  return (
    <ol className={styles.steps} aria-label="Setup progress">
      {GTM_BOT_SETUP_STEPS.map((step, index) => {
        const done = status.phase === "ready" || (current > index && status.busy);
        const active = status.busy && current === index;
        return (
          <li
            key={step.phase}
            className={`${styles.step} ${done ? styles.stepDone : ""} ${active ? styles.stepActive : ""}`}
          >
            <span className={styles.stepDot}>{done ? "✓" : active ? <Spinner /> : index + 1}</span>
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ComputerRow({ computer }: { computer: GtmBotComputer }) {
  return (
    <li className={styles.computer}>
      <span className={`${styles.dot} ${computer.running ? styles.dotLive : ""}`} aria-hidden="true" />
      <div className={styles.computerMain}>
        <strong>{computer.name}</strong>
        <span>
          {computer.running ? "Running" : computer.state === "unknown" ? "Unknown" : "Asleep"} · {computer.id}
        </span>
      </div>
      <div className={styles.computerCost}>
        <strong>{formatDollars(computer.monthDollars)}</strong>
        <span>{computer.monthHours != null ? `${computer.monthHours} h this month` : ""}</span>
      </div>
    </li>
  );
}

export default function PortalGtmBotPage() {
  const [status, setStatus] = useState<GtmBotStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<"start" | "stop" | "open" | "always_on" | null>(null);
  const [confirm, confirmDialog] = useConfirmDialog();
  const mounted = useRef(true);

  const refresh = useCallback(
    () =>
      fetchGtmBotStatus().then(
        (next) => {
          if (!mounted.current) return;
          setStatus(next);
          setLoadError(null);
        },
        (error: unknown) => {
          if (mounted.current) setLoadError(error instanceof Error ? error.message : "Could not load GTM Bot");
        },
      ),
    [],
  );

  useEffect(() => {
    mounted.current = true;
    const first = window.setTimeout(() => void refresh(), 0);
    return () => {
      mounted.current = false;
      window.clearTimeout(first);
    };
  }, [refresh]);

  const working = Boolean(status?.busy) || pending === "start";
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), working ? 2500 : 20000);
    return () => window.clearInterval(timer);
  }, [refresh, working]);

  async function start() {
    setActionError(null);
    setPending("start");
    // The request runs for a few minutes; the poll above shows each step meanwhile.
    window.setTimeout(() => void refresh(), 800);
    try {
      const result = await gtmBotAction("start");
      if (result.status) setStatus(result.status);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not start GTM Bot");
    } finally {
      setPending(null);
      void refresh();
    }
  }

  async function open() {
    setActionError(null);
    setPending("open");
    // Open the tab now (inside the click) so pop-up blockers allow it, then send it to the sign-in link.
    const tab = window.open("about:blank", "_blank");
    try {
      const { link } = await gtmBotAction("open");
      if (!link) throw new Error("No sign-in link came back");
      if (tab) tab.location.href = link;
      else window.location.href = link;
    } catch (error) {
      tab?.close();
      setActionError(error instanceof Error ? error.message : "Could not open GTM Bot");
      void refresh();
    } finally {
      setPending(null);
    }
  }

  async function stop() {
    const ok = await confirm(
      "Your bots stop working until you wake the workspace again. Chats, bots and sign-ins are kept.",
      { title: "Put GTM Bot to sleep?", confirmLabel: "Put to sleep" },
    );
    if (!ok) return;
    setActionError(null);
    setPending("stop");
    try {
      const result = await gtmBotAction("stop");
      if (result.status) setStatus(result.status);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not stop GTM Bot");
    } finally {
      setPending(null);
    }
  }

  async function toggleAlwaysOn(next: boolean) {
    setActionError(null);
    setPending("always_on");
    try {
      const result = await gtmBotAction("always_on", { alwaysOn: next });
      if (result.status) setStatus(result.status);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not change the setting");
    } finally {
      setPending(null);
    }
  }

  const badge = phaseLabel(status);
  const phase = status?.phase ?? "none";
  const isReady = phase === "ready" && !working;
  const hasWorkspace = Boolean(status && status.phase !== "none");
  const error = actionError || (status?.phase === "error" && !working ? status.error : null) || loadError;

  let primary: ReactNode = null;
  if (status && !status.configured) {
    primary = <p className={styles.heroNote}>Cloud computers aren’t set up on this server yet. Ask an admin to add the Boat API key.</p>;
  } else if (working) {
    primary = (
      <button type="button" className={styles.primary} disabled>
        <Spinner /> {status?.phaseDetail || "Starting"}…
      </button>
    );
  } else if (isReady) {
    primary = (
      <>
        <button type="button" className={styles.primary} onClick={() => void open()} disabled={pending !== null}>
          {pending === "open" ? <Spinner /> : null}
          Open GTM Bot
          <ExternalIcon />
        </button>
        <button type="button" className={styles.ghost} onClick={() => void stop()} disabled={pending !== null}>
          {pending === "stop" ? <Spinner /> : null}
          Put to sleep
        </button>
      </>
    );
  } else if (status) {
    const label = phase === "none" ? "Set up GTM Bot" : phase === "error" ? "Try again" : "Wake workspace";
    primary = (
      <button type="button" className={styles.primary} onClick={() => void start()} disabled={pending !== null}>
        {label}
      </button>
    );
  }

  return (
    <div className={styles.page}>
      {confirmDialog}

      <section className={styles.hero}>
        <div className={styles.heroText}>
          <div className={styles.heroTop}>
            <span className={styles.kicker}>GTM Bot</span>
            <span className={`${styles.badge} ${styles[`badge_${badge.tone}`]}`}>
              {badge.tone === "busy" ? <Spinner /> : <span className={styles.badgeDot} />}
              {badge.text}
            </span>
          </div>
          <h1 className={styles.title}>Your go-to-market team of AI bots</h1>
          <p className={styles.lede}>
            Chat with bots like contacts. Each one researches, prospects and writes on its own cloud
            computer, works in the background, and hands back sheets you can use.
          </p>
          <div className={styles.actions}>{primary}</div>
          {working || phase === "none" ? status ? <SetupSteps status={status} /> : null : null}
          {working ? (
            <p className={styles.heroNote}>First setup takes about two minutes. You can leave this page; it keeps going.</p>
          ) : null}
          {isReady ? (
            <p className={styles.heroNote}>
              Opens in a new tab and signs this browser in. Last opened {relativeTime(status?.lastOpenedAt ?? null)}.
            </p>
          ) : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className={styles.roster} aria-hidden="true">
          <div className={styles.rosterHead}>
            <span>Bots</span>
            <span className={styles.rosterPlus}>+</span>
          </div>
          {ROSTER.map((bot, index) => (
            <div key={bot.name} className={`${styles.rosterRow} ${index === 0 ? styles.rosterActive : ""}`}>
              <span className={`${styles.avatar} ${styles[`tone_${bot.tone}`]}`}>{bot.initial}</span>
              <span className={styles.rosterText}>
                <strong>{bot.name}</strong>
                <span>{bot.role}</span>
              </span>
              {index === 1 ? <span className={styles.typing}><i /><i /><i /></span> : null}
            </div>
          ))}
          <div className={styles.rosterFoot}>
            <span className={styles.computerChip}>Own computer</span>
            <span className={styles.computerChip}>Grok</span>
            <span className={styles.computerChip}>HubSpot · Apollo · Notion</span>
          </div>
        </div>
      </section>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>Get started</h2>
          <ol className={styles.checklist}>
            {GETTING_STARTED.map((item, index) => (
              <li key={item.title}>
                <span className={styles.checkNum}>{index + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Computers</h2>
            <span className={styles.cost}>
              This month <strong>{formatDollars(status?.monthDollars ?? 0)}</strong>
            </span>
          </div>
          {hasWorkspace && status?.computers.length ? (
            <ul className={styles.computers}>
              {status.computers.map((computer) => (
                <ComputerRow key={computer.id} computer={computer} />
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>Your workspace gets its own computer when you set it up.</p>
          )}
          <p className={styles.muted}>
            {status?.relayEnabled
              ? `Bots can start up to ${status.maxBotComputers} extra computers of their own, from a bot’s Computer panel.`
              : "All bots share the workspace computer. Extra computers per bot turn on once the portal runs on its public address."}
          </p>

          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={Boolean(status?.alwaysOn)}
              disabled={!hasWorkspace || pending !== null}
              onChange={(event) => void toggleAlwaysOn(event.target.checked)}
            />
            <span className={styles.switch} aria-hidden="true" />
            <span>
              <strong>Always on</strong>
              <span>Keeps scheduled routines running. Off: the workspace sleeps 4 hours after it was last opened.</span>
            </span>
          </label>

          {status?.version ? (
            <p className={styles.fine}>
              Built on OpenMausBot {status.version} (Apache-2.0). Your AI sign-ins stay on your workspace computer.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
