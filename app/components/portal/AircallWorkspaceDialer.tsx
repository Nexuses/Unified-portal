"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import AircallWorkspaceImport from "aircall-everywhere";
import { formatCallDuration, toE164Phone } from "@/lib/aircall";

// CJS default export interop (Next / ESM).
const AircallWorkspace =
  (AircallWorkspaceImport as unknown as { default?: typeof AircallWorkspaceImport })
    .default ?? AircallWorkspaceImport;

export type DialerPhase =
  | "loading"
  | "logged_out"
  | "ready"
  | "starting"
  | "ringing"
  | "connected"
  | "ended";

type AircallWorkspaceDialerProps = {
  pendingDial: string | null;
  contactLabel?: string;
  onPendingDialConsumed?: () => void;
};

type WorkspaceInstance = InstanceType<typeof AircallWorkspace>;

function formatClock(totalSec: number) {
  const total = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function phaseLabel(phase: DialerPhase) {
  switch (phase) {
    case "loading":
      return "Loading dialer…";
    case "logged_out":
      return "Sign in to Aircall (left)";
    case "ready":
      return "Ready";
    case "starting":
      return "Sending number…";
    case "ringing":
      return "Calling…";
    case "connected":
      return "Connected";
    case "ended":
      return "Call ended";
    default:
      return "";
  }
}

function errorMessage(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const record = data as { message?: unknown; error?: unknown; code?: unknown };
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }
    if (record.code === "in_call") {
      return "Aircall is already on a call. End it in the dialer first.";
    }
    if (record.code === "not_ready" || record.code === "no_answer") {
      return "Dialer not ready. Sign in on the left, wait a second, then try Call again.";
    }
  }
  return fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function sendWorkspace(
  workspace: WorkspaceInstance,
  eventName: string,
  payload?: Record<string, unknown>,
) {
  return new Promise<{ ok: boolean; data: unknown }>((resolve) => {
    try {
      workspace.send(eventName, payload || {}, (success, data) => {
        resolve({ ok: Boolean(success), data });
      });
    } catch (err) {
      resolve({
        ok: false,
        data: {
          message: err instanceof Error ? err.message : "Dialer send failed",
        },
      });
    }
  });
}

async function waitUntilLoggedIn(workspace: WorkspaceInstance, tries = 8) {
  for (let i = 0; i < tries; i += 1) {
    const result = await new Promise<{ ok: boolean }>((resolve) => {
      try {
        workspace.isLoggedIn((success) => resolve({ ok: Boolean(success) }));
      } catch {
        resolve({ ok: false });
      }
    });
    if (result.ok) {
      return true;
    }
    await sleep(400);
  }
  return false;
}

async function dialNumberIntoWorkspace(
  workspace: WorkspaceInstance,
  to: string,
) {
  let lastData: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) {
      await sleep(700 * attempt);
    }
    const loggedIn = await waitUntilLoggedIn(workspace, 4);
    if (!loggedIn) {
      lastData = {
        code: "not_ready",
        message: "Aircall dialer is not signed in yet.",
      };
      continue;
    }
    const result = await sendWorkspace(workspace, "dial_number", {
      phone_number: to,
    });
    lastData = result.data;
    if (result.ok) {
      return { ok: true as const, data: result.data };
    }
  }
  return { ok: false as const, data: lastData };
}

export default function AircallWorkspaceDialer({
  pendingDial,
  contactLabel,
  onPendingDialConsumed,
}: AircallWorkspaceDialerProps) {
  const reactId = useId().replace(/:/g, "");
  const mountId = `aircall-workspace-${reactId}`;
  const workspaceRef = useRef<WorkspaceInstance | null>(null);
  const agentReadyRef = useRef(false);
  const startedForRef = useRef<string | null>(null);
  const answeredAtRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const phaseRef = useRef<DialerPhase>("loading");
  const callWatchRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<DialerPhase>("loading");
  const [agentLabel, setAgentLabel] = useState("");
  const [activeTo, setActiveTo] = useState("");
  const [activeFrom, setActiveFrom] = useState("");
  const [callId, setCallId] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [lastDurationSec, setLastDurationSec] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [hint, setHint] = useState(
    "Sign in once in the left Aircall dialer (browser). Portal login is not enough.",
  );
  const [manualNumber, setManualNumber] = useState("");
  const [dialBusy, setDialBusy] = useState(false);

  const setPhaseSafe = useCallback((next: DialerPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearCallWatch = useCallback(() => {
    if (callWatchRef.current != null) {
      window.clearTimeout(callWatchRef.current);
      callWatchRef.current = null;
    }
  }, []);

  const startCall = useCallback(
    async (raw: string, opts?: { fromPending?: boolean }) => {
      const to = toE164Phone(raw);
      if (!to) {
        setError("Enter a valid phone number.");
        return;
      }
      const workspace = workspaceRef.current;
      if (!workspace || !agentReadyRef.current) {
        setError(
          "Sign in to Aircall in the left dialer first (same user as AIRCALL_USER_ID), then press Call.",
        );
        setPhaseSafe("logged_out");
        return;
      }
      const current = phaseRef.current;
      if (
        current === "starting" ||
        current === "ringing" ||
        current === "connected"
      ) {
        setError("A call is already in progress.");
        return;
      }

      setError("");
      setHint("Copying number into the Aircall dialer…");
      setDialBusy(true);
      setManualNumber(to);
      setActiveTo(to);
      setPhaseSafe("starting");
      // Do not start the timer until Workspace reports outgoing_call.
      startedAtRef.current = null;
      answeredAtRef.current = null;
      setElapsedSec(0);
      setLastDurationSec(null);
      setCallId(null);
      clearCallWatch();

      try {
        const prefill = await dialNumberIntoWorkspace(workspace, to);
        if (!prefill.ok) {
          throw new Error(
            errorMessage(
              prefill.data,
              "Could not copy the number into the dialer. Sign in on the left and try again.",
            ),
          );
        }

        setHint("Number loaded in dialer — starting the call…");

        // Also push via API so Workspace auto-starts (same logged-in user).
        const response = await fetch("/api/aircall/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to, mode: "start" }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          // Number is in the dialer — user can press green Call.
          setHint(
            "Number is in the dialer To field. Press the green Call button on the left to start. Timer starts when the call begins.",
          );
          setPhaseSafe("ready");
          setError(
            errorMessage(
              data,
              "Auto-start failed. Press green Call in the dialer.",
            ),
          );
          return;
        }

        setHint(
          "If the call does not ring in a few seconds, press the green Call button in the left dialer.",
        );

        // If Workspace never emits outgoing_call, fall back to manual Call.
        callWatchRef.current = window.setTimeout(() => {
          if (phaseRef.current === "starting") {
            setPhaseSafe("ready");
            setHint(
              "Number is copied into the dialer. Press the green Call button on the left — timer will start automatically.",
            );
            setDialBusy(false);
          }
        }, 6000);
      } catch (err) {
        setPhaseSafe(agentReadyRef.current ? "ready" : "logged_out");
        setError(err instanceof Error ? err.message : "Call failed");
        setHint(
          "Sign in on the left, then press Call again. The number must appear in the dialer To field.",
        );
      } finally {
        setDialBusy(false);
        if (opts?.fromPending) {
          onPendingDialConsumed?.();
        }
      }
    },
    [clearCallWatch, onPendingDialConsumed, setPhaseSafe],
  );

  useEffect(() => {
    let cancelled = false;
    const host = document.getElementById(mountId);
    if (host) {
      host.innerHTML = "";
    }

    const workspace = new AircallWorkspace({
      domToLoadWorkspace: `#${mountId}`,
      // Official docs: "big" is recommended; "auto" is not.
      size: "big",
      debug: false,
      onLogin: (settings) => {
        if (cancelled) return;
        agentReadyRef.current = true;
        const user = settings?.user;
        const name = [user?.first_name, user?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim();
        setAgentLabel(name || user?.email || "Aircall agent");
        const prev = phaseRef.current;
        if (
          prev !== "connected" &&
          prev !== "ringing" &&
          prev !== "starting"
        ) {
          setPhaseSafe("ready");
        }
        setError("");
        setHint(
          "Signed in. Press Call — the number will copy into the dialer and the call should start.",
        );
      },
      onLogout: () => {
        if (cancelled) return;
        agentReadyRef.current = false;
        setPhaseSafe("logged_out");
        setAgentLabel("");
        startedForRef.current = null;
        setHint(
          "Sign in once in the left Aircall dialer (browser). Use the same Aircall user as AIRCALL_USER_ID.",
        );
      },
    });
    workspaceRef.current = workspace;

    workspace.on("outgoing_call", (info) => {
      clearCallWatch();
      const payload = (info || {}) as {
        to?: string;
        from?: string;
        call_id?: number;
      };
      if (payload.to) {
        setActiveTo(String(payload.to));
        setManualNumber(String(payload.to));
      }
      setActiveFrom(String(payload.from || ""));
      setCallId(typeof payload.call_id === "number" ? payload.call_id : null);
      startedAtRef.current = Date.now();
      answeredAtRef.current = null;
      setElapsedSec(0);
      setLastDurationSec(null);
      setPhaseSafe("ringing");
      setError("");
      setHint("Calling… use End in the left dialer to hang up.");
      setDialBusy(false);
    });

    workspace.on("outgoing_answered", (info) => {
      const payload = (info || {}) as { call_id?: number };
      if (typeof payload.call_id === "number") {
        setCallId(payload.call_id);
      }
      answeredAtRef.current = Date.now();
      setElapsedSec(0);
      setPhaseSafe("connected");
      setHint("Connected — talk time is running.");
    });

    workspace.on("incoming_call", (info) => {
      clearCallWatch();
      const payload = (info || {}) as {
        from?: string;
        to?: string;
        call_id?: number;
      };
      setActiveFrom(String(payload.from || ""));
      setActiveTo(String(payload.to || ""));
      setCallId(typeof payload.call_id === "number" ? payload.call_id : null);
      startedAtRef.current = Date.now();
      answeredAtRef.current = null;
      setElapsedSec(0);
      setPhaseSafe("ringing");
      setHint("Incoming call…");
    });

    workspace.on("call_ended", (info) => {
      clearCallWatch();
      const payload = (info || {}) as {
        duration?: number;
        call_id?: number;
      };
      if (typeof payload.call_id === "number") {
        setCallId(payload.call_id);
      }
      const duration =
        typeof payload.duration === "number"
          ? payload.duration
          : answeredAtRef.current
            ? Math.round((Date.now() - answeredAtRef.current) / 1000)
            : startedAtRef.current
              ? Math.round((Date.now() - startedAtRef.current) / 1000)
              : 0;
      setLastDurationSec(duration);
      setElapsedSec(duration);
      answeredAtRef.current = null;
      startedAtRef.current = null;
      startedForRef.current = null;
      setPhaseSafe("ended");
      setDialBusy(false);
      setHint("Call ended. Sync below to pull the recording into CRM.");
    });

    workspace.on("external_dial", (info) => {
      const payload = (info || {}) as { phone_number?: string };
      const phone = toE164Phone(payload.phone_number);
      if (phone) {
        setManualNumber(phone);
        setActiveTo(phone);
        setHint(`Dialer received ${phone}.`);
      }
    });

    return () => {
      cancelled = true;
      clearCallWatch();
      agentReadyRef.current = false;
      workspaceRef.current = null;
      const el = document.getElementById(mountId);
      if (el) {
        el.innerHTML = "";
      }
    };
  }, [clearCallWatch, mountId, setPhaseSafe]);

  useEffect(() => {
    if (!pendingDial) {
      return;
    }
    const to = toE164Phone(pendingDial);
    if (to) {
      setManualNumber(to);
      setActiveTo(to);
    }
  }, [pendingDial]);

  useEffect(() => {
    if (!pendingDial) {
      startedForRef.current = null;
      return;
    }
    const to = toE164Phone(pendingDial);
    if (!to || startedForRef.current === to) {
      return;
    }
    if (phase !== "ready" && phase !== "ended") {
      return;
    }
    if (!agentReadyRef.current) {
      return;
    }
    startedForRef.current = to;
    // Small delay so Workspace finishes wiring after onLogin.
    const timer = window.setTimeout(() => {
      void startCall(to, { fromPending: true });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [pendingDial, phase, startCall]);

  useEffect(() => {
    if (phase !== "connected" && phase !== "ringing") {
      return;
    }
    const tick = () => {
      const anchor =
        phase === "connected"
          ? answeredAtRef.current
          : startedAtRef.current;
      if (!anchor) {
        return;
      }
      setElapsedSec(Math.floor((Date.now() - anchor) / 1000));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  const inCall = phase === "ringing" || phase === "connected";
  const busy = dialBusy || phase === "starting";

  return (
    <div className="aircall-dialer">
      <div
        className={`aircall-live ${inCall ? "is-live" : ""} ${phase === "ended" ? "is-ended" : ""} ${phase === "starting" ? "is-starting" : ""}`}
      >
        <div className="aircall-live-main">
          <div className="aircall-live-kicker">{phaseLabel(phase)}</div>
          <div className="aircall-live-title">
            {contactLabel || activeTo || "Aircall dialer"}
          </div>
          <div className="aircall-live-meta">
            {activeTo ? <span>{activeTo}</span> : null}
            {activeFrom ? <span>via {activeFrom}</span> : null}
            {agentLabel ? <span>{agentLabel}</span> : null}
            {callId ? <span>#{callId}</span> : null}
          </div>
        </div>
        <div className="aircall-live-timer" aria-live="polite">
          {phase === "ended" && lastDurationSec != null
            ? formatClock(lastDurationSec)
            : inCall
              ? formatClock(elapsedSec)
              : "00:00"}
          <span className="aircall-live-timer-sub">
            {phase === "ended" && lastDurationSec != null
              ? formatCallDuration(lastDurationSec)
              : phase === "connected"
                ? "talk time"
                : inCall
                  ? "elapsed"
                  : phase === "starting"
                    ? "waiting"
                    : "ready"}
          </span>
        </div>
      </div>

      <div className="aircall-signin-banner">
        <strong>Do I need to sign in?</strong>
        <span>
          Yes — once in the <em>left</em> Aircall dialer in this browser
          (Neeraj / same as <code>AIRCALL_USER_ID</code>). That is separate from
          portal login. After that, Call copies the number into To and starts
          the call; the timer starts when Aircall actually dials.
        </span>
      </div>

      <div className="aircall-dialer-grid">
        <div className="aircall-workspace-card">
          <div className="aircall-workspace-head">
            <div>
              <strong>Dialer</strong>
              <p>Sign in here once. Mute / End stay in this panel.</p>
            </div>
            <span
              className={`aircall-agent-pill ${phase === "logged_out" || phase === "loading" ? "is-off" : "is-on"}`}
            >
              {phase === "loading"
                ? "Loading"
                : phase === "logged_out"
                  ? "Signed out"
                  : "Signed in"}
            </span>
          </div>
          <div id={mountId} className="aircall-workspace-frame" />
        </div>

        <div className="aircall-dial-pad-card">
          <label className="aircall-dial-label" htmlFor={`${mountId}-number`}>
            Number to call
          </label>
          <input
            id={`${mountId}-number`}
            className="aircall-dial-input"
            type="tel"
            inputMode="tel"
            placeholder="+1 240…"
            value={manualNumber}
            onChange={(e) => setManualNumber(e.target.value)}
            disabled={inCall || busy}
          />
          <div className="aircall-dial-actions">
            <button
              type="button"
              className="aircall-dial-call"
              disabled={
                busy ||
                inCall ||
                phase === "loading" ||
                phase === "logged_out" ||
                !manualNumber.trim()
              }
              onClick={() => void startCall(manualNumber)}
            >
              {busy ? "Calling…" : "Call"}
            </button>
            <button
              type="button"
              className="aircall-dial-end-hint"
              onClick={() => {
                document
                  .getElementById(mountId)
                  ?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              End call in dialer →
            </button>
          </div>
          {error ? <p className="aircall-dial-error">{error}</p> : null}
          {hint ? <p className="aircall-dial-help">{hint}</p> : null}
        </div>
      </div>
    </div>
  );
}
