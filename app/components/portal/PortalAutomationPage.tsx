"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AUTOMATION_UNDER_DEVELOPMENT,
  automationCanReopenForEdit,
  createAutomation,
  fetchAutomation,
  fetchAutomations,
  patchAutomation,
  portalAutomationHistoryRoute,
  portalAutomationRoute,
  reopenAutomationForEdit,
  type AutomationStatus,
  type AutomationStep,
} from "@/lib/automations";
import {
  afterEmailChoices,
  designChoices,
  engagementChoices,
  gapChoices,
  GUIDE_TEMPLATES,
  isGuideStartMessage,
  newGuideSession,
  startGuideChoices,
  subjectQuickChoices,
  typeChoices,
  type ChatChoice,
  type GuideSession,
  type GuidedChatTurn,
} from "@/lib/automation-chat-guide";
import {
  fetchDripCampaign,
  fetchDripCampaigns,
  patchDripCampaign,
  sequencesReady,
  zonedDateTimeToIso,
  type CampaignIndividualContact,
  type CampaignKind,
  type DripCampaign,
} from "@/lib/drip-campaigns";
import AutomationUnderDevelopment from "@/app/components/portal/AutomationUnderDevelopment";
import PortalAutomationHistoryPage from "@/app/components/portal/PortalAutomationHistoryPage";
import PortalCampaignDetailPage from "@/app/components/portal/PortalCampaignDetailPage";
import { PORTAL_ROUTES } from "@/lib/portal-nav";
import { useSpeechInput } from "@/lib/use-speech-input";

type ChatTurn = GuidedChatTurn;

const AUTOMATION_CHAT_KEY = "unified_automation_chat_v1";
const AUTOMATION_CHAT_PENDING_KEY = "unified_automation_chat_pending";

type PersistedChatBundle = {
  chat: ChatTurn[];
  guide: GuideSession;
  savedAt: number;
};

function readChatBundle(key: string): PersistedChatBundle | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PersistedChatBundle;
    if (!parsed || !Array.isArray(parsed.chat)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeChatBundle(key: string, chat: ChatTurn[], guide: GuideSession) {
  try {
    const payload: PersistedChatBundle = {
      chat,
      guide,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

function clearChatBundle(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

type EngagementKind = "opens" | "clicks" | "opens_or_clicks";
type WhoSource = "current" | "past";
type WizardPhase =
  | "closed"
  | "start"
  | "past_select"
  | "past_freq"
  | "past_type"
  | "past_setup"
  | "new_type"
  | "new_setup"
  | "fu_type"
  | "fu_freq"
  | "fu_gap"
  | "fu_setup";

type AutoStep = AutomationStep;

const SUGGESTIONS: Array<{ label: string; description: string; message: string }> = [
  {
    label: "Set up this campaign",
    description: "Guided choices for sender, list, subject, and HTML",
    message: "Set up this campaign",
  },
  {
    label: "Plan a welcome drip",
    description: "Outline a 3-email sequence with wait gaps",
    message: "Plan a 3-email welcome drip",
  },
  {
    label: "Audit this flow",
    description: "Flag what is missing before you schedule",
    message: "Audit this flow before I start",
  },
];

const AUTOMATION_LINK_KEY = "unified_automation_linked_campaign";
const AUTOMATION_TAG = "automation";
const AUTOMATION_FOLLOW_UP_TAG = "automation-follow-up";

function padTime(value: number) {
  return String(value).padStart(2, "0");
}

function isCampaignReady(campaign: DripCampaign) {
  if (campaign.status === "sent") {
    return true;
  }
  if (!campaign.senderId?.trim() || !campaign.senderEmail?.trim()) {
    return false;
  }
  const hasAudience =
    (campaign.recipientMode === "individual" &&
      (campaign.individualContacts?.length ?? 0) > 0) ||
    Boolean(campaign.listId?.trim());
  if (!hasAudience) {
    return false;
  }
  if (campaign.kind === "oneone") {
    return sequencesReady(campaign);
  }
  return Boolean(campaign.subject?.trim() && campaign.designHtml?.trim());
}

function readinessGaps(campaign: DripCampaign, opts?: { audienceOptional?: boolean }) {
  const gaps: string[] = [];
  if (!campaign.senderId?.trim() || !campaign.senderEmail?.trim()) {
    gaps.push("Sender");
  }
  const hasAudience =
    (campaign.recipientMode === "individual" &&
      (campaign.individualContacts?.length ?? 0) > 0) ||
    Boolean(campaign.listId?.trim());
  if (!hasAudience && !opts?.audienceOptional) {
    gaps.push("Recipients / list");
  }
  if (campaign.kind === "oneone") {
    if (!sequencesReady(campaign)) {
      gaps.push("Sequence 1 subject + all designs");
    }
  } else if (!campaign.subject?.trim() || !campaign.designHtml?.trim()) {
    gaps.push("Subject + email design");
  }
  return gaps;
}

function newEmailStep(partial?: Partial<AutoStep>): AutoStep {
  return {
    id: `step-${Math.random().toString(36).slice(2, 10)}`,
    type: "email",
    waitDays: 0,
    waitHours: 0,
    whoSource: "current",
    ...partial,
  };
}

function engagementLabel(engagement?: EngagementKind) {
  if (engagement === "opens") {
    return "Opened";
  }
  if (engagement === "clicks") {
    return "Clicked";
  }
  if (engagement === "opens_or_clicks") {
    return "Opened or clicked";
  }
  return "Not set";
}

function typeChosen(step: AutoStep) {
  return step.campaignKind === "drip" || step.campaignKind === "oneone";
}

/** After save/navigation, reopen the unfinished question instead of closing the wizard. */
function resumeWizardFromSteps(loadedSteps: AutoStep[]): WizardPhase {
  if (loadedSteps.length === 0) {
    return "start";
  }
  const first = loadedSteps[0];
  if (first.whoSource === "past") {
    if (!first.pastCampaignId) {
      return "past_select";
    }
    if (!first.engagement) {
      return "past_freq";
    }
    if (!typeChosen(first)) {
      return "past_type";
    }
    if (!first.campaignId) {
      return "past_setup";
    }
  } else {
    if (!typeChosen(first)) {
      return "new_type";
    }
    if (!first.campaignId) {
      return "new_setup";
    }
  }
  const incompleteFu = loadedSteps.find(
    (step, index) => index > 0 && !step.campaignId,
  );
  if (!incompleteFu) {
    return "closed";
  }
  if (!typeChosen(incompleteFu)) {
    return "fu_type";
  }
  if (!incompleteFu.engagement) {
    return "fu_freq";
  }
  if (
    incompleteFu.waitDays === undefined ||
    incompleteFu.waitDays === null
  ) {
    return "fu_gap";
  }
  return "fu_setup";
}

function stepKind(step: Pick<AutoStep, "campaignKind">): CampaignKind {
  return step.campaignKind === "oneone" ? "oneone" : "drip";
}

function emailStepLabel(index: number) {
  return `Email ${index + 1}`;
}

function wizardFlowMeta(phase: WizardPhase): {
  flow: string;
  step: number;
  total: number;
} | null {
  switch (phase) {
    case "start":
      return { flow: "Start", step: 1, total: 1 };
    case "past_select":
      return { flow: "Past campaign", step: 1, total: 4 };
    case "past_freq":
      return { flow: "Past campaign", step: 2, total: 4 };
    case "past_type":
      return { flow: "Past campaign", step: 3, total: 4 };
    case "past_setup":
      return { flow: "Past campaign", step: 4, total: 4 };
    case "new_type":
      return { flow: "New campaign", step: 1, total: 2 };
    case "new_setup":
      return { flow: "New campaign", step: 2, total: 2 };
    case "fu_type":
      return { flow: "Email 2+", step: 1, total: 4 };
    case "fu_freq":
      return { flow: "Email 2+", step: 2, total: 4 };
    case "fu_gap":
      return { flow: "Email 2+", step: 3, total: 4 };
    case "fu_setup":
      return { flow: "Email 2+", step: 4, total: 4 };
    default:
      return null;
  }
}

async function fetchEngagerContacts(
  campaignId: string,
  kind: CampaignKind,
  engagement: EngagementKind,
): Promise<CampaignIndividualContact[]> {
  const filters: Array<"opens" | "clicks"> =
    engagement === "opens"
      ? ["opens"]
      : engagement === "clicks"
        ? ["clicks"]
        : ["opens", "clicks"];
  const unique = new Map<string, CampaignIndividualContact>();
  for (const filter of filters) {
    const response = await fetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/recipients?kind=${kind}&filter=${filter}&unique=1`,
    );
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data)) {
      continue;
    }
    for (const row of data) {
      const email = String(row?.email || "")
        .trim()
        .toLowerCase();
      if (!email || unique.has(email)) {
        continue;
      }
      unique.set(email, {
        id: String(row?.contactId || email),
        email,
        fullName: String(row?.fullName || email).trim() || email,
      });
    }
  }
  return [...unique.values()];
}

function campaignKindOf(campaign: Pick<DripCampaign, "kind">): CampaignKind {
  return campaign.kind === "oneone" ? "oneone" : "drip";
}

function pastCampaignKey(campaign: Pick<DripCampaign, "id" | "kind">) {
  return `${campaignKindOf(campaign)}:${campaign.id}`;
}

function findPastCampaignByKey(key: string, campaigns: DripCampaign[]) {
  if (!key) {
    return undefined;
  }
  const sep = key.indexOf(":");
  if (sep < 0) {
    return campaigns.find((campaign) => campaign.id === key);
  }
  const kind = key.slice(0, sep);
  const id = key.slice(sep + 1);
  return (
    campaigns.find(
      (campaign) => campaign.id === id && campaignKindOf(campaign) === kind,
    ) || campaigns.find((campaign) => campaign.id === key)
  );
}

function stepPastKey(
  step: Pick<
    AutoStep,
    "pastCampaignId" | "pastCampaignKind" | "campaignId" | "campaignKind"
  >,
) {
  const id = step.pastCampaignId || step.campaignId || "";
  if (!id) {
    return "";
  }
  const kind = step.pastCampaignKind || step.campaignKind;
  return `${kind === "oneone" ? "oneone" : "drip"}:${id}`;
}

function KindToggle({
  value,
  disabled,
  onChange,
}: {
  value: CampaignKind;
  disabled?: boolean;
  onChange: (next: CampaignKind) => void;
}) {
  return (
    <div className="auto-kind-toggle" role="group" aria-label="Campaign type">
      <button
        type="button"
        className={value === "drip" ? "active" : ""}
        disabled={disabled}
        onClick={() => onChange("drip")}
      >
        Drip
      </button>
      <button
        type="button"
        className={value === "oneone" ? "active" : ""}
        disabled={disabled}
        onClick={() => onChange("oneone")}
      >
        1-1
      </button>
    </div>
  );
}

function FlowWire({
  tone = "idle",
  short,
}: {
  tone?: "idle" | "live" | "done";
  short?: boolean;
}) {
  return (
    <div
      className={`auto-wire${short ? " short" : ""} auto-wire-${tone}`}
      aria-hidden
    >
      <span className="auto-wire-track" />
      <svg
        className="auto-wire-arrow"
        viewBox="0 0 20 20"
        width="18"
        height="18"
        fill="none"
      >
        <path
          d="M10 2.5v11.5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M4.2 10.2 10 16.2l5.8-6"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function ChoiceStepCard({
  pill,
  title,
  value,
  active,
  editable,
  onEdit,
  children,
}: {
  pill: string;
  title: string;
  value: string;
  active?: boolean;
  editable?: boolean;
  onEdit?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={`auto-step-block${active ? " auto-step-block-active" : ""}`}>
      <FlowWire tone={active ? "live" : "done"} />
      <div className={`auto-delay-pill${active ? " auto-delay-pill-active" : ""}`}>
        {pill}
      </div>
      {/* Not a full-card button — avoids stealing the Past/New click under the cursor. */}
      <div
        className={`auto-step-card auto-choice-card${
          active ? " active" : " done"
        }${editable ? " editable" : ""}`}
      >
        <span className="auto-choice-mark" aria-hidden>
          {active ? "●" : "✓"}
        </span>
        <span className="auto-step-meta">
          <strong>{title}</strong>
          <em>{value}</em>
        </span>
        {editable && onEdit ? (
          <button
            type="button"
            className="auto-choice-edit"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Edit
          </button>
        ) : null}
      </div>
      {active && children ? (
        <div className="auto-choice-editor">{children}</div>
      ) : null}
    </div>
  );
}

function formatChatInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

function ChatRichText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="auto-ai-md">
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter((line) => line.trim());
        const list = lines.length > 1 && lines.every((line) => /^\s*([-*]|\d+\.)\s/.test(line));
        if (list) {
          return (
            <ul key={index}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  {formatChatInline(line.replace(/^\s*([-*]|\d+\.)\s/, ""))}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {formatChatInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function normalizeWait(days: number, hours: number) {
  const waitDays = Math.max(0, Number.isFinite(days) ? days : 0);
  let waitHours = Math.max(0, Math.min(23, Number.isFinite(hours) ? hours : 0));
  if (waitDays === 0 && waitHours < 1) {
    waitHours = 1;
  }
  return { waitDays, waitHours };
}

function waitLabel(step: Pick<AutoStep, "waitDays" | "waitHours">) {
  const { waitDays, waitHours } = normalizeWait(
    Number(step.waitDays) || 0,
    Number(step.waitHours) || 0,
  );
  const parts: string[] = [];
  if (waitDays > 0) {
    parts.push(`${waitDays} day${waitDays === 1 ? "" : "s"}`);
  }
  if (waitHours > 0) {
    parts.push(`${waitHours} hour${waitHours === 1 ? "" : "s"}`);
  }
  return parts.length === 0 ? "Wait immediately" : `Wait ${parts.join(" ")}`;
}

function whoLabel(step: AutoStep) {
  const eng =
    step.engagement === "opens"
      ? "opens"
      : step.engagement === "clicks"
        ? "clicks"
        : "opens or clicks";
  if (step.whoSource === "past") {
    const name = step.pastCampaignName || step.pastCampaignId || "past campaign";
    return `Past · ${name} · ${eng}`;
  }
  return `Current campaign · ${eng}`;
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default function PortalAutomationPage({
  mode,
  automationId,
}: {
  mode: "create" | "edit";
  automationId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const addWrapRef = useRef<HTMLDivElement | null>(null);

  const [recordId, setRecordId] = useState(automationId || "");
  const recordIdRef = useRef(recordId);
  recordIdRef.current = recordId;
  const [status, setStatus] = useState<AutomationStatus>("draft");
  const [bootstrapping, setBootstrapping] = useState(true);
  const persistEnabledRef = useRef(false);

  // List-first like Drip/1-1: setup only after New automation (?new=) or edit /:id.
  const historyParam = searchParams.get("history");
  const newParam = searchParams.get("new");
  const [historyOpen, setHistoryOpen] = useState(
    () => historyParam === "1" || (mode === "create" && !newParam),
  );

  useEffect(() => {
    setHistoryOpen(
      historyParam === "1" || (mode === "create" && !newParam),
    );
  }, [mode, historyParam, newParam]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [kind, setKind] = useState<CampaignKind>("drip");
  const [name, setName] = useState("Untitled automation");
  const [steps, setSteps] = useState<AutoStep[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [wizardPhase, setWizardPhase] = useState<WizardPhase>("closed");
  const [zoom, setZoom] = useState(1);

  const [campaignByStep, setCampaignByStep] = useState<Record<string, DripCampaign>>(
    {},
  );
  const [loadingCampaign, setLoadingCampaign] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [campaignSetup, setCampaignSetup] = useState<{
    campaignId: string;
    kind: CampaignKind;
    stepId: string;
    followUp: boolean;
    pastAudience?: {
      campaignName: string;
      engagement: EngagementKind;
    };
  } | null>(null);

  const [pastCampaigns, setPastCampaigns] = useState<DripCampaign[]>([]);
  const [loadingPast, setLoadingPast] = useState(false);

  const [draftWaitDays, setDraftWaitDays] = useState("0");
  const [draftWaitHours, setDraftWaitHours] = useState("1");
  const [draftWho, setDraftWho] = useState<WhoSource>("current");
  const [draftPastId, setDraftPastId] = useState("");
  const [draftEngagement, setDraftEngagement] =
    useState<EngagementKind>("opens_or_clicks");
  const [draftStepKind, setDraftStepKind] = useState<CampaignKind>("drip");

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const now = useMemo(() => new Date(), []);
  const [scheduleDate, setScheduleDate] = useState(
    `${now.getFullYear()}-${padTime(now.getMonth() + 1)}-${padTime(now.getDate())}`,
  );
  const [scheduleHour, setScheduleHour] = useState(padTime(now.getHours()));
  const [scheduleMinute, setScheduleMinute] = useState("30");
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const [launchNotice, setLaunchNotice] = useState("");

  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [chatting, setChatting] = useState(false);
  const [chatError, setChatError] = useState("");
  const [guide, setGuide] = useState<GuideSession>(() => newGuideSession());
  const guideRef = useRef(guide);
  guideRef.current = guide;
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const speech = useSpeechInput({ value: draft, onChange: setDraft });
  const [chatSenders, setChatSenders] = useState<
    Array<{ id: string; fromEmail: string; fromName?: string }>
  >([]);
  const [chatLists, setChatLists] = useState<
    Array<{ id: string; name: string; contactCount?: number }>
  >([]);
  const chatHydratedRef = useRef(false);

  const selectedStep = steps.find((step) => step.id === selectedStepId) ?? null;
  const firstStep = steps[0] ?? null;
  const firstCampaign = firstStep ? campaignByStep[firstStep.id] ?? null : null;

  const firstFromPast = firstStep?.whoSource === "past";
  const firstReady = firstCampaign ? isCampaignReady(firstCampaign) : false;
  const followUpsConfigured = steps.every((step, index) => {
    if (index === 0) {
      if (step.whoSource === "past") {
        return Boolean(
          step.pastCampaignId && step.engagement && typeChosen(step),
        );
      }
      return typeChosen(step);
    }
    if (step.whoSource === "past" && !step.pastCampaignId) {
      return false;
    }
    return (
      typeChosen(step) &&
      Boolean(step.engagement) &&
      step.waitDays !== undefined &&
      step.waitDays !== null
    );
  });
  const allEmailCampaignsReady = steps.every((step, index) => {
    const campaign = campaignByStep[step.id];
    if (!campaign) {
      return false;
    }
    if (campaign.status === "sent") {
      return true;
    }
    const audienceOptional = index > 0;
    return readinessGaps(campaign, { audienceOptional }).length === 0;
  });
  const automationReady =
    steps.length > 0 &&
    firstReady &&
    followUpsConfigured &&
    allEmailCampaignsReady;
  // Completed stays read-only. Scheduled/running can be reopened like Drip/1-1.
  const locked = status !== "draft";
  const canEditAfterRollout = automationCanReopenForEdit(status);
  const wizardOpen = wizardPhase !== "closed";
  const wizardMeta = wizardFlowMeta(wizardPhase);

  function statusBadgeLabel(value: AutomationStatus) {
    switch (value) {
      case "scheduled":
        return "Scheduled";
      case "running":
        return "Running";
      case "completed":
        return "Completed";
      default:
        return "Draft";
    }
  }

  async function handleEditAfterRollout() {
    if (!recordId || !canEditAfterRollout || reopening) {
      return;
    }
    setReopening(true);
    setLoadError("");
    try {
      const updated = await reopenAutomationForEdit({
        id: recordId,
        status,
        steps,
      });
      setStatus("draft");
      persistEnabledRef.current = true;
      await hydrateStepCampaigns(updated.steps?.length ? updated.steps : steps);
      setWizardPhase("closed");
      setLaunchNotice(
        "Editing unlocked. Change the flow or campaign setup, then Schedule again.",
      );
      router.replace(`${portalAutomationRoute(recordId)}?reschedule=1`);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Failed to open automation for editing",
      );
    } finally {
      setReopening(false);
    }
  }

  async function hydrateStepCampaigns(list: AutoStep[]) {
    const entries = await Promise.all(
      list
        .filter((step) => step.campaignId)
        .map(async (step) => {
          try {
            const campaign = await fetchDripCampaign(
              step.campaignId!,
              step.campaignKind,
            );
            return campaign ? ([step.id, campaign] as const) : null;
          } catch {
            return null;
          }
        }),
    );
    const next: Record<string, DripCampaign> = {};
    for (const entry of entries) {
      if (entry) {
        next[entry[0]] = entry[1];
      }
    }
    if (Object.keys(next).length > 0) {
      setCampaignByStep((current) => ({ ...current, ...next }));
    }
  }

  async function attachReturnedCampaign(
    baseSteps: AutoStep[],
    campaignId: string,
    campaignKind: CampaignKind | null,
    targetStepId: string | null,
  ) {
    setLoadingCampaign(true);
    setLoadError("");
    try {
      const campaign = await fetchDripCampaign(
        campaignId,
        campaignKind || undefined,
      );
      if (!campaign) {
        throw new Error("Linked campaign not found");
      }
      const resolvedKind = campaign.kind === "oneone" ? "oneone" : "drip";

      setSteps((prev) => {
        const base = prev.length > 0 ? prev : baseSteps;
        if (base.length === 0) {
          const step = newEmailStep({
            id: `step-${campaign.id}`,
            campaignId: campaign.id,
            campaignKind: resolvedKind,
            waitDays: 0,
          });
          setKind(resolvedKind);
          setSelectedStepId(step.id);
          setCampaignByStep({ [step.id]: campaign });
          return [step];
        }

        const matchIndex = targetStepId
          ? base.findIndex((step) => step.id === targetStepId)
          : base.findIndex((step) => step.campaignId === campaign.id);
        const index = matchIndex >= 0 ? matchIndex : 0;
        if (index === 0) {
          setKind(resolvedKind);
        }
        const next = base.map((step, i) =>
          i === index
            ? {
                ...step,
                campaignId: campaign.id,
                campaignKind: resolvedKind as CampaignKind,
              }
            : step,
        );
        setSelectedStepId(next[index]?.id ?? next[0]?.id ?? null);
        setCampaignByStep((current) => ({
          ...current,
          [next[index].id]: campaign,
        }));
        return next;
      });
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Failed to load linked campaign",
      );
    } finally {
      setLoadingCampaign(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setBootstrapping(true);
      setLoadError("");
      persistEnabledRef.current = false;

      const qId = searchParams.get("campaignId");
      const qKind =
        searchParams.get("kind") === "oneone"
          ? "oneone"
          : searchParams.get("kind") === "drip"
            ? "drip"
            : null;
      const qStepId = searchParams.get("stepId");

      try {
        if (mode === "create") {
          // Always start a fresh automation from the Automation nav.
          // Do not resume the last draft from sessionStorage (that belongs to History / return-from-Drip).
          try {
            sessionStorage.removeItem(AUTOMATION_LINK_KEY);
          } catch {
            /* ignore */
          }
          // Yield so React Strict Mode's discarded first effect cannot wipe
          // a Past/New choice the user already made during name lookup.
          await Promise.resolve();
          if (cancelled) {
            return;
          }
          recordIdRef.current = "";
          setRecordId("");
          setStatus("draft");
          setKind("drip");
          setSteps([]);
          setSelectedStepId(null);
          setCampaignByStep({});
          setWizardPhase("start");
          setLaunchNotice("");
          setLaunchError("");
          setLoadError("");
          persistEnabledRef.current = false;
          // Fresh New automation — do not revive a prior thread.
          clearChatBundle(AUTOMATION_CHAT_PENDING_KEY);
          setChat([]);
          setGuide(newGuideSession());
          chatRef.current = [];
          guideRef.current = newGuideSession();
          chatHydratedRef.current = true;

          try {
            const [autoList, dripList] = await Promise.all([
              fetchAutomations().catch(() => []),
              fetchDripCampaigns("drip").catch(() => []),
            ]);
            const existingNames = new Set<string>();
            for (const item of autoList) {
              if (item.name) existingNames.add(item.name.trim().toLowerCase());
            }
            for (const item of dripList) {
              if (item.name) existingNames.add(item.name.trim().toLowerCase());
            }

            let defaultName = "Untitled automation";
            if (existingNames.has(defaultName.toLowerCase())) {
              let count = 2;
              while (existingNames.has(`untitled automation ${count}`.toLowerCase())) {
                count += 1;
              }
              defaultName = `Untitled automation ${count}`;
            }
            if (!cancelled) {
              setName(defaultName);
            }
          } catch {
            if (!cancelled) {
              setName("Untitled automation");
            }
          }
          return;
        }

        // Edit / view: prefer URL id only (session is only for drip return attach).
        const id = automationId;
        if (!id) {
          throw new Error("Missing automation id");
        }

        const record = await fetchAutomation(id);
        if (!record) {
          throw new Error("Automation not found");
        }
        if (cancelled) {
          return;
        }

        setRecordId(record.id);
        setStatus(record.status || "draft");
        setName(record.name || "Untitled automation");
        setKind(record.kind === "oneone" ? "oneone" : "drip");
        const loadedSteps = (record.steps || []).map((step, index) =>
          index === 0
            ? step
            : {
                ...step,
                waitHours: Math.max(0, Math.min(23, Number(step.waitHours) || 0)),
                waitDays: Math.max(0, Number(step.waitDays) || 0),
              },
        );
        setSteps(loadedSteps);
        const resumePhase =
          record.status === "draft"
            ? resumeWizardFromSteps(loadedSteps)
            : "closed";
        if (loadedSteps[0]) {
          const fuDraft = loadedSteps.find(
            (step, index) => index > 0 && !step.campaignId,
          );
          setSelectedStepId(
            resumePhase.startsWith("fu_") && fuDraft
              ? fuDraft.id
              : loadedSteps[0].id,
          );
          setWizardPhase(resumePhase);
          if (
            resumePhase === "past_select" ||
            resumePhase === "past_freq" ||
            resumePhase === "past_type" ||
            resumePhase === "past_setup"
          ) {
            void loadPastCampaigns();
          }
        } else {
          setSelectedStepId(null);
          setWizardPhase(record.status === "draft" ? "start" : "closed");
        }
        await hydrateStepCampaigns(loadedSteps);

        // Only attach a returned campaign when the URL says so (Return to Automation).
        if (qId) {
          await attachReturnedCampaign(
            record.steps || [],
            qId,
            qKind,
            qStepId,
          );
        }

        // Re-open campaign setup after create → /[id] remount (wizard "Set up campaign").
        try {
          const raw = sessionStorage.getItem(AUTOMATION_LINK_KEY);
          if (raw && !cancelled) {
            const link = JSON.parse(raw) as {
              campaignId?: string;
              kind?: CampaignKind;
              stepId?: string;
              followUp?: boolean;
              automationId?: string;
              openSetup?: boolean;
              pastAudience?: {
                campaignName: string;
                engagement: EngagementKind;
              };
            };
            if (
              link.openSetup &&
              link.automationId === id &&
              link.campaignId &&
              link.stepId &&
              (link.kind === "drip" || link.kind === "oneone")
            ) {
              setCampaignSetup({
                campaignId: link.campaignId,
                kind: link.kind,
                stepId: link.stepId,
                followUp: Boolean(link.followUp),
                pastAudience: link.pastAudience,
              });
              setSelectedStepId(link.stepId);
              setWizardPhase("closed");
            }
          }
        } catch {
          /* ignore */
        }

        persistEnabledRef.current = record.status === "draft";
        if (
          !cancelled &&
          record.status === "draft" &&
          searchParams.get("reschedule") === "1"
        ) {
          setLaunchNotice(
            "Editing unlocked. Change the flow or campaign setup, then Schedule again.",
          );
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Failed to load automation",
          );
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
    // Remount when History hits New automation (?new=) or Edit (?reschedule=).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, automationId, searchParams.get("new"), searchParams.get("reschedule")]);

  useEffect(() => {
    if (!recordId || !persistEnabledRef.current || bootstrapping || locked) {
      return;
    }
    const timer = window.setTimeout(() => {
      void patchAutomation(recordId, {
        name: name.trim() || "Untitled automation",
        kind: steps[0] ? stepKind(steps[0]) : kind,
        steps,
        status: "draft",
      }).catch(() => {
        /* keep local draft; next change retries */
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [recordId, name, kind, steps, bootstrapping, locked]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, chatting]);

  // Restore chat after create → /automation/[id] remount (was wiping the thread).
  useEffect(() => {
    if (chatHydratedRef.current) {
      return;
    }
    chatHydratedRef.current = true;
    const pending = readChatBundle(AUTOMATION_CHAT_PENDING_KEY);
    const byId = recordId
      ? readChatBundle(`${AUTOMATION_CHAT_KEY}:${recordId}`)
      : null;
    const bundle =
      pending && (!byId || pending.savedAt >= byId.savedAt) ? pending : byId;
    if (!bundle || bundle.chat.length === 0) {
      return;
    }
    setChat(bundle.chat);
    setGuide(bundle.guide || newGuideSession());
    if (recordId && pending) {
      writeChatBundle(`${AUTOMATION_CHAT_KEY}:${recordId}`, bundle.chat, bundle.guide);
      clearChatBundle(AUTOMATION_CHAT_PENDING_KEY);
    }
  }, [recordId]);

  // Keep chat durable while guiding / talking.
  useEffect(() => {
    if (!chatHydratedRef.current) {
      return;
    }
    if (chat.length === 0 && !guide.active) {
      return;
    }
    const key = recordId
      ? `${AUTOMATION_CHAT_KEY}:${recordId}`
      : AUTOMATION_CHAT_PENDING_KEY;
    writeChatBundle(key, chat, guide);
  }, [chat, guide, recordId]);

  useEffect(() => {
    if (status !== "running" && status !== "scheduled") {
      return;
    }
    const tick = () => {
      void fetch("/api/campaigns/process-due", { method: "POST" });
    };
    tick();
    const timer = window.setInterval(tick, 15000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (!wizardOpen) {
      return;
    }
    addWrapRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [wizardOpen, wizardPhase]);

  useEffect(() => {
    if (
      wizardPhase !== "past_select" &&
      wizardPhase !== "past_freq" &&
      wizardPhase !== "past_type" &&
      wizardPhase !== "past_setup"
    ) {
      return;
    }
    void loadPastCampaigns();
  }, [wizardPhase]);

  // Drop stale “finish sender and design” banner once Email 1 is actually ready.
  useEffect(() => {
    if (!firstReady) {
      return;
    }
    if (
      !launchNotice.includes("Finish sender and design") &&
      !launchNotice.includes("Finish sender")
    ) {
      return;
    }
    setLaunchNotice(
      "Email 1 is set up. You can add another campaign or launch.",
    );
  }, [firstReady, launchNotice]);

  const ensuringRef = useRef<Promise<string> | null>(null);

  function flushAutomationChat(id?: string) {
    const target = id || recordId;
    writeChatBundle(
      AUTOMATION_CHAT_PENDING_KEY,
      chatRef.current,
      guideRef.current,
    );
    if (target) {
      writeChatBundle(
        `${AUTOMATION_CHAT_KEY}:${target}`,
        chatRef.current,
        guideRef.current,
      );
    }
  }

  /** Navigate create → /[id] only after chat/steps are flushed (avoids wipe after ~step 3). */
  function navigateToSavedAutomation(id: string) {
    flushAutomationChat(id);
    if (automationId === id) {
      return;
    }
    router.replace(portalAutomationRoute(id));
  }

  async function ensureAutomationRecord(nextSteps?: AutoStep[]): Promise<string> {
    if (recordIdRef.current) {
      return recordIdRef.current;
    }
    const initialSteps = nextSteps ?? steps;
    if (initialSteps.length === 0) {
      throw new Error("Add an email step before this automation is saved to history.");
    }
    if (ensuringRef.current) {
      return ensuringRef.current;
    }
    ensuringRef.current = (async () => {
      if (recordIdRef.current) {
        return recordIdRef.current;
      }
      const created = await createAutomation({
        name: name.trim() || "Untitled automation",
        kind,
        steps: initialSteps,
        status: "draft",
      });
      if (created.name && created.name !== name) {
        setName(created.name);
      }
      recordIdRef.current = created.id;
      setRecordId(created.id);
      persistEnabledRef.current = true;
      flushAutomationChat(created.id);
      return created.id;
    })();
    try {
      return await ensuringRef.current;
    } finally {
      ensuringRef.current = null;
    }
  }

  async function loadPastCampaigns() {
    setLoadingPast(true);
    try {
      const [drip, oneone] = await Promise.all([
        fetchDripCampaigns("drip"),
        fetchDripCampaigns("oneone"),
      ]);
      const merged = [...drip, ...oneone].filter(
        (campaign) =>
          campaign.status === "sent" ||
          campaign.opens > 0 ||
          campaign.clicks > 0,
      );
      setPastCampaigns(merged);
    } finally {
      setLoadingPast(false);
    }
  }

  function patchStep(stepId: string, patch: Partial<AutoStep>) {
    setSteps((prev) =>
      prev.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    );
  }

  function beginStartChoice(source: WhoSource) {
    if (locked) {
      return;
    }
    setLoadError("");
    const step =
      source === "past"
        ? newEmailStep({
            whoSource: "past",
            waitDays: 0,
            waitHours: 0,
            engagement: undefined,
            campaignKind: undefined,
          })
        : newEmailStep({
            whoSource: "current",
            waitDays: 0,
            waitHours: 0,
            engagement: undefined,
            campaignKind: undefined,
          });
    const next = [step];
    setSteps(next);
    setSelectedStepId(step.id);
    setCampaignByStep({});
    setDraftPastId("");
    setDraftEngagement("opens_or_clicks");
    setDraftStepKind("drip");
    // Go to the next question immediately — do not save/navigate yet
    // (that was closing the wizard before past_select could show).
    setWizardPhase(source === "past" ? "past_select" : "new_type");
    if (source === "past") {
      void loadPastCampaigns();
    }
  }

  function selectPastForFirst(campaign: DripCampaign) {
    if (!firstStep || locked) {
      return;
    }
    const resolvedKind = campaignKindOf(campaign);
    const changedSource = firstStep.pastCampaignId !== campaign.id;
    setDraftPastId(pastCampaignKey(campaign));
    if (changedSource) {
      unlinkCampaignIfNeeded(firstStep.id);
    }
    const patched: AutoStep = {
      ...firstStep,
      whoSource: "past",
      pastCampaignId: campaign.id,
      pastCampaignName: campaign.name,
      pastCampaignKind: resolvedKind,
      ...(changedSource
        ? {
            engagement: undefined,
            campaignKind: undefined,
            campaignId: undefined,
          }
        : {}),
    };
    const nextSteps = steps.map((step) =>
      step.id === firstStep.id ? patched : step,
    );
    setSteps(nextSteps);
    if (changedSource) {
      setCampaignByStep((current) => {
        const next = { ...current };
        delete next[firstStep.id];
        return next;
      });
    }
    // Always advance to the audience question after a pick (including re-pick).
    setWizardPhase(patched.engagement ? "closed" : "past_freq");
    // Persist after the past campaign is chosen so history has a record.
    // Navigate only after create — resumeWizardFromSteps restores past_freq.
    void (async () => {
      try {
        const id = await ensureAutomationRecord(nextSteps);
        navigateToSavedAutomation(id);
      } catch (error) {
        setLoadError(
          error instanceof Error ? error.message : "Failed to save automation",
        );
      }
    })();
  }

  function beginFollowUpWizard() {
    if (locked) {
      return;
    }
    const synced = syncCampaignIdsFromCache();
    if (synced.length === 0) {
      setWizardPhase("start");
      return;
    }
    const last = synced[synced.length - 1];
    const lastCampaign = last.campaignId
      ? campaignByStep[last.id]
      : undefined;
    if (!last.campaignId && !lastCampaign) {
      setLoadError("Finish setting up the current campaign first.");
      return;
    }
    // Drop any half-built follow-up draft with no campaign before adding a new one.
    const base = synced.filter(
      (step, index) => index === 0 || Boolean(step.campaignId) || Boolean(campaignByStep[step.id]),
    );
    setLoadError("");
    const step = newEmailStep({
      whoSource: "current",
      campaignKind: undefined,
      engagement: undefined,
      waitDays: undefined,
      waitHours: undefined,
    });
    setSteps([...base, step]);
    setSelectedStepId(step.id);
    setDraftStepKind("drip");
    setDraftEngagement("opens_or_clicks");
    setDraftWaitDays("1");
    setDraftWaitHours("0");
    setDraftWho("current");
    setWizardPhase("fu_type");
  }

  function clearStepCampaign(stepId: string) {
    patchStep(stepId, { campaignId: undefined });
    setCampaignByStep((current) => {
      const next = { ...current };
      delete next[stepId];
      return next;
    });
  }

  /** Keep step.campaignId in sync with loaded campaigns (edit must not orphan Ready cards). */
  function syncCampaignIdsFromCache(list: AutoStep[] = steps): AutoStep[] {
    let changed = false;
    const next = list.map((step) => {
      const cached = campaignByStep[step.id];
      if (!step.campaignId && cached?.id) {
        changed = true;
        return {
          ...step,
          campaignId: cached.id,
          campaignKind: campaignKindOf(cached),
        };
      }
      return step;
    });
    if (changed) {
      setSteps(next);
    }
    return next;
  }

  function openPhase(phase: WizardPhase, stepId?: string) {
    if (locked) {
      return;
    }
    setLoadError("");
    if (stepId) {
      setSelectedStepId(stepId);
    }
    // Do not unlink campaigns just for opening an editor — only clear when
    // the user actually changes a committed value (see select/patch handlers).
    setWizardPhase(phase);
    if (
      phase === "past_select" ||
      phase === "past_freq" ||
      phase === "past_type" ||
      phase === "past_setup"
    ) {
      void loadPastCampaigns();
    }
  }

  function unlinkCampaignIfNeeded(stepId: string) {
    const step = steps.find((item) => item.id === stepId);
    if (step?.campaignId) {
      clearStepCampaign(stepId);
    }
  }

  function wizardBack() {
    if (locked) {
      return;
    }
    switch (wizardPhase) {
      case "past_select":
        setSteps([]);
        setSelectedStepId(null);
        setCampaignByStep({});
        setWizardPhase("start");
        break;
      case "past_freq":
        setWizardPhase("past_select");
        break;
      case "past_type":
        setWizardPhase("past_freq");
        break;
      case "past_setup":
        setWizardPhase("past_type");
        break;
      case "new_type":
        setSteps([]);
        setSelectedStepId(null);
        setCampaignByStep({});
        setWizardPhase("start");
        break;
      case "new_setup":
        setWizardPhase("new_type");
        break;
      case "fu_type": {
        const last = steps[steps.length - 1];
        if (last && !last.campaignId && !typeChosen(last)) {
          setSteps((prev) => prev.slice(0, -1));
        }
        setWizardPhase("closed");
        break;
      }
      case "fu_freq":
        setWizardPhase("fu_type");
        break;
      case "fu_gap":
        setWizardPhase("fu_freq");
        break;
      case "fu_setup":
        setWizardPhase("fu_gap");
        break;
      default:
        setWizardPhase(steps.length === 0 ? "start" : "closed");
    }
  }

  async function createAndOpenCampaign(
    step: AutoStep,
    stepsSnapshot?: AutoStep[],
    options?: { openSetup?: boolean; navigate?: boolean },
  ) {
    if (creating || locked) {
      return;
    }
    const openSetup = options?.openSetup !== false;
    const shouldNavigate = options?.navigate !== false;
    setCreating(true);
    setLoadError("");
    try {
      const workingSteps = stepsSnapshot ?? steps;
      const stepIndex = workingSteps.findIndex((item) => item.id === step.id);
      if (stepIndex < 0) {
        throw new Error("Could not find this email step in the automation.");
      }
      const isFollowUp = stepIndex > 0;
      const campaignKind = stepKind(step);
      const seededSteps = workingSteps.map((item) =>
        item.id === step.id ? { ...item, ...step, campaignKind } : item,
      );
      const autoId = await ensureAutomationRecord(seededSteps);
      const desiredCampaignName =
        stepIndex <= 0
          ? name.trim() || "Untitled automation"
          : `${name.trim() || "Untitled"} · step ${stepIndex + 1}`;

      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: desiredCampaignName,
          kind: campaignKind,
          autoNumber: true,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.id) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to create campaign",
        );
      }

      if (data.name && data.name !== desiredCampaignName && stepIndex <= 0) {
        setName(data.name);
      }

      const existingTags = Array.isArray(data.tags) ? data.tags : [];
      const patch: Partial<DripCampaign> = {
        tags: [
          ...new Set([
            ...existingTags,
            AUTOMATION_TAG,
            ...(isFollowUp ? [AUTOMATION_FOLLOW_UP_TAG] : []),
          ]),
        ],
      };
      if (isFollowUp) {
        if (firstCampaign?.senderId && firstCampaign.senderEmail) {
          patch.senderId = firstCampaign.senderId;
          patch.senderEmail = firstCampaign.senderEmail;
          patch.senderName = firstCampaign.senderName || firstCampaign.senderEmail;
        } else {
          throw new Error(
            "Step 1 needs a sender before creating the follow-up campaign.",
          );
        }
        // Recipients stay empty — filled later from opens/clicks.
        patch.recipientMode = "individual";
        patch.individualContacts = [];
        patch.listId = "";
        patch.listName = "";
      } else if (
        step.whoSource === "past" &&
        step.pastCampaignId &&
        step.engagement
      ) {
        const engagers = await fetchEngagerContacts(
          step.pastCampaignId,
          step.pastCampaignKind === "oneone" ? "oneone" : "drip",
          step.engagement,
        );
        if (engagers.length === 0) {
          throw new Error(
            "No openers or clickers found for that past campaign yet.",
          );
        }
        patch.recipientMode = "individual";
        patch.individualContacts = engagers;
        patch.listId = "";
        patch.listName = "";
      }

      await patchDripCampaign(data.id, patch, campaignKind);

      const targetStepId = step.id;
      const linkedSteps = seededSteps.map((item) =>
        item.id === targetStepId
          ? { ...item, campaignId: data.id as string, campaignKind }
          : item,
      );
      setSteps(linkedSteps);
      // Persist campaign link before any remount so bootstrap sees campaignId.
      await patchAutomation(autoId, {
        name:
          data.name && stepIndex <= 0
            ? data.name
            : name.trim() || "Untitled automation",
        kind: campaignKind,
        steps: linkedSteps,
        status: "draft",
      });
      // Cache under THIS step only — never reuse Email 1's entry for follow-ups.
      const createdCampaign =
        (await fetchDripCampaign(data.id, campaignKind)) ||
        ({
          id: data.id,
          name: data.name || desiredCampaignName,
          kind: campaignKind,
        } as DripCampaign);
      setCampaignByStep((prev) => ({
        ...prev,
        [targetStepId]: createdCampaign,
      }));
      setWizardPhase("closed");

      const pastAudience =
        !isFollowUp && step.whoSource === "past" && step.pastCampaignName
          ? {
              campaignName: step.pastCampaignName,
              engagement: (step.engagement ||
                "opens_or_clicks") as EngagementKind,
            }
          : undefined;

      sessionStorage.setItem(
        AUTOMATION_LINK_KEY,
        JSON.stringify({
          campaignId: data.id,
          kind: campaignKind,
          stepId: targetStepId,
          followUp: isFollowUp,
          automationId: autoId,
          openSetup,
          pastAudience,
        }),
      );

      // Notice is set when they return from setup (closeCampaignSetup),
      // not here — otherwise it lingers after sender/design are done.

      setSelectedStepId(targetStepId);
      if (openSetup) {
        setCampaignSetup({
          campaignId: data.id,
          kind: campaignKind,
          stepId: targetStepId,
          followUp: isFollowUp,
          pastAudience,
        });
      }
      flushAutomationChat(autoId);
      if (shouldNavigate) {
        navigateToSavedAutomation(autoId);
      }
      return data.id as string;
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Failed to create campaign",
      );
      return null;
    } finally {
      setCreating(false);
    }
  }

  function pastAudienceForStep(step: AutoStep) {
    if (step.whoSource !== "past" || !step.pastCampaignName) {
      return undefined;
    }
    return {
      campaignName: step.pastCampaignName,
      engagement: (step.engagement || "opens_or_clicks") as EngagementKind,
    };
  }

  function resolveStepCampaignId(step: AutoStep) {
    return step.campaignId || campaignByStep[step.id]?.id || "";
  }

  function openStepCampaign(step: AutoStep, stepIndex?: number) {
    // Completed: view-only. Scheduled/running: open campaign report/setup
    // (edit the flow itself via Edit flow → draft first).
    if (status === "completed") {
      return;
    }
    const index =
      stepIndex ?? steps.findIndex((item) => item.id === step.id);
    let campaignId = resolveStepCampaignId(step);
    if (!campaignId) {
      return;
    }
    const firstId = steps[0]
      ? resolveStepCampaignId(steps[0])
      : "";
    // Follow-up must never open Email 1's campaign (broken shared id).
    if (index > 0 && firstId && campaignId === firstId) {
      unlinkCampaignIfNeeded(step.id);
      setSelectedStepId(step.id);
      setWizardPhase("fu_setup");
      setLoadError(
        "That step was linked to Email 1 by mistake. Set up this campaign again.",
      );
      return;
    }
    const cached = campaignByStep[step.id];
    const campaignKind =
      step.campaignKind === "oneone" || cached?.kind === "oneone"
        ? "oneone"
        : "drip";
    const isFollowUp =
      index > 0 ||
      Boolean(cached?.tags?.includes(AUTOMATION_FOLLOW_UP_TAG));
    if (!step.campaignId) {
      patchStep(step.id, { campaignId, campaignKind });
    }
    setSelectedStepId(step.id);
    sessionStorage.setItem(
      AUTOMATION_LINK_KEY,
      JSON.stringify({
        campaignId,
        kind: campaignKind,
        stepId: step.id,
        followUp: isFollowUp,
        automationId: recordId || undefined,
      }),
    );
    setCampaignSetup({
      campaignId,
      kind: campaignKind,
      stepId: step.id,
      followUp: isFollowUp,
      pastAudience: isFollowUp ? undefined : pastAudienceForStep(step),
    });
  }

  async function closeCampaignSetup() {
    const open = campaignSetup;
    setCampaignSetup(null);
    setWizardPhase("closed");
    try {
      sessionStorage.removeItem(AUTOMATION_LINK_KEY);
    } catch {
      /* ignore */
    }
    if (!open) {
      return;
    }
    try {
      const campaign = await fetchDripCampaign(open.campaignId, open.kind);
      if (campaign) {
        setCampaignByStep((prev) => ({ ...prev, [open.stepId]: campaign }));
        const ready =
          campaign.status === "sent" ||
          readinessGaps(campaign, {
            audienceOptional: open.followUp,
          }).length === 0;
        if (ready) {
          setLaunchNotice(
            open.followUp
              ? "Follow-up campaign is set up."
              : "Email 1 is set up. You can add another campaign or launch.",
          );
        } else {
          // Still incomplete — drop the stale “just created” banner.
          setLaunchNotice("");
        }
      } else {
        setLaunchNotice("");
      }
    } catch {
      setLaunchNotice("");
    }
  }

  async function setupWizardCampaign() {
    if (locked || creating) {
      return;
    }
    setLoadError("");
    if (wizardPhase === "past_setup" || wizardPhase === "new_setup") {
      if (!firstStep) {
        setLoadError("Start by choosing Past campaign or New campaign.");
        return;
      }
      if (wizardPhase === "past_setup") {
        if (!firstStep.pastCampaignId) {
          setLoadError("Pick a past campaign first.");
          setWizardPhase("past_select");
          return;
        }
        if (!firstStep.engagement) {
          setLoadError("Pick open, click, or both.");
          setWizardPhase("past_freq");
          return;
        }
      }
      // Only Email 1 — never create follow-ups through this branch.
      if (resolveStepCampaignId(firstStep)) {
        openStepCampaign(firstStep, 0);
        return;
      }
      const readyStep = { ...firstStep, campaignKind: draftStepKind };
      const nextSteps = steps.map((item) =>
        item.id === readyStep.id ? readyStep : item,
      );
      setSteps(nextSteps);
      setKind(draftStepKind);
      await createAndOpenCampaign(readyStep, nextSteps);
      return;
    }
    if (wizardPhase === "fu_setup") {
      const wait = normalizeWait(
        Number(draftWaitDays) || 0,
        Number(draftWaitHours) || 0,
      );
      const patch = {
        campaignKind: draftStepKind,
        whoSource: "current" as const,
        engagement: draftEngagement,
        waitDays: wait.waitDays,
        waitHours: wait.waitHours,
        pastCampaignId: undefined,
        pastCampaignName: undefined,
        pastCampaignKind: undefined,
      };
      // Prefer the selected follow-up step; never fall back to Email 1.
      const selectedIndex = selectedStepId
        ? steps.findIndex((item) => item.id === selectedStepId)
        : -1;
      const selectedFollowUp =
        selectedIndex > 0 ? steps[selectedIndex] : null;
      const draftFollowUp =
        selectedFollowUp ||
        [...steps]
          .map((item, index) => ({ item, index }))
          .reverse()
          .find(
            ({ item, index }) =>
              index > 0 && !resolveStepCampaignId(item),
          )?.item ||
        null;

      if (draftFollowUp && resolveStepCampaignId(draftFollowUp)) {
        openStepCampaign(
          draftFollowUp,
          steps.findIndex((item) => item.id === draftFollowUp.id),
        );
        return;
      }

      const step = draftFollowUp
        ? { ...draftFollowUp, ...patch }
        : newEmailStep(patch);
      const nextSteps = draftFollowUp
        ? steps.map((item) => (item.id === step.id ? step : item))
        : [...steps, step];
      setSteps(nextSteps);
      setSelectedStepId(step.id);
      await createAndOpenCampaign(step, nextSteps);
    }
  }

  function pushAssistant(
    content: string,
    choices?: ChatChoice[],
    guideStep?: GuideSession["step"],
  ) {
    setChat((prev) => {
      const next: ChatTurn[] = [
        ...prev,
        {
          role: "assistant",
          content,
          choices,
          guideStep,
        },
      ];
      chatRef.current = next;
      return next;
    });
  }

  function lockChoiceOnTurn(turnIndex: number, choiceId: string) {
    setChat((prev) => {
      const next = prev.map((turn, index) =>
        index === turnIndex ? { ...turn, selectedChoiceId: choiceId } : turn,
      );
      chatRef.current = next;
      return next;
    });
  }

  async function loadChatCatalogs() {
    const [sendersRes, listsRes] = await Promise.all([
      fetch("/api/smtp/senders", { cache: "no-store" }).catch(() => null),
      fetch("/api/crm/lists", { cache: "no-store" }).catch(() => null),
    ]);
    const sendersData = sendersRes ? await sendersRes.json().catch(() => null) : null;
    const listsData = listsRes ? await listsRes.json().catch(() => null) : null;
    const senders = Array.isArray(sendersData)
      ? sendersData.map((row: { id?: string; fromEmail?: string; fromName?: string; email?: string; name?: string }) => ({
          id: String(row.id || ""),
          fromEmail: String(row.fromEmail || row.email || ""),
          fromName: String(row.fromName || row.name || ""),
        })).filter((row: { id: string; fromEmail: string }) => row.id && row.fromEmail)
      : [];
    const lists = Array.isArray(listsData)
      ? listsData.map((row: { id?: string; name?: string; contactCount?: number; contactsCount?: number }) => ({
          id: String(row.id || ""),
          name: String(row.name || "Untitled list"),
          contactCount: Number(row.contactCount ?? row.contactsCount ?? 0) || 0,
        })).filter((row: { id: string }) => row.id)
      : [];
    setChatSenders(senders);
    setChatLists(lists);
    return { senders, lists };
  }

  async function askSenderStep(forFollowUp: boolean) {
    const { senders } = await loadChatCatalogs();
    if (senders.length === 0) {
      pushAssistant(
        "No senders found. Add a sender under SMTP & Senders, then say “Set up this campaign” again.",
      );
      setGuide({ ...newGuideSession(), active: false, step: "idle" });
      return;
    }
    const step = forFollowUp ? "sender" : "sender";
    setGuide((g) => ({ ...g, step: "sender", awaitingText: undefined }));
    pushAssistant(
      forFollowUp
        ? "Pick a sender for this follow-up (or use Email 1’s sender from the list)."
        : "Who should send Email 1? Pick a sender:",
      senders.map((s) => ({
        id: `sender:${s.id}`,
        label: s.fromName ? `${s.fromName} · ${s.fromEmail}` : s.fromEmail,
      })),
      step,
    );
  }

  async function askRecipientsStep() {
    const { lists } = await loadChatCatalogs();
    if (lists.length === 0) {
      pushAssistant(
        "No lists found. Create a list under Contacts → Lists, then continue setup.",
        [{ id: "skip_list_retry", label: "Retry lists" }],
        "recipients",
      );
      setGuide((g) => ({ ...g, step: "recipients" }));
      return;
    }
    setGuide((g) => ({ ...g, step: "recipients", awaitingText: undefined }));
    pushAssistant(
      "Which list should receive Email 1? Select one:",
      lists.slice(0, 40).map((list) => ({
        id: `list:${list.id}`,
        label: list.name,
        description:
          list.contactCount > 0 ? `${list.contactCount} contacts` : undefined,
      })),
      "recipients",
    );
  }

  function askSubjectStep(forFollowUp: boolean) {
    setGuide((g) => ({
      ...g,
      step: forFollowUp ? "fu_subject" : "subject",
      awaitingText: undefined,
    }));
    pushAssistant(
      forFollowUp
        ? "Subject for the next email — pick one or type your own:"
        : "Subject line for Email 1 — pick one or type your own:",
      subjectQuickChoices(),
      forFollowUp ? "fu_subject" : "subject",
    );
  }

  function askDesignStep(forFollowUp: boolean) {
    setGuide((g) => ({
      ...g,
      step: forFollowUp ? "fu_design" : "design",
      awaitingText: undefined,
    }));
    pushAssistant(
      "How should we add the email HTML?",
      designChoices(),
      forFollowUp ? "fu_design" : "design",
    );
  }

  async function patchActiveCampaign(patch: Partial<DripCampaign>) {
    const step = steps[guideRef.current.emailIndex] ?? steps[steps.length - 1];
    if (!step?.campaignId) {
      throw new Error("Create the campaign step first.");
    }
    const kind = stepKind(step);
    const updated = await patchDripCampaign(step.campaignId, patch, kind);
    setCampaignByStep((prev) => ({ ...prev, [step.id]: updated }));
    return updated;
  }

  async function ensureGuideCampaign(stepOverride?: AutoStep) {
    const step = stepOverride ?? steps[guideRef.current.emailIndex] ?? firstStep;
    if (!step) {
      throw new Error("Start the flow first.");
    }
    if (step.campaignId) {
      if (!campaignByStep[step.id]) {
        const existing = await fetchDripCampaign(
          step.campaignId,
          stepKind(step),
        );
        if (existing) {
          setCampaignByStep((prev) => ({ ...prev, [step.id]: existing }));
        }
      }
      return step.campaignId;
    }
    const nextSteps = steps.map((item) =>
      item.id === step.id ? { ...step, campaignKind: stepKind(step) } : item,
    );
    setSteps(nextSteps);
    const id = await createAndOpenCampaign(
      { ...step, campaignKind: stepKind(step) },
      nextSteps,
      { openSetup: false, navigate: false },
    );
    if (!id) {
      throw new Error("Failed to create campaign for this step.");
    }
    return id;
  }

  async function beginGuidedSetup() {
    setGuide({ active: true, step: "start", emailIndex: 0, awaitingText: undefined });
    setSidebarOpen(true);
    pushAssistant(
      "Let’s set up this automation in chat. Tap a choice below for each step (sender, recipients, subject, HTML, gaps).\n\nHow should Email 1 start?",
      startGuideChoices(),
      "start",
    );
  }

  async function handleGuideText(message: string) {
    const session = guideRef.current;
    if (!session.active || !session.awaitingText) {
      return false;
    }
    setChatting(true);
    setChatError("");
    try {
      if (session.awaitingText === "subject" || session.awaitingText === "fu_subject") {
        await ensureGuideCampaign();
        await patchActiveCampaign({ subject: message });
        pushAssistant(`Subject saved: “${message}”.`);
        askDesignStep(session.awaitingText === "fu_subject");
        return true;
      }
      if (session.awaitingText === "html" || session.awaitingText === "fu_html") {
        await ensureGuideCampaign();
        await patchActiveCampaign({
          designHtml: message,
          hasDesign: true,
        });
        pushAssistant("HTML saved on the campaign.");
        if (session.awaitingText === "fu_html") {
          setGuide({ active: true, step: "fu_ask", emailIndex: steps.length - 1 });
          pushAssistant(
            "Follow-up email is set up. Add another, or finish?",
            afterEmailChoices(),
            "fu_ask",
          );
        } else {
          setGuide((g) => ({ ...g, step: "fu_ask", awaitingText: undefined }));
          pushAssistant(
            "Email 1 is set up. Add another email, or finish for now?",
            afterEmailChoices(),
            "fu_ask",
          );
        }
        return true;
      }
      if (session.awaitingText === "fu_gap_custom") {
        const days = Math.max(0, Math.floor(Number(message) || 0));
        const step = steps[steps.length - 1];
        if (step) {
          patchStep(step.id, { waitDays: days, waitHours: 0 });
        }
        setGuide((g) => ({
          ...g,
          step: "fu_subject",
          awaitingText: undefined,
          emailIndex: Math.max(0, steps.length - 1),
        }));
        pushAssistant(`Gap set to ${days} day${days === 1 ? "" : "s"}.`);
        await ensureGuideCampaign(step ? { ...step, waitDays: days } : undefined);
        askSubjectStep(true);
        return true;
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Setup failed");
    } finally {
      setChatting(false);
    }
    return true;
  }

  async function handleChatChoice(turnIndex: number, choice: ChatChoice) {
    if (chatting || locked) {
      return;
    }
    const turn = chat[turnIndex];
    if (!turn || turn.selectedChoiceId) {
      return;
    }
    lockChoiceOnTurn(turnIndex, choice.id);
    setChat((prev) => {
      const next: ChatTurn[] = [...prev, { role: "user", content: choice.label }];
      chatRef.current = next;
      return next;
    });
    setChatting(true);
    setChatError("");
    setLoadError("");
    try {
      const id = choice.id;
      const session = guideRef.current;

      if (id === "past") {
        beginStartChoice("past");
        await loadPastCampaigns();
        const campaigns =
          pastCampaigns.length > 0
            ? pastCampaigns
            : await (async () => {
                const [drip, oneone] = await Promise.all([
                  fetchDripCampaigns("drip"),
                  fetchDripCampaigns("oneone"),
                ]);
                const merged = [...drip, ...oneone].filter(
                  (c) =>
                    c.status === "sent" || c.opens > 0 || c.clicks > 0,
                );
                setPastCampaigns(merged);
                return merged;
              })();
        setGuide({ active: true, step: "past_select", emailIndex: 0 });
        if (campaigns.length === 0) {
          pushAssistant(
            "No sent campaigns with opens/clicks yet. Choose New campaign instead.",
            startGuideChoices(),
            "start",
          );
          return;
        }
        pushAssistant(
          "Select the past campaign. Engagers become Email 1 recipients.",
          campaigns.slice(0, 40).map((c) => ({
            id: `past:${pastCampaignKey(c)}`,
            label: c.name,
            description: `${c.opens} opens · ${c.clicks} clicks`,
          })),
          "past_select",
        );
        return;
      }

      if (id === "new") {
        beginStartChoice("current");
        setGuide({ active: true, step: "type", emailIndex: 0 });
        pushAssistant("Campaign type for Email 1?", typeChoices(), "type");
        return;
      }

      if (id.startsWith("past:")) {
        const key = id.slice("past:".length);
        const picked = findPastCampaignByKey(key, pastCampaigns);
        if (!picked) {
          throw new Error("Past campaign not found.");
        }
        selectPastForFirst(picked);
        setGuide({ active: true, step: "past_freq", emailIndex: 0 });
        pushAssistant(
          "Who from that campaign should get Email 1?",
          engagementChoices(),
          "past_freq",
        );
        return;
      }

      if (id === "opens" || id === "clicks" || id === "opens_or_clicks") {
        // Follow-up audience (after Email 1 is already configured).
        if (session.step === "fu_freq") {
          const step = steps[steps.length - 1];
          if (step) {
            patchStep(step.id, { engagement: id, whoSource: "current" });
          }
          setDraftEngagement(id);
          setGuide((g) => ({ ...g, step: "fu_gap" }));
          pushAssistant(
            "How many days after the current email should this send?",
            gapChoices(),
            "fu_gap",
          );
          return;
        }
        if (firstStep) {
          patchStep(firstStep.id, { engagement: id });
        }
        setDraftEngagement(id);
        setGuide({ active: true, step: "type", emailIndex: 0 });
        setWizardPhase("past_type");
        pushAssistant("Campaign type for Email 1?", typeChoices(), "type");
        return;
      }

      if (id === "start_guide") {
        await beginGuidedSetup();
        return;
      }

      if (id === "drip" || id === "oneone") {
        const kindNext = id as CampaignKind;
        setDraftStepKind(kindNext);
        setKind(kindNext);
        const isFollowUp = session.step === "fu_type" || session.emailIndex > 0;
        if (isFollowUp) {
          const step = steps[steps.length - 1];
          if (step) {
            patchStep(step.id, { campaignKind: kindNext });
          }
          setGuide((g) => ({ ...g, step: "fu_freq" }));
          pushAssistant(
            "Who from the current campaign should get this email?",
            engagementChoices(),
            "fu_freq",
          );
          return;
        }
        if (firstStep) {
          patchStep(firstStep.id, { campaignKind: kindNext });
        }
        const readyStep = {
          ...(firstStep || newEmailStep({ whoSource: "current" })),
          campaignKind: kindNext,
        };
        const nextSteps = firstStep
          ? steps.map((item) =>
              item.id === firstStep.id ? readyStep : item,
            )
          : [readyStep];
        setSteps(nextSteps);
        setWizardPhase("closed");
        // Create + link campaign first; navigate only after sender prompt is in chat
        // (early replace was wiping the thread after ~step 3).
        await createAndOpenCampaign(readyStep, nextSteps, {
          openSetup: false,
          navigate: false,
        });
        const autoId = recordIdRef.current;
        if (!autoId) {
          throw new Error("Automation was not saved.");
        }
        const senderGuide: GuideSession = {
          active: true,
          step: "sender",
          emailIndex: 0,
        };
        guideRef.current = senderGuide;
        setGuide(senderGuide);
        await askSenderStep(false);
        navigateToSavedAutomation(autoId);
        return;
      }

      if (id.startsWith("sender:")) {
        const senderId = id.slice("sender:".length);
        const sender =
          chatSenders.find((s) => s.id === senderId) ||
          (await loadChatCatalogs()).senders.find((s) => s.id === senderId);
        if (!sender) {
          throw new Error("Sender not found.");
        }
        await ensureGuideCampaign();
        await patchActiveCampaign({
          senderId: sender.id,
          senderEmail: sender.fromEmail,
          senderName: sender.fromName || sender.fromEmail,
        });
        const step = steps[guideRef.current.emailIndex] ?? firstStep;
        const fromPast = step?.whoSource === "past";
        if (fromPast || guideRef.current.emailIndex > 0) {
          pushAssistant("Sender saved.");
          askSubjectStep(guideRef.current.emailIndex > 0);
        } else {
          pushAssistant("Sender saved.");
          await askRecipientsStep();
        }
        return;
      }

      if (id === "skip_list_retry") {
        await askRecipientsStep();
        return;
      }

      if (id.startsWith("list:")) {
        const listId = id.slice("list:".length);
        const list =
          chatLists.find((l) => l.id === listId) ||
          (await loadChatCatalogs()).lists.find((l) => l.id === listId);
        if (!list) {
          throw new Error("List not found.");
        }
        await ensureGuideCampaign();
        await patchActiveCampaign({
          listId: list.id,
          listName: list.name,
          recipientMode: "list",
          individualContacts: [],
        });
        pushAssistant(`Recipients set to list “${list.name}”.`);
        askSubjectStep(false);
        return;
      }

      if (id.startsWith("sub:")) {
        if (id === "sub:type") {
          setGuide((g) => ({
            ...g,
            awaitingText: g.step === "fu_subject" ? "fu_subject" : "subject",
          }));
          pushAssistant("Type your subject line in the box below and press Send.");
          return;
        }
        const key = id.slice("sub:".length);
        const tpl = GUIDE_TEMPLATES[key];
        const subject = tpl?.subject || choice.label;
        await ensureGuideCampaign();
        await patchActiveCampaign({ subject });
        pushAssistant(`Subject saved: “${subject}”.`);
        askDesignStep(guideRef.current.step === "fu_subject" || guideRef.current.emailIndex > 0);
        return;
      }

      if (id.startsWith("tpl:") || id === "paste" || id === "editor") {
        await ensureGuideCampaign();
        const forFu =
          guideRef.current.step === "fu_design" ||
          guideRef.current.emailIndex > 0;
        if (id.startsWith("tpl:")) {
          const key = id.slice("tpl:".length);
          const tpl = GUIDE_TEMPLATES[key];
          if (!tpl) {
            throw new Error("Template not found.");
          }
          await patchActiveCampaign({
            subject: undefined,
            designHtml: tpl.html,
            hasDesign: true,
          });
          // Keep existing subject; only set design.
          await patchActiveCampaign({
            designHtml: tpl.html,
            hasDesign: true,
          });
          pushAssistant(`Applied “${tpl.label}” HTML.`);
          setGuide((g) => ({
            ...g,
            step: "fu_ask",
            awaitingText: undefined,
          }));
          pushAssistant(
            forFu
              ? "Follow-up is set up. Add another email, or finish?"
              : "Email 1 is set up. Add another email, or finish for now?",
            afterEmailChoices(),
            "fu_ask",
          );
          return;
        }
        if (id === "paste") {
          setGuide((g) => ({
            ...g,
            awaitingText: forFu ? "fu_html" : "html",
          }));
          pushAssistant("Paste your HTML in the next message and press Send.");
          return;
        }
        // Open design editor in the setup panel.
        const step = steps[guideRef.current.emailIndex] ?? firstStep;
        if (step) {
          openStepCampaign(step, guideRef.current.emailIndex);
        }
        setGuide((g) => ({ ...g, step: "fu_ask", awaitingText: undefined }));
        pushAssistant(
          "Design editor is open on the right. When you’re done, come back and choose:",
          afterEmailChoices(),
          "fu_ask",
        );
        return;
      }

      if (id === "add_fu") {
        beginFollowUpWizard();
        setGuide({
          active: true,
          step: "fu_type",
          emailIndex: Math.max(1, steps.length),
        });
        pushAssistant(
          "Next email — campaign type?",
          typeChoices(),
          "fu_type",
        );
        return;
      }

      if (id === "done") {
        setGuide(newGuideSession());
        pushAssistant(
          "Great. Review the canvas, open any email card to tweak setup, then hit Schedule when ready.",
        );
        return;
      }

      if (session.step === "fu_gap") {
        if (id === "custom") {
          setGuide((g) => ({ ...g, awaitingText: "fu_gap_custom" }));
          pushAssistant("Type the number of days (e.g. 5) and press Send.");
          return;
        }
        const days = Math.max(0, Math.floor(Number(id) || 0));
        const step = steps[steps.length - 1];
        if (step) {
          patchStep(step.id, { waitDays: days, waitHours: 0 });
        }
        setGuide((g) => ({
          ...g,
          step: "sender",
          emailIndex: Math.max(0, steps.length - 1),
          awaitingText: undefined,
        }));
        const ready = step
          ? { ...step, waitDays: days, waitHours: 0 }
          : undefined;
        if (ready) {
          await createAndOpenCampaign(
            ready,
            steps.map((s) => (s.id === ready.id ? ready : s)),
            { openSetup: false, navigate: false },
          );
        }
        // Follow-ups inherit sender — still allow pick.
        await askSenderStep(true);
        const autoId = recordIdRef.current;
        if (autoId) {
          navigateToSavedAutomation(autoId);
        }
        return;
      }

      pushAssistant("Got it. Say “Set up this campaign” anytime to restart the guided flow.");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Setup failed");
      pushAssistant(
        error instanceof Error
          ? error.message
          : "Something went wrong. Try another option or say “Set up this campaign”.",
      );
    } finally {
      setChatting(false);
    }
  }

  function clarifyGuideChoices(step: GuideSession["step"]): ChatChoice[] | undefined {
    switch (step) {
      case "start":
        return startGuideChoices();
      case "past_freq":
      case "fu_freq":
        return engagementChoices();
      case "type":
      case "fu_type":
        return typeChoices();
      case "fu_gap":
        return gapChoices();
      case "subject":
      case "fu_subject":
        return subjectQuickChoices();
      case "design":
      case "fu_design":
        return designChoices();
      case "fu_ask":
        return afterEmailChoices();
      default:
        return undefined;
    }
  }

  async function sendChat(text: string) {
    const message = text.trim();
    if (!message || chatting) {
      return;
    }
    setChatError("");
    setDraft("");
    speech.stop();

    const appendUser = (content: string) => {
      setChat((prev) => {
        const next: ChatTurn[] = [...prev, { role: "user", content }];
        chatRef.current = next;
        return next;
      });
    };

    // Guided free-text answers (subject / HTML / custom gap).
    if (guideRef.current.active && guideRef.current.awaitingText) {
      appendUser(message);
      await handleGuideText(message);
      return;
    }

    // Any “setup automation / campaign” intent → guided buttons immediately
    // (do not dump a long free-text plan first).
    if (!locked && isGuideStartMessage(message)) {
      appendUser(message);
      await beginGuidedSetup();
      return;
    }

    // Mid-guide free text that isn't the expected field → ask clarifying Q + choices.
    if (guideRef.current.active && !guideRef.current.awaitingText && !locked) {
      appendUser(message);
      const step = guideRef.current.step;
      const choices = clarifyGuideChoices(step);
      pushAssistant(
        `Got it — “${message.slice(0, 120)}${message.length > 120 ? "…" : ""}”. I still need a clear pick for this step. Tap one option below (or speak your answer).`,
        choices,
        step,
      );
      return;
    }

    setChatting(true);
    const nextHistory = [...chat, { role: "user" as const, content: message }];
    chatRef.current = nextHistory;
    setChat(nextHistory);
    try {
      const gaps: string[] = [];
      if (steps.length === 0) {
        gaps.push("no emails on the canvas yet");
      }
      for (const [index, step] of steps.entries()) {
        const campaign = campaignByStep[step.id];
        const label = `Email ${index + 1}`;
        if (!step.campaignId) {
          gaps.push(`${label}: campaign not created`);
        }
        if (!campaign?.senderId) {
          gaps.push(`${label}: sender missing`);
        }
        if (
          !(
            campaign?.listId ||
            (campaign?.individualContacts?.length ?? 0) > 0
          )
        ) {
          gaps.push(`${label}: recipients / list missing`);
        }
        if (!campaign?.subject?.trim()) {
          gaps.push(`${label}: subject missing`);
        }
        if (!campaign?.designHtml && !campaign?.hasDesign) {
          gaps.push(`${label}: HTML / design missing`);
        }
        if (index > 0 && (step.waitDays === undefined || step.waitDays === null)) {
          gaps.push(`${label}: wait gap missing`);
        }
      }

      const response = await fetch("/api/automation/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: nextHistory.map(({ role, content }) => ({ role, content })),
          context: {
            kind,
            campaignName: name,
            status,
            stepCount: steps.length,
            guidedSetup: guideRef.current.active,
            missing: gaps,
            steps: steps.map((step, index) => {
              const campaign = campaignByStep[step.id];
              return {
                n: index + 1,
                kind: stepKind(step),
                name:
                  campaign?.name ||
                  step.pastCampaignName ||
                  (step.campaignId ? `Campaign ${step.campaignId}` : "not created"),
                campaignStatus: campaign?.status || "none",
                start: step.whoSource === "past" ? "past" : "new",
                wait: index === 0 ? "start" : waitLabel(step),
                who: index === 0 ? "everyone on the list" : whoLabel(step),
                hasSender: Boolean(campaign?.senderId),
                hasAudience: Boolean(
                  campaign?.listId ||
                    (campaign?.individualContacts?.length ?? 0) > 0,
                ),
                hasDesign: Boolean(campaign?.designHtml || campaign?.hasDesign),
              };
            }),
          },
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Chat failed",
        );
      }
      const reply = String(data.reply || "");
      const offerGuide = !locked && gaps.length > 0;
      setChat((prev) => [
        ...prev,
        {
          role: "assistant",
          content: reply,
          choices: offerGuide
            ? [{ id: "start_guide", label: "Continue setup with choices" }]
            : undefined,
        },
      ]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Chat failed");
    } finally {
      setChatting(false);
    }
  }

  async function confirmSchedule() {
    if (!firstCampaign || !automationReady || launching || locked) {
      return;
    }
    setLaunching(true);
    setLaunchError("");
    try {
      const alreadySent = firstCampaign.status === "sent";
      if (!alreadySent) {
        const timezone = firstCampaign.timezone || "Asia/Kolkata";
        const response = await fetch("/api/campaigns/launch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign: {
              ...firstCampaign,
              kind:
                firstCampaign.kind === "oneone" ? "oneone" : "drip",
            },
            mode: scheduleMode,
            scheduledFor:
              scheduleMode === "later"
                ? zonedDateTimeToIso(
                    scheduleDate,
                    scheduleHour,
                    scheduleMinute,
                    timezone,
                  )
                : undefined,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "Failed to launch",
          );
        }
      }
      void fetch("/api/campaigns/process-due", { method: "POST" });
      const nextStatus: AutomationStatus =
        alreadySent || scheduleMode !== "later" ? "running" : "scheduled";
      if (recordId) {
        await patchAutomation(recordId, {
          status: nextStatus,
          steps,
          name: name.trim() || "Untitled automation",
          kind: firstStep ? stepKind(firstStep) : kind,
        });
      }
      setStatus(nextStatus);
      persistEnabledRef.current = false;
      setScheduleOpen(false);
      setWizardPhase("closed");
      const followUpCount = Math.max(0, steps.length - 1);
      setLaunchNotice(
        followUpCount > 0
          ? scheduleMode === "now"
            ? "Email 1 launched. Follow-ups wait their gap. Use Edit flow anytime to change setup."
            : "Email 1 scheduled. Follow-ups wait their gap. Use Edit flow anytime to change setup."
          : scheduleMode === "now"
            ? "Campaign launched. Use Edit flow anytime to change setup."
            : "Campaign scheduled. Use Edit flow anytime to change setup.",
      );
      const refreshed = await fetchDripCampaign(
        firstCampaign.id,
        firstCampaign.kind === "oneone" ? "oneone" : "drip",
      );
      if (refreshed && firstStep) {
        setCampaignByStep((current) => ({
          ...current,
          [firstStep.id]: refreshed,
        }));
      }
    } catch (error) {
      setLaunchError(
        error instanceof Error ? error.message : "Failed to launch campaign",
      );
    } finally {
      setLaunching(false);
    }
  }

  const hours = Array.from({ length: 24 }, (_, index) => padTime(index));
  const minutes = ["00", "15", "30", "45"];
  const firstGaps = firstCampaign ? readinessGaps(firstCampaign) : [];

  function closeHistory() {
    // From bare /automation the list IS the page — keep it open.
    if (mode === "create" && !searchParams.get("new")) {
      if (searchParams.get("history") === "1") {
        router.replace(PORTAL_ROUTES.automation);
      }
      setHistoryOpen(true);
      return;
    }
    setHistoryOpen(false);
    if (searchParams.get("history") === "1") {
      router.replace(
        mode === "edit" && automationId
          ? `/portal/marketing/automation/${encodeURIComponent(automationId)}`
          : `${PORTAL_ROUTES.automation}?new=${Date.now()}`,
      );
    }
  }

  if (AUTOMATION_UNDER_DEVELOPMENT) {
    return <AutomationUnderDevelopment />;
  }

  if (historyOpen) {
    const listIsRoot = mode === "create" && !searchParams.get("new");
    return (
      <PortalAutomationHistoryPage
        onBack={listIsRoot ? undefined : closeHistory}
        onCreateNew={() => {
          setHistoryOpen(false);
          router.push(`${PORTAL_ROUTES.automation}?new=${Date.now()}`);
        }}
      />
    );
  }

  if (campaignSetup) {
    return (
      <div className="auto-page auto-page-campaign-setup">
        <div className="auto-campaign-setup">
          <PortalCampaignDetailPage
            key={`${campaignSetup.stepId}:${campaignSetup.campaignId}`}
            campaignId={campaignSetup.campaignId}
            kind={campaignSetup.kind}
            automationEmbed={{
              stepId: campaignSetup.stepId,
              automationId: recordId || undefined,
              followUp: campaignSetup.followUp,
              pastAudience: campaignSetup.pastAudience,
              onDone: () => void closeCampaignSetup(),
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`auto-page${sidebarOpen ? "" : " sidebar-collapsed"}`}>
      <aside className="auto-ai">
        <div className="auto-ai-top">
          <div>
            <p className="auto-ai-kicker">Assistant</p>
            <h2>Setup assistant</h2>
          </div>
          <button
            type="button"
            className="auto-ai-collapse"
            aria-label="Collapse assistant"
            onClick={() => setSidebarOpen(false)}
          >
            ‹
          </button>
        </div>

        {chat.length === 0 ? (
          <div className="auto-ai-suggestions">
            {SUGGESTIONS.map((item) => (
              <button
                key={item.message}
                type="button"
                className="auto-ai-chip"
                onClick={() => void sendChat(item.message)}
              >
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="auto-ai-thread">
            {chat.map((turn, index) => (
              <div
                key={`${turn.role}-${index}`}
                className={`auto-ai-bubble ${turn.role}`}
              >
                {turn.role === "assistant" ? (
                  <>
                    <ChatRichText text={turn.content} />
                    {turn.choices && turn.choices.length > 0 ? (
                      <div className="auto-ai-choices">
                        {turn.choices.map((choice) => {
                          const selected = turn.selectedChoiceId === choice.id;
                          const disabled =
                            Boolean(turn.selectedChoiceId) ||
                            chatting ||
                            locked;
                          return (
                            <button
                              key={choice.id}
                              type="button"
                              className={`auto-ai-choice${
                                selected ? " selected" : ""
                              }`}
                              disabled={disabled}
                              onClick={() =>
                                void handleChatChoice(index, choice)
                              }
                            >
                              <strong>{choice.label}</strong>
                              {choice.description ? (
                                <span>{choice.description}</span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </>
                ) : (
                  turn.content
                )}
              </div>
            ))}
            {chatting ? (
              <div className="auto-ai-bubble assistant auto-ai-thinking">
                <span />
                <span />
                <span />
              </div>
            ) : null}
            <div ref={chatEndRef} />
          </div>
        )}

        {chatError ? <p className="auto-ai-error">{chatError}</p> : null}
        {speech.error ? <p className="auto-ai-error">{speech.error}</p> : null}

        <form
          className="auto-ai-composer"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            speech.stop();
            void sendChat(draft);
          }}
        >
          <div className="auto-ai-box">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  speech.stop();
                  void sendChat(draft);
                }
              }}
              placeholder={
                guide.awaitingText === "html" || guide.awaitingText === "fu_html"
                  ? "Paste email HTML here…"
                  : guide.awaitingText === "subject" ||
                      guide.awaitingText === "fu_subject"
                    ? "Type or speak the subject line…"
                    : guide.awaitingText === "fu_gap_custom"
                      ? "Type or speak number of days…"
                      : guide.active
                        ? "Type or speak an answer…"
                        : "Ask, speak, or say “Set up this campaign”…"
              }
              disabled={chatting}
              rows={2}
            />
            <div className="auto-ai-box-actions">
              {speech.supported ? (
                <button
                  type="button"
                  className={`auto-ai-mic${speech.listening ? " is-listening" : ""}`}
                  onClick={() => speech.toggle()}
                  disabled={chatting || locked}
                  aria-pressed={speech.listening}
                  aria-label={speech.listening ? "Stop speaking" : "Speak"}
                  title={
                    speech.listening
                      ? "Stop speaking"
                      : "Speak instead of typing"
                  }
                >
                  {speech.listening ? (
                    <span className="auto-ai-mic-wave" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                      <rect
                        x="9"
                        y="3"
                        width="6"
                        height="11"
                        rx="3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                      <path
                        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </button>
              ) : null}
              <button
                type="submit"
                className="auto-ai-send"
                disabled={chatting || !draft.trim()}
                aria-label="Send"
              >
                Send
              </button>
            </div>
          </div>
        </form>
      </aside>

      {!sidebarOpen ? (
        <button
          type="button"
          className="auto-ai-expand"
          onClick={() => setSidebarOpen(true)}
        >
          Ask AI
        </button>
      ) : null}

      <section className="auto-main">
        <header className="auto-topbar">
          <div className="auto-title-wrap">
            <div className="auto-name-edit">
              <input
                ref={nameInputRef}
                className="auto-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-label="Automation name"
                placeholder="Automation name"
                title="Automation name"
                readOnly={locked}
                disabled={locked}
              />
              {!locked ? (
                <button
                  type="button"
                  className="auto-name-pencil"
                  aria-label="Rename automation"
                  title="Rename"
                  onClick={() => {
                    const input = nameInputRef.current;
                    if (!input) {
                      return;
                    }
                    input.focus();
                    input.select();
                  }}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              ) : null}
            </div>
            <span className={`auto-badge auto-badge-${status}`}>
              {statusBadgeLabel(status)}
            </span>
            {automationReady && !locked ? (
              <span className="auto-ready-tick">Ready</span>
            ) : null}
            <button
              type="button"
              className="btn-soft auto-history-link"
              onClick={() => setHistoryOpen(true)}
            >
              History
            </button>
          </div>

          {locked ? (
            canEditAfterRollout ? (
              <button
                type="button"
                className="btn-dark auto-next"
                disabled={reopening}
                onClick={() => void handleEditAfterRollout()}
              >
                {reopening ? "Opening…" : "Edit flow"}
              </button>
            ) : (
              <button type="button" className="btn-soft auto-next" disabled>
                {statusBadgeLabel(status)}
              </button>
            )
          ) : (
            <button
              type="button"
              className="btn-dark auto-next"
              disabled={!automationReady || launching}
              onClick={() => {
                setLaunchError("");
                setScheduleOpen(true);
              }}
            >
              Schedule
            </button>
          )}
        </header>

        {locked ? (
          <div className={`auto-banner-ok${status === "completed" ? " done" : ""}`}>
            {status === "completed"
              ? "This flow is done. Open History to start a new one."
              : "This flow is live. Choose Edit flow to change steps or campaign setup, then Schedule again."}
          </div>
        ) : null}

        {loadError ? <div className="crm-error auto-banner-error">{loadError}</div> : null}
        {launchError ? (
          <div className="crm-error auto-banner-error">{launchError}</div>
        ) : null}
        {launchNotice ? (
          <div className="auto-banner-ok">{launchNotice}</div>
        ) : null}
        {bootstrapping ? (
          <div className="auto-banner-ok">Starting automation…</div>
        ) : null}
        {loadingCampaign ? (
          <div className="auto-banner-ok">Loading linked campaign…</div>
        ) : null}

        <div className="auto-canvas-wrap">
          <div
            className="auto-canvas"
            style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
          >
            <div
              className={`auto-start-node${
                status === "completed" ? " done" : firstReady ? " ready" : ""
              }`}
            >
              <div className="auto-start-row">
                <span className="lbl">Start</span>
                <span className="val">
                  {firstFromPast
                    ? "Past campaign"
                    : steps.length === 0
                      ? "Choose path"
                      : "New campaign"}
                </span>
              </div>
              <div className="auto-start-row">
                <span className="lbl">Emails</span>
                <span className="val">
                  {steps.length === 0
                    ? "—"
                    : firstReady
                      ? `${steps.length} ready`
                      : firstCampaign
                        ? firstGaps[0] || "Needs setup"
                        : "In progress"}
                </span>
              </div>
            </div>

            {/* Committed choices — one card per selection; Edit always works in draft */}
            {firstStep && !locked ? (
              <>
                <ChoiceStepCard
                  pill="Start"
                  title="Start from"
                  value={
                    firstStep.whoSource === "past"
                      ? "Past campaign"
                      : "New campaign"
                  }
                  active={wizardPhase === "start"}
                  editable
                  onEdit={() => openPhase("start", firstStep.id)}
                />
                {firstStep.whoSource === "past" && firstStep.pastCampaignId ? (
                  <ChoiceStepCard
                    pill="Past campaign"
                    title="Source campaign"
                    value={firstStep.pastCampaignName || "Selected"}
                    active={wizardPhase === "past_select"}
                    editable
                    onEdit={() => openPhase("past_select", firstStep.id)}
                  />
                ) : null}
                {firstStep.whoSource === "past" && firstStep.engagement ? (
                  <ChoiceStepCard
                    pill="Audience"
                    title="Who gets Email 1"
                    value={engagementLabel(firstStep.engagement)}
                    active={wizardPhase === "past_freq"}
                    editable
                    onEdit={() => {
                      setDraftEngagement(firstStep.engagement || "opens_or_clicks");
                      openPhase("past_freq", firstStep.id);
                    }}
                  />
                ) : null}
                {typeChosen(firstStep) &&
                (firstStep.whoSource !== "past" || firstStep.engagement) ? (
                  <ChoiceStepCard
                    pill="Type"
                    title="Campaign type"
                    value={stepKind(firstStep) === "oneone" ? "1-1" : "Drip"}
                    active={
                      wizardPhase === "past_type" || wizardPhase === "new_type"
                    }
                    editable
                    onEdit={() => {
                      setDraftStepKind(stepKind(firstStep));
                      openPhase(
                        firstStep.whoSource === "past"
                          ? "past_type"
                          : "new_type",
                        firstStep.id,
                      );
                    }}
                  />
                ) : null}
              </>
            ) : null}

            {/* Email 1 editors only — next-campaign editors render below Email 1 */}
            {!locked &&
            (wizardPhase === "start" ||
              wizardPhase === "past_select" ||
              wizardPhase === "past_freq" ||
              wizardPhase === "past_type" ||
              wizardPhase === "new_type") ? (
              <div className="auto-step-block" ref={addWrapRef}>
                <FlowWire tone="live" />
                <div className="auto-choice-editor auto-choice-editor-solo auto-wizard">
                  {wizardMeta ? (
                    <div className="auto-wizard-flow">
                      <span className="auto-wizard-flow-kind">
                        {wizardMeta.flow}
                      </span>
                      <span className="auto-wizard-flow-step">
                        Step {wizardMeta.step} of {wizardMeta.total}
                      </span>
                    </div>
                  ) : null}
                  {wizardPhase === "start" ? (
                    <>
                      <h4 className="auto-add-title">How do you want to start?</h4>
                      <p className="auto-add-desc">
                        Pick one — it becomes a step you can edit anytime.
                      </p>
                      <div className="auto-kind-toggle auto-kind-stack">
                        <button
                          type="button"
                          className={
                            firstStep?.whoSource === "past" ? "active" : ""
                          }
                          onClick={() => beginStartChoice("past")}
                        >
                          Past campaign
                        </button>
                        <button
                          type="button"
                          className={
                            firstStep && firstStep.whoSource !== "past"
                              ? "active"
                              : ""
                          }
                          onClick={() => beginStartChoice("current")}
                        >
                          New campaign
                        </button>
                      </div>
                      {firstStep ? (
                        <div className="auto-step-setup-actions">
                          <button
                            type="button"
                            className="btn-soft"
                            onClick={() => setWizardPhase("closed")}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {wizardPhase === "past_select" ? (
                    <>
                      <h4 className="auto-add-title">Select past campaign</h4>
                      <p className="auto-add-desc">
                        Engagers from this campaign become Email 1 recipients.
                      </p>
                      <label className="auto-field">
                        Past campaign
                        <select
                          value={
                            firstStep ? stepPastKey(firstStep) : draftPastId
                          }
                          onChange={(event) => {
                            const picked = findPastCampaignByKey(
                              event.target.value,
                              pastCampaigns,
                            );
                            if (picked) {
                              selectPastForFirst(picked);
                            }
                          }}
                        >
                          <option value="">
                            {loadingPast
                              ? "Loading…"
                              : "Select a sent campaign"}
                          </option>
                          {pastCampaigns.map((campaign) => (
                            <option
                              key={pastCampaignKey(campaign)}
                              value={pastCampaignKey(campaign)}
                            >
                              {campaign.name} · {campaign.opens} opens ·{" "}
                              {campaign.clicks} clicks ·{" "}
                              {campaignKindOf(campaign) === "oneone"
                                ? "1-1"
                                : "Drip"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="auto-step-setup-actions">
                        <button
                          type="button"
                          className="btn-soft"
                          onClick={wizardBack}
                        >
                          Back
                        </button>
                      </div>
                    </>
                  ) : null}
                  {wizardPhase === "past_freq" ? (
                    <>
                      <h4 className="auto-add-title">Who should get Email 1?</h4>
                      <p className="auto-add-desc">
                        Choose openers, clickers, or both.
                      </p>
                      <div className="auto-kind-toggle auto-engage-toggle">
                        {(
                          [
                            ["opens", "Opened"],
                            ["clicks", "Clicked"],
                            ["opens_or_clicks", "Opened or clicked"],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={
                              (firstStep?.engagement || draftEngagement) ===
                              value
                                ? "active"
                                : ""
                            }
                            onClick={() => {
                              setDraftEngagement(value);
                              if (!firstStep) {
                                return;
                              }
                              const changed = firstStep.engagement !== value;
                              if (changed) {
                                unlinkCampaignIfNeeded(firstStep.id);
                              }
                              const alreadyTyped = typeChosen(firstStep);
                              patchStep(firstStep.id, {
                                engagement: value,
                                campaignKind: alreadyTyped
                                  ? firstStep.campaignKind
                                  : undefined,
                              });
                              setWizardPhase(
                                alreadyTyped ? "closed" : "past_type",
                              );
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="auto-step-setup-actions">
                        <button
                          type="button"
                          className="btn-soft"
                          onClick={wizardBack}
                        >
                          Back
                        </button>
                      </div>
                    </>
                  ) : null}
                  {wizardPhase === "past_type" || wizardPhase === "new_type" ? (
                    <>
                      <h4 className="auto-add-title">Campaign type</h4>
                      <p className="auto-add-desc">Drip or 1-1 for Email 1.</p>
                      <KindToggle
                        value={draftStepKind}
                        onChange={(next) => {
                          setDraftStepKind(next);
                          setKind(next);
                        }}
                      />
                      <div className="auto-step-setup-actions">
                        <button
                          type="button"
                          className="btn-soft"
                          onClick={wizardBack}
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          className="btn-dark"
                          onClick={() => {
                            if (firstStep) {
                              if (firstStep.campaignKind !== draftStepKind) {
                                unlinkCampaignIfNeeded(firstStep.id);
                              }
                              patchStep(firstStep.id, {
                                campaignKind: draftStepKind,
                              });
                              if (
                                firstStep.campaignId ||
                                campaignByStep[firstStep.id]
                              ) {
                                setWizardPhase("closed");
                                return;
                              }
                            }
                            setWizardPhase(
                              wizardPhase === "past_type"
                                ? "past_setup"
                                : "new_setup",
                            );
                          }}
                        >
                          Continue
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}

            {steps.map((step, index) => {
              if (!typeChosen(step) && !step.campaignId && !locked) {
                return null;
              }
              // Follow-up choice cards appear before that email card.
              const showFuChoices =
                index > 0 && !locked && (typeChosen(step) || step.engagement);
              const campaign = campaignByStep[step.id];
              const audienceOptional = index > 0;
              const stepReady = campaign
                ? campaign.status === "sent" ||
                  readinessGaps(campaign, { audienceOptional }).length === 0
                : false;
              const cardTone =
                campaign?.status === "sent" || status === "completed"
                  ? "done"
                  : stepReady
                    ? "ready"
                    : "needs";
              const wireTone =
                status === "completed" || campaign?.status === "sent"
                  ? "done"
                  : status === "running" ||
                      status === "scheduled" ||
                      stepReady
                    ? "live"
                    : "idle";

              return (
                <div key={step.id}>
                  {showFuChoices ? (
                    <>
                      {typeChosen(step) ? (
                        <ChoiceStepCard
                          pill={`Email ${index + 1}`}
                          title="Campaign type"
                          value={
                            stepKind(step) === "oneone" ? "1-1" : "Drip"
                          }
                          active={wizardPhase === "fu_type"}
                          editable
                          onEdit={() => {
                            setDraftStepKind(stepKind(step));
                            openPhase("fu_type", step.id);
                          }}
                        />
                      ) : null}
                      {step.engagement ? (
                        <ChoiceStepCard
                          pill="Audience"
                          title="From current campaign"
                          value={engagementLabel(step.engagement)}
                          active={wizardPhase === "fu_freq"}
                          editable
                          onEdit={() => {
                            setDraftEngagement(step.engagement!);
                            openPhase("fu_freq", step.id);
                          }}
                        />
                      ) : null}
                      {step.waitDays !== undefined &&
                      step.waitDays !== null ? (
                        <ChoiceStepCard
                          pill="Gap"
                          title="Wait after current"
                          value={`${Number(step.waitDays) || 0} day${
                            Number(step.waitDays) === 1 ? "" : "s"
                          }`}
                          active={wizardPhase === "fu_gap"}
                          editable
                          onEdit={() => {
                            setDraftWaitDays(String(step.waitDays ?? 0));
                            openPhase("fu_gap", step.id);
                          }}
                        />
                      ) : null}
                    </>
                  ) : null}

                  {(typeChosen(step) || step.campaignId || locked) &&
                  (index === 0
                    ? firstStep?.whoSource !== "past" ||
                      Boolean(firstStep.engagement && typeChosen(firstStep))
                    : typeChosen(step) &&
                      step.engagement &&
                      step.waitDays !== undefined) ? (
                    <div className="auto-step-block">
                      <FlowWire tone={wireTone} />
                      <div className="auto-delay-pill">
                        {index === 0
                          ? step.whoSource === "past"
                            ? "Email 1 · past engagers"
                            : "Email 1"
                          : `${waitLabel(step)} · ${whoLabel(step)}`}
                      </div>
                      <button
                        type="button"
                        className={`auto-step-card${
                          selectedStepId === step.id ? " active" : ""
                        } ${cardTone}`}
                        onClick={() => {
                          if (status === "completed") {
                            return;
                          }
                          setSelectedStepId(step.id);
                          const campaignId = resolveStepCampaignId(step);
                          if (campaignId) {
                            openStepCampaign(
                              {
                                ...step,
                                campaignId,
                                campaignKind:
                                  step.campaignKind ||
                                  (campaignByStep[step.id]
                                    ? campaignKindOf(campaignByStep[step.id])
                                    : stepKind(step)),
                              },
                              index,
                            );
                            return;
                          }
                          // New setup only while draft (use Edit flow first).
                          if (locked) {
                            return;
                          }
                          if (index === 0) {
                            openPhase(
                              step.whoSource === "past"
                                ? "past_setup"
                                : "new_setup",
                              step.id,
                            );
                          } else {
                            setDraftStepKind(
                              typeChosen(step) ? stepKind(step) : "drip",
                            );
                            setDraftEngagement(
                              step.engagement || "opens_or_clicks",
                            );
                            setDraftWaitDays(String(step.waitDays ?? 1));
                            openPhase("fu_setup", step.id);
                          }
                        }}
                      >
                        <span className="auto-step-icon" aria-hidden>
                          <MailIcon />
                        </span>
                        <span className="auto-step-meta">
                          <strong>
                            {emailStepLabel(index)}
                            <em className="auto-step-kind">
                              {stepKind(step) === "oneone" ? "1-1" : "Drip"}
                            </em>
                          </strong>
                          <em>
                            {campaign?.name ||
                              (step.campaignId
                                ? "Open campaign setup"
                                : "Set up campaign")}
                          </em>
                        </span>
                        {cardTone === "done" ? (
                          <span className="auto-step-check">Done</span>
                        ) : stepReady ? (
                          <span className="auto-step-check ready">Ready</span>
                        ) : (
                          <span className="auto-step-check needs">Setup</span>
                        )}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {/* Next campaign (Email 2+) editors — always below Email 1 */}
            {!locked &&
            (wizardPhase === "fu_type" ||
              wizardPhase === "fu_freq" ||
              wizardPhase === "fu_gap") ? (
              <div className="auto-step-block" ref={addWrapRef}>
                <FlowWire tone="live" />
                <div className="auto-delay-pill auto-delay-pill-active">
                  After Email 1
                </div>
                <div className="auto-choice-editor auto-choice-editor-solo auto-wizard">
                  <div className="auto-wizard-flow">
                    <span className="auto-wizard-flow-kind">
                      {`Email ${Math.max(2, steps.length)}`}
                    </span>
                    <span className="auto-wizard-flow-step">
                      {wizardPhase === "fu_type"
                        ? "Step 1 of 4 · Type"
                        : wizardPhase === "fu_freq"
                          ? "Step 2 of 4 · Open / click"
                          : "Step 3 of 4 · Gap"}
                    </span>
                  </div>
                  {wizardPhase === "fu_type" ? (
                    <>
                      <h4 className="auto-add-title">
                        Next email · campaign type
                      </h4>
                      <p className="auto-add-desc">
                        This is a new email after Email 1 — not editing Email 1.
                      </p>
                      <KindToggle
                        value={draftStepKind}
                        onChange={(next) => {
                          setDraftStepKind(next);
                        }}
                      />
                      <div className="auto-step-setup-actions">
                        <button
                          type="button"
                          className="btn-soft"
                          onClick={() => {
                            // Cancel: drop unfinished follow-up draft
                            setSteps((prev) =>
                              prev.filter(
                                (step, index) =>
                                  index === 0 ||
                                  Boolean(step.campaignId) ||
                                  Boolean(campaignByStep[step.id]),
                              ),
                            );
                            setWizardPhase("closed");
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn-dark"
                          onClick={() => {
                            const target =
                              steps.find((s) => s.id === selectedStepId) ||
                              steps[steps.length - 1];
                            if (!target || target.id === firstStep?.id) {
                              setLoadError(
                                "Could not find the next email step.",
                              );
                              return;
                            }
                            patchStep(target.id, {
                              campaignKind: draftStepKind,
                            });
                            setWizardPhase("fu_freq");
                          }}
                        >
                          Continue
                        </button>
                      </div>
                    </>
                  ) : null}
                  {wizardPhase === "fu_freq" ? (
                    <>
                      <h4 className="auto-add-title">
                        Who from Email 1 should get this?
                      </h4>
                      <p className="auto-add-desc">
                        Openers, clickers, or both from the email above.
                      </p>
                      <div className="auto-kind-toggle auto-engage-toggle">
                        {(
                          [
                            ["opens", "Opened"],
                            ["clicks", "Clicked"],
                            ["opens_or_clicks", "Opened or clicked"],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={
                              draftEngagement === value ? "active" : ""
                            }
                            onClick={() => {
                              setDraftEngagement(value);
                              const target =
                                steps.find((s) => s.id === selectedStepId) ||
                                steps[steps.length - 1];
                              if (!target || target.id === firstStep?.id) {
                                return;
                              }
                              patchStep(target.id, {
                                engagement: value,
                                waitDays: undefined,
                                waitHours: undefined,
                              });
                              setWizardPhase("fu_gap");
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="auto-step-setup-actions">
                        <button
                          type="button"
                          className="btn-soft"
                          onClick={() => setWizardPhase("fu_type")}
                        >
                          Back
                        </button>
                      </div>
                    </>
                  ) : null}
                  {wizardPhase === "fu_gap" ? (
                    <>
                      <h4 className="auto-add-title">
                        Gap after Email 1 completes
                      </h4>
                      <p className="auto-add-desc">
                        How many days to wait before this next email sends.
                      </p>
                      <label className="auto-field">
                        Days
                        <input
                          type="number"
                          min={0}
                          value={draftWaitDays}
                          onChange={(event) =>
                            setDraftWaitDays(
                              String(
                                Math.max(0, Number(event.target.value) || 0),
                              ),
                            )
                          }
                        />
                      </label>
                      <div className="auto-step-setup-actions">
                        <button
                          type="button"
                          className="btn-soft"
                          onClick={() => setWizardPhase("fu_freq")}
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          className="btn-dark"
                          onClick={() => {
                            const days = Math.max(
                              0,
                              Number(draftWaitDays) || 0,
                            );
                            setDraftWaitHours("0");
                            const target =
                              steps.find((s) => s.id === selectedStepId) ||
                              steps[steps.length - 1];
                            if (!target || target.id === firstStep?.id) {
                              return;
                            }
                            patchStep(target.id, {
                              waitDays: days,
                              waitHours: 0,
                            });
                            setWizardPhase("fu_setup");
                          }}
                        >
                          Continue
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!locked ? (
              <div className="auto-add-wrap">
                <FlowWire short tone={firstReady ? "live" : "idle"} />
                {wizardPhase === "closed" ? (
                  <button
                    type="button"
                    className="auto-add-btn"
                    onClick={() => {
                      if (steps.length === 0) {
                        setWizardPhase("start");
                        return;
                      }
                      // Always start a fresh next email under Email 1 — never
                      // reopen Email 1 campaign type.
                      beginFollowUpWizard();
                    }}
                  >
                    {steps.length === 0 ? "Start" : "+ Add next campaign"}
                  </button>
                ) : null}
                {wizardPhase === "past_setup" ||
                wizardPhase === "new_setup" ||
                wizardPhase === "fu_setup" ? (
                  <div className="auto-choice-editor auto-choice-editor-solo auto-wizard">
                    <div className="auto-wizard-flow">
                      <span className="auto-wizard-flow-kind">
                        {wizardPhase === "fu_setup"
                          ? `Email ${Math.max(2, steps.length)}`
                          : wizardMeta?.flow || "Email 1"}
                      </span>
                      <span className="auto-wizard-flow-step">
                        {wizardPhase === "fu_setup"
                          ? "Step 4 of 4 · Set up"
                          : "Set up campaign"}
                      </span>
                    </div>
                    <h4 className="auto-add-title">
                      {wizardPhase === "fu_setup"
                        ? `Set up Email ${Math.max(2, steps.length)}`
                        : "Set up Email 1"}
                    </h4>
                    <p className="auto-add-desc">
                      {wizardPhase === "past_setup"
                        ? "Recipients come from past-campaign engagers. Finish sender and design, then return here."
                        : wizardPhase === "new_setup"
                          ? "Choose list, sender, and design. Return here when done."
                          : `New email after Email 1. Waits ${Number(draftWaitDays) || 0} day${
                              Number(draftWaitDays) === 1 ? "" : "s"
                            }, then goes to Email 1 ${
                              draftEngagement === "opens"
                                ? "openers"
                                : draftEngagement === "clicks"
                                  ? "clickers"
                                  : "openers and clickers"
                            }.`}
                    </p>
                    <div className="auto-step-setup-actions">
                      <button
                        type="button"
                        className="btn-soft"
                        onClick={wizardBack}
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        className="btn-dark"
                        disabled={creating}
                        onClick={() => void setupWizardCampaign()}
                      >
                        {creating ? "Opening…" : "Set up campaign"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="auto-zoom">
            <button type="button" onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}>
              +
            </button>
            <button type="button" onClick={() => setZoom((z) => Math.max(0.7, z - 0.1))}>
              −
            </button>
          </div>
        </div>
      </section>

      {scheduleOpen && !locked ? (
        <div
          className="drip-schedule-backdrop"
          role="presentation"
          onMouseDown={() => setScheduleOpen(false)}
        >
          <div
            className="drip-schedule-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drip-schedule-head">
              <h3>Schedule</h3>
              <button
                type="button"
                className="crm-modal-close"
                onClick={() => setScheduleOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="drip-schedule-body">
              <div className="drip-schedule-question">
                {firstFromPast
                  ? "When should Email 1 send to past-campaign engagers? Follow-ups wait their gap after this email."
                  : "When should Email 1 send? Follow-ups wait their gap, then go to openers/clickers."}
              </div>
              <label className="drip-schedule-option">
                <input
                  type="radio"
                  name="auto-schedule-mode"
                  checked={scheduleMode === "now"}
                  onChange={() => setScheduleMode("now")}
                />
                <span>Send now</span>
              </label>
              <label className="drip-schedule-option">
                <input
                  type="radio"
                  name="auto-schedule-mode"
                  checked={scheduleMode === "later"}
                  onChange={() => setScheduleMode("later")}
                />
                <span>Schedule for later</span>
              </label>
              {scheduleMode === "later" ? (
                <div className="drip-schedule-later">
                  <label className="drip-schedule-field">
                    <span>Date</span>
                    <div className="drip-schedule-select-wrap">
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(event) => setScheduleDate(event.target.value)}
                      />
                      <ChevronDownIcon />
                    </div>
                  </label>
                  <div className="drip-schedule-field">
                    <span>Time</span>
                    <div className="drip-schedule-time-row">
                      <div className="drip-schedule-select-wrap drip-schedule-time">
                        <select
                          value={scheduleHour}
                          onChange={(event) => setScheduleHour(event.target.value)}
                        >
                          {hours.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                        <ChevronDownIcon />
                      </div>
                      <div className="drip-schedule-select-wrap drip-schedule-time">
                        <select
                          value={scheduleMinute}
                          onChange={(event) =>
                            setScheduleMinute(event.target.value)
                          }
                        >
                          {minutes.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                        <ChevronDownIcon />
                      </div>
                    </div>
                    <div className="drip-schedule-tz">
                      {firstCampaign?.timezone || "Asia/Kolkata"}
                    </div>
                  </div>
                </div>
              ) : null}
              {launchError ? (
                <div className="drip-schedule-error">{launchError}</div>
              ) : null}
            </div>
            <div className="drip-schedule-foot">
              <button
                type="button"
                className="btn-soft"
                onClick={() => setScheduleOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                disabled={launching}
                onClick={() => void confirmSchedule()}
              >
                {launching
                  ? "Saving…"
                  : scheduleMode === "now"
                    ? "Send now"
                    : "Schedule"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
