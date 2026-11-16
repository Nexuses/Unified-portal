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
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [checkingLogin, setCheckingLogin] = useState(false);
  const [phoneView, setPhoneView] = useState<"keypad" | "workspace">("keypad");
  const awaitingReturnRef = useRef(false);
  const zeroLongPressRef = useRef<{
    timer: number | null;
    fired: boolean;
  }>({ timer: null, fired: false });

  const setPhaseSafe = useCallback((next: DialerPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const AIRCALL_LOGIN_URL = "https://workspace.aircall.io";

  const openAircallLogin = useCallback(() => {
    awaitingReturnRef.current = true;
    window.open(AIRCALL_LOGIN_URL, "_blank", "noopener,noreferrer");
    setHint("Sign in on the Aircall tab, then come back here.");
  }, []);

  const recheckLogin = useCallback(() => {
    awaitingReturnRef.current = false;
    setCheckingLogin(true);
    setError("");
    setHint("Checking Aircall sign-in…");
    setPhaseSafe("loading");
    agentReadyRef.current = false;
    setWorkspaceKey((key) => key + 1);
  }, [setPhaseSafe]);

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

    setPhaseSafe("loading");
    const workspace = new AircallWorkspace({
      domToLoadWorkspace: `#${mountId}`,
      // Official docs: "big" is recommended; "auto" is not.
      size: "big",
      debug: false,
      onLogin: (settings) => {
        if (cancelled) return;
        agentReadyRef.current = true;
        setCheckingLogin(false);
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
        setCheckingLogin(false);
        setPhaseSafe("logged_out");
        setAgentLabel("");
        startedForRef.current = null;
        setHint("Sign in to Aircall, then come back here to use the dialer.");
      },
    });
    workspaceRef.current = workspace;

    // If the embed never logs in (already signed out), surface the login gate.
    const loginTimeout = window.setTimeout(() => {
      if (cancelled || agentReadyRef.current) return;
      setCheckingLogin(false);
      setPhaseSafe("logged_out");
      setHint("Sign in to Aircall, then come back here to use the dialer.");
    }, 4500);

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
      setHint("Calling… use End on the phone to hang up.");
      setDialBusy(false);
      setPhoneView("workspace");
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
      setPhoneView("keypad");
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
      window.clearTimeout(loginTimeout);
      clearCallWatch();
      agentReadyRef.current = false;
      workspaceRef.current = null;
      const el = document.getElementById(mountId);
      if (el) {
        el.innerHTML = "";
      }
    };
  }, [clearCallWatch, mountId, setPhaseSafe, workspaceKey]);

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

  // After opening Aircall login, re-check once when the user returns to this tab.
  useEffect(() => {
    function onFocus() {
      if (!awaitingReturnRef.current) return;
      if (phaseRef.current !== "logged_out" || checkingLogin) return;
      recheckLogin();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkingLogin, recheckLogin]);

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
  const signedIn = phase !== "loading" && phase !== "logged_out";
  const showLoginGate = !signedIn;

  const keypadKeys = [
    { digit: "1", letters: "" },
    { digit: "2", letters: "ABC" },
    { digit: "3", letters: "DEF" },
    { digit: "4", letters: "GHI" },
    { digit: "5", letters: "JKL" },
    { digit: "6", letters: "MNO" },
    { digit: "7", letters: "PQRS" },
    { digit: "8", letters: "TUV" },
    { digit: "9", letters: "WXYZ" },
    { digit: "*", letters: "" },
    { digit: "0", letters: "+" },
    { digit: "#", letters: "" },
  ] as const;

  function pressKey(digit: string) {
    if (inCall || busy) return;
    setManualNumber((current) => `${current}${digit}`);
  }

  function clearZeroLongPress() {
    if (zeroLongPressRef.current.timer != null) {
      window.clearTimeout(zeroLongPressRef.current.timer);
      zeroLongPressRef.current.timer = null;
    }
  }

  function onZeroPointerDown() {
    if (inCall || busy) return;
    clearZeroLongPress();
    zeroLongPressRef.current.fired = false;
    zeroLongPressRef.current.timer = window.setTimeout(() => {
      zeroLongPressRef.current.fired = true;
      zeroLongPressRef.current.timer = null;
      pressKey("+");
    }, 450);
  }

  function onZeroPointerEnd() {
    clearZeroLongPress();
  }

  function onKeyClick(digit: string) {
    if (digit === "0" && zeroLongPressRef.current.fired) {
      zeroLongPressRef.current.fired = false;
      return;
    }
    pressKey(digit);
  }

  function deleteKey() {
    if (inCall || busy) return;
    setManualNumber((current) => current.slice(0, -1));
  }

  const timerLabel =
    phase === "ended" && lastDurationSec != null
      ? formatClock(lastDurationSec)
      : inCall
        ? formatClock(elapsedSec)
        : "";

  return (
    <div className="aircall-dialer">
      {showLoginGate ? (
        <div className="aircall-login-gate">
          <div className="aircall-login-copy">
            <strong>
              {phase === "loading" || checkingLogin
                ? "Checking Aircall…"
                : "Sign in to Aircall"}
            </strong>
            <p>
              {phase === "loading" || checkingLogin
                ? "Looking for an Aircall session in this browser."
                : "Log in to Aircall in a new tab, then come back here and continue."}
            </p>
          </div>
          <div className="aircall-login-actions">
            <button
              type="button"
              className="btn-dark"
              onClick={openAircallLogin}
            >
              Login to Aircall
            </button>
            <button
              type="button"
              className="btn-soft"
              onClick={recheckLogin}
              disabled={checkingLogin || phase === "loading"}
            >
              {checkingLogin || phase === "loading"
                ? "Checking…"
                : "I’m signed in — continue"}
            </button>
          </div>
          {hint ? <p className="aircall-dial-help">{hint}</p> : null}
          {error ? <p className="aircall-dial-error">{error}</p> : null}
        </div>
      ) : null}

      <div
        className={`phone-sim-stage${showLoginGate ? " is-gated" : ""}`}
        aria-hidden={showLoginGate}
      >
        <div className="phone-sim phone-sim-iphone">
          <div className="phone-sim-side phone-sim-silent" aria-hidden />
          <div className="phone-sim-side phone-sim-vol-up" aria-hidden />
          <div className="phone-sim-side phone-sim-vol-down" aria-hidden />
          <div className="phone-sim-side phone-sim-power" aria-hidden />
          <div className="phone-sim-bezel">
            <div className="phone-sim-screen">
              <div className="phone-sim-island" aria-hidden>
                <span className="phone-sim-island-cam" />
                <span className="phone-sim-island-sensor" />
              </div>

              <div
                className={`phone-sim-layer phone-sim-layer-keypad${
                  phoneView === "keypad" ? " is-active" : ""
                }`}
              >
                <div className="phone-sim-topbar">
                  <span className="phone-sim-time">9:41</span>
                  <span className="phone-sim-topbar-right" aria-hidden>
                    <svg className="phone-sim-signal" viewBox="0 0 17 12" width="17" height="12" fill="currentColor">
                      <rect x="0" y="9" width="3" height="3" rx="0.6" />
                      <rect x="4.5" y="6" width="3" height="6" rx="0.6" />
                      <rect x="9" y="3" width="3" height="9" rx="0.6" />
                      <rect x="13.5" y="0" width="3" height="12" rx="0.6" />
                    </svg>
                    <svg className="phone-sim-wifi" viewBox="0 0 16 12" width="16" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M1.2 4.2a9.2 9.2 0 0 1 13.6 0" />
                      <path d="M3.6 6.8a5.6 5.6 0 0 1 8.8 0" />
                      <path d="M6.2 9.3a2.2 2.2 0 0 1 3.6 0" />
                      <circle cx="8" cy="11.2" r="0.9" fill="currentColor" stroke="none" />
                    </svg>
                    <span className="phone-sim-battery">
                      <span className="phone-sim-battery-level" />
                    </span>
                  </span>
                </div>

                {inCall || busy ? (
                  <div
                    className={`phone-sim-call-banner${inCall ? " is-live" : ""}`}
                  >
                    <div className="phone-sim-call-name">
                      {contactLabel &&
                      contactLabel !== manualNumber &&
                      contactLabel !== activeTo
                        ? contactLabel
                        : manualNumber || activeTo || "Calling"}
                    </div>
                    <div className="phone-sim-call-sub">
                      {timerLabel || phaseLabel(phase)}
                    </div>
                  </div>
                ) : (
                  <div className="phone-sim-number-row">
                    <input
                      id={`${mountId}-number`}
                      className="phone-sim-number"
                      type="tel"
                      inputMode="tel"
                      aria-label="Number to call"
                      placeholder=""
                      value={manualNumber}
                      onChange={(e) => setManualNumber(e.target.value)}
                    />
                    {manualNumber ? (
                      <button
                        type="button"
                        className="phone-sim-delete"
                        aria-label="Delete"
                        onClick={deleteKey}
                      >
                        ⌫
                      </button>
                    ) : null}
                  </div>
                )}

                <div className="phone-sim-keypad" role="group" aria-label="Keypad">
                  {keypadKeys.map((key) => (
                    <button
                      key={key.digit}
                      type="button"
                      className="phone-sim-key"
                      disabled={inCall || busy}
                      onClick={() => onKeyClick(key.digit)}
                      onPointerDown={
                        key.digit === "0" ? onZeroPointerDown : undefined
                      }
                      onPointerUp={
                        key.digit === "0" ? onZeroPointerEnd : undefined
                      }
                      onPointerLeave={
                        key.digit === "0" ? onZeroPointerEnd : undefined
                      }
                      onPointerCancel={
                        key.digit === "0" ? onZeroPointerEnd : undefined
                      }
                      onContextMenu={
                        key.digit === "0"
                          ? (e) => e.preventDefault()
                          : undefined
                      }
                      aria-label={
                        key.digit === "0" ? "0, long-press for +" : undefined
                      }
                    >
                      <span className="phone-sim-key-digit">{key.digit}</span>
                      {key.letters ? (
                        <span className="phone-sim-key-letters">{key.letters}</span>
                      ) : (
                        <span className="phone-sim-key-letters is-blank"> </span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="phone-sim-actions">
                  {inCall ? (
                    <button
                      type="button"
                      className="phone-sim-end-btn"
                      aria-label="End call"
                      onClick={() => setPhoneView("workspace")}
                    >
                      {/* Classic handset pointing down (hang up) */}
                      <svg
                        className="phone-sim-call-icon"
                        viewBox="0 0 512 512"
                        aria-hidden
                      >
                        <path
                          fill="currentColor"
                          transform="rotate(135 256 256)"
                          d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z"
                        />
                      </svg>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`phone-sim-call-btn${busy ? " is-busy" : ""}`}
                      disabled={busy || !manualNumber.trim()}
                      aria-label={busy ? "Calling" : "Call"}
                      onClick={() => void startCall(manualNumber)}
                    >
                      {/* Classic handset — same orientation as iOS Phone.app call */}
                      <svg
                        className="phone-sim-call-icon"
                        viewBox="0 0 512 512"
                        aria-hidden
                      >
                        <path
                          fill="currentColor"
                          d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z"
                        />
                      </svg>
                    </button>
                  )}
                </div>

                {error ? <p className="phone-sim-error">{error}</p> : null}
                {hint && !error ? <p className="phone-sim-hint">{hint}</p> : null}
              </div>

              <div
                className={`phone-sim-layer phone-sim-layer-workspace${
                  phoneView === "workspace" ? " is-active" : ""
                }`}
              >
                <div className="phone-sim-workspace-bar">
                  <button
                    type="button"
                    className="phone-sim-back-keypad"
                    onClick={() => setPhoneView("keypad")}
                  >
                    ← Keypad
                  </button>
                  <span>{inCall ? timerLabel || "In call" : "Aircall"}</span>
                </div>
                <div id={mountId} className="aircall-workspace-frame" />
              </div>

              <div className="phone-sim-home" aria-hidden />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
