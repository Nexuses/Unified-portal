export type GtmBotPhase =
  | "none"
  | "creating"
  | "installing"
  | "starting"
  | "ready"
  | "stopped"
  | "error";

export type GtmBotComputer = {
  id: string;
  role: "home" | "bot";
  name: string;
  state: string;
  running: boolean;
  monthHours: number | null;
  monthDollars: number | null;
};

export type GtmBotStatus = {
  configured: boolean;
  phase: GtmBotPhase;
  phaseDetail: string;
  /** A start or setup is running right now. */
  busy: boolean;
  error: string | null;
  url: string | null;
  version: string | null;
  alwaysOn: boolean;
  /** Bots can make extra computers (needs a public portal address). */
  relayEnabled: boolean;
  maxBotComputers: number;
  lastOpenedAt: string | null;
  computers: GtmBotComputer[];
  monthDollars: number;
};

export type GtmBotAction = "start" | "stop" | "open" | "always_on";

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export async function fetchGtmBotStatus(): Promise<GtmBotStatus> {
  return readJson<GtmBotStatus>(await fetch("/api/gtm-bot", { cache: "no-store" }));
}

export async function gtmBotAction(
  action: GtmBotAction,
  body: Record<string, unknown> = {},
): Promise<{ ok: true; link?: string; status?: GtmBotStatus }> {
  return readJson(
    await fetch("/api/gtm-bot/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    }),
  );
}

export const GTM_BOT_SETUP_STEPS: Array<{ phase: GtmBotPhase; label: string }> = [
  { phase: "creating", label: "Computer" },
  { phase: "installing", label: "Install" },
  { phase: "starting", label: "Start" },
  { phase: "ready", label: "Ready" },
];
