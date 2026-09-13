"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createAutomation,
  fetchAutomation,
  fetchAutomations,
  patchAutomation,
  portalAutomationHistoryRoute,
  portalAutomationRoute,
  type AutomationStatus,
  type AutomationStep,
} from "@/lib/automations";
import {
  fetchDripCampaign,
  fetchDripCampaigns,
  patchDripCampaign,
  sequencesReady,
  zonedDateTimeToIso,
  type CampaignKind,
  type DripCampaign,
} from "@/lib/drip-campaigns";
import { portalCampaignRoute } from "@/lib/portal-nav";

type ChatTurn = { role: "user" | "assistant"; content: string };

type EngagementKind = "opens" | "clicks" | "opens_or_clicks";
type WhoSource = "current" | "past";

type AutoStep = AutomationStep;

const SUGGESTIONS = [
  "Suggest me some ideas of campaigns",
  "Help me plan a drip follow-up",
  "What should I put in a 1-1 sequence?",
  "Audit my automation before launch",
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
      gaps.push("All sequence subjects + designs");
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
    campaignKind: "drip",
    waitDays: 0,
    waitHours: 0,
    whoSource: "current",
    engagement: "opens_or_clicks",
    ...partial,
  };
}

function stepKind(step: Pick<AutoStep, "campaignKind">): CampaignKind {
  return step.campaignKind === "oneone" ? "oneone" : "drip";
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
  const [status, setStatus] = useState<AutomationStatus>("draft");
  const [bootstrapping, setBootstrapping] = useState(true);
  const persistEnabledRef = useRef(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [kind, setKind] = useState<CampaignKind>("drip");
  const [name, setName] = useState("Untitled automation");
  const [steps, setSteps] = useState<AutoStep[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  const [campaignByStep, setCampaignByStep] = useState<Record<string, DripCampaign>>(
    {},
  );
  const [loadingCampaign, setLoadingCampaign] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);

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

  const selectedStep = steps.find((step) => step.id === selectedStepId) ?? null;
  const firstStep = steps[0] ?? null;
  const firstCampaign = firstStep ? campaignByStep[firstStep.id] ?? null : null;

  const firstReady = firstCampaign ? isCampaignReady(firstCampaign) : false;
  const startingFromPast = Boolean(
    firstStep?.whoSource === "past" && firstCampaign,
  );
  const followUpsConfigured = steps.every((step, index) => {
    if (index === 0) {
      return firstStep?.whoSource !== "past" || Boolean(firstStep.pastCampaignId);
    }
    if (step.whoSource === "past" && !step.pastCampaignId) {
      return false;
    }
    return (Number(step.waitDays) || 0) >= 0 && Boolean(step.engagement);
  });
  const allEmailCampaignsReady = steps.every((step, index) => {
    const campaign = campaignByStep[step.id];
    if (!campaign) {
      return false;
    }
    if (campaign.status === "sent" || (index === 0 && step.whoSource === "past")) {
      return true;
    }
    const audienceOptional = index > 0;
    return readinessGaps(campaign, { audienceOptional }).length === 0;
  });
  const automationReady =
    steps.length > 0 && firstReady && followUpsConfigured && allEmailCampaignsReady;
  const locked = status !== "draft";

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
      setKind(resolvedKind);

      setSteps((prev) => {
        const base = prev.length > 0 ? prev : baseSteps;
        if (base.length === 0) {
          const step = newEmailStep({
            id: `step-${campaign.id}`,
            campaignId: campaign.id,
            campaignKind: resolvedKind,
            waitDays: 0,
          });
          setSelectedStepId(step.id);
          setCampaignByStep({ [step.id]: campaign });
          return [step];
        }

        const matchIndex = targetStepId
          ? base.findIndex((step) => step.id === targetStepId)
          : base.findIndex((step) => step.campaignId === campaign.id);
        const index = matchIndex >= 0 ? matchIndex : 0;
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
          setRecordId("");
          setStatus("draft");
          setKind("drip");
          setSteps([]);
          setSelectedStepId(null);
          setCampaignByStep({});
          setAddOpen(false);
          setLaunchNotice("");
          setLaunchError("");
          setLoadError("");
          persistEnabledRef.current = false;

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
        setSteps(
          (record.steps || []).map((step, index) =>
            index === 0
              ? step
              : {
                  ...step,
                  waitHours: Math.max(1, Math.min(23, Number(step.waitHours) || 1)),
                  waitDays: Math.max(0, Number(step.waitDays) || 0),
                },
          ),
        );
        if (record.steps[0]) {
          setSelectedStepId(record.steps[0].id);
        } else {
          setSelectedStepId(null);
        }
        await hydrateStepCampaigns(record.steps || []);

        // Only attach a returned campaign when the URL says so (Return to Automation).
        if (qId) {
          await attachReturnedCampaign(
            record.steps || [],
            qId,
            qKind,
            qStepId,
          );
        }

        persistEnabledRef.current = record.status === "draft";
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
    // Intentionally bootstrap once per mount / id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, automationId]);

  useEffect(() => {
    if (!recordId || !persistEnabledRef.current || bootstrapping || locked) {
      return;
    }
    const timer = window.setTimeout(() => {
      void patchAutomation(recordId, {
        name: name.trim() || "Untitled automation",
        kind,
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

  useEffect(() => {
    if (!addOpen) {
      return;
    }
    addWrapRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [addOpen]);

  useEffect(() => {
    if (selectedStep?.whoSource === "past") {
      void loadPastCampaigns();
    }
    // Load the picker list when a past-campaign step is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStepId, selectedStep?.whoSource]);

  useEffect(() => {
    if (!addOpen && draftWho !== "past") {
      return;
    }
    let cancelled = false;
    async function loadPast() {
      setLoadingPast(true);
      try {
        const [drip, oneone] = await Promise.all([
          fetchDripCampaigns("drip"),
          fetchDripCampaigns("oneone"),
        ]);
        if (cancelled) {
          return;
        }
        const merged = [...drip, ...oneone]
          .filter((campaign) => campaign.status === "sent" || campaign.opens > 0 || campaign.clicks > 0)
          .sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || ""));
        setPastCampaigns(merged);
        if (!draftPastId && merged[0]) {
          setDraftPastId(pastCampaignKey(merged[0]));
        }
      } catch {
        if (!cancelled) {
          setPastCampaigns([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingPast(false);
        }
      }
    }
    void loadPast();
    return () => {
      cancelled = true;
    };
  }, [addOpen, draftWho, draftPastId]);

  const ensuringRef = useRef<Promise<string> | null>(null);

  async function ensureAutomationRecord(nextSteps?: AutoStep[]): Promise<string> {
    if (recordId) {
      return recordId;
    }
    const initialSteps = nextSteps ?? steps;
    if (initialSteps.length === 0) {
      throw new Error("Add an email step before this automation is saved to history.");
    }
    if (ensuringRef.current) {
      return ensuringRef.current;
    }
    ensuringRef.current = (async () => {
      const created = await createAutomation({
        name: name.trim() || "Untitled automation",
        kind,
        steps: initialSteps,
        status: "draft",
      });
      if (created.name && created.name !== name) {
        setName(created.name);
      }
      setRecordId(created.id);
      persistEnabledRef.current = true;
      router.replace(portalAutomationRoute(created.id));
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

  function setFirstStepSource(source: WhoSource) {
    if (!firstStep || locked) {
      return;
    }
    const stepId = firstStep.id;
    if (source === "current") {
      setSteps((prev) =>
        prev.map((step, index) =>
          index === 0
            ? {
                ...step,
                whoSource: "current",
                campaignId: undefined,
                pastCampaignId: undefined,
                pastCampaignName: undefined,
                pastCampaignKind: undefined,
              }
            : step,
        ),
      );
      setCampaignByStep((current) => {
        const next = { ...current };
        delete next[stepId];
        return next;
      });
      return;
    }
    setSteps((prev) =>
      prev.map((step, index) =>
        index === 0
          ? {
              ...step,
              whoSource: "past",
              campaignId: undefined,
              pastCampaignId: undefined,
              pastCampaignName: undefined,
              pastCampaignKind: undefined,
            }
          : step,
      ),
    );
    setCampaignByStep((current) => {
      const next = { ...current };
      delete next[stepId];
      return next;
    });
    void loadPastCampaigns();
  }

  async function attachPastCampaignToFirstStep(campaign: DripCampaign) {
    if (!firstStep || locked) {
      return;
    }
    const stepId = firstStep.id;
    setLoadingCampaign(true);
    setLoadError("");
    try {
      const full =
        (await fetchDripCampaign(campaign.id, campaignKindOf(campaign))) ||
        campaign;
      const resolvedKind = campaignKindOf(full);
      setKind(resolvedKind);
      setSteps((prev) =>
        prev.map((step, index) =>
          index === 0
            ? {
                ...step,
                whoSource: "past",
                campaignId: full.id,
                campaignKind: resolvedKind,
                pastCampaignId: full.id,
                pastCampaignName: full.name,
                pastCampaignKind: resolvedKind,
              }
            : step,
        ),
      );
      setCampaignByStep((current) => ({
        ...current,
        [stepId]: full,
      }));
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Failed to load the past campaign",
      );
    } finally {
      setLoadingCampaign(false);
    }
  }

  function lastFollowUp() {
    return steps.length > 1 ? steps[steps.length - 1] : null;
  }

  function applyDraftToLastFollowUp(patch: {
    waitDays?: number;
    waitHours?: number;
    whoSource?: WhoSource;
    pastCampaignId?: string;
    pastCampaignName?: string;
    pastCampaignKind?: CampaignKind;
    engagement?: EngagementKind;
    campaignKind?: CampaignKind;
  }) {
    setSteps((current) => {
      if (current.length < 2) {
        return current;
      }
      const last = current[current.length - 1];
      if (last.campaignId) {
        return current;
      }
      const wait = normalizeWait(
        patch.waitDays ?? last.waitDays ?? 0,
        patch.waitHours ?? last.waitHours ?? 1,
      );
      return current.map((step, index) =>
        index === current.length - 1
          ? {
              ...step,
              ...wait,
              whoSource: patch.whoSource ?? step.whoSource,
              pastCampaignId:
                patch.pastCampaignId !== undefined
                  ? patch.pastCampaignId
                  : step.pastCampaignId,
              pastCampaignName:
                patch.pastCampaignName !== undefined
                  ? patch.pastCampaignName
                  : step.pastCampaignName,
              pastCampaignKind:
                patch.pastCampaignKind !== undefined
                  ? patch.pastCampaignKind
                  : step.pastCampaignKind,
              engagement: patch.engagement ?? step.engagement,
              campaignKind: patch.campaignKind ?? step.campaignKind,
            }
          : step,
      );
    });
  }

  function toggleAddStep() {
    if (locked) {
      return;
    }
    if (steps.length === 0) {
      addFirstEmailStep();
      return;
    }
    const next = !addOpen;
    setAddOpen(next);
    setLoadError("");
    if (next) {
      setSelectedStepId(null);
      const last = lastFollowUp();
      if (last && !last.campaignId) {
        const wait = normalizeWait(last.waitDays ?? 0, last.waitHours ?? 1);
        setDraftWaitDays(String(wait.waitDays));
        setDraftWaitHours(String(wait.waitHours));
        setDraftWho(last.whoSource === "past" ? "past" : "current");
        setDraftPastId(last.pastCampaignId || "");
        setDraftEngagement(last.engagement || "opens_or_clicks");
        setDraftStepKind(stepKind(last));
      }
    }
  }

  function addFirstEmailStep() {
    if (locked) {
      return;
    }
    const step = newEmailStep({ waitDays: 0 });
    const next = [step];
    setSteps(next);
    setSelectedStepId(step.id);
    setAddOpen(false);
    void ensureAutomationRecord(next).catch((error) => {
      setLoadError(
        error instanceof Error ? error.message : "Failed to save automation",
      );
    });
  }

  function confirmAddFollowUp() {
    if (locked) {
      return;
    }
    if (steps.length === 0) {
      addFirstEmailStep();
      return;
    }
    const { waitDays, waitHours } = normalizeWait(
      Number(draftWaitDays) || 0,
      Number(draftWaitHours) || 0,
    );
    if (draftWho === "past" && !draftPastId) {
      setLoadError("Pick a past campaign for opens/clicks.");
      return;
    }
    const past = findPastCampaignByKey(draftPastId, pastCampaigns);
    const pastKind: CampaignKind | undefined =
      draftWho === "past"
        ? past
          ? campaignKindOf(past)
          : "drip"
        : undefined;
    const followUpPatch: {
      campaignKind: CampaignKind;
      waitDays: number;
      waitHours: number;
      whoSource: WhoSource;
      pastCampaignId?: string;
      pastCampaignKind?: CampaignKind;
      pastCampaignName?: string;
      engagement: EngagementKind;
    } = {
      campaignKind: draftStepKind,
      waitDays,
      waitHours,
      whoSource: draftWho,
      pastCampaignId: draftWho === "past" ? past?.id || draftPastId : undefined,
      pastCampaignKind: pastKind,
      pastCampaignName: draftWho === "past" ? past?.name : undefined,
      engagement: draftEngagement,
    };
    const last = lastFollowUp();
    if (last && !last.campaignId) {
      applyDraftToLastFollowUp(followUpPatch);
      setAddOpen(false);
      setLoadError("");
      return;
    }
    const step = newEmailStep(followUpPatch);
    setSteps((prev) => [...prev, step]);
    setSelectedStepId(step.id);
    setAddOpen(false);
    setLoadError("");
  }

  async function createAndOpenCampaign(step: AutoStep) {
    if (creating || locked) {
      return;
    }
    setCreating(true);
    setLoadError("");
    try {
      const stepIndex = steps.findIndex((item) => item.id === step.id);
      const isFollowUp = stepIndex > 0;
      const campaignKind = stepKind(step);
      const autoId = await ensureAutomationRecord(
        steps.map((item) =>
          item.id === step.id ? item : item,
        ),
      );
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
        void patchAutomation(autoId, { name: data.name }).catch(() => {
          /* ignore */
        });
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
      }

      await patchDripCampaign(data.id, patch, campaignKind);

      setSteps((prev) =>
        prev.map((item) =>
          item.id === step.id
            ? { ...item, campaignId: data.id, campaignKind }
            : item,
        ),
      );

      sessionStorage.setItem(
        AUTOMATION_LINK_KEY,
        JSON.stringify({
          campaignId: data.id,
          kind: campaignKind,
          stepId: step.id,
          followUp: isFollowUp,
          automationId: autoId,
        }),
      );

      if (isFollowUp) {
        setLaunchNotice(
          "Follow-up campaign created. Sender matches step 1. Recipients fill automatically from opens & clicks after the wait.",
        );
      }

      const followUpQuery = isFollowUp ? "&automationFollowUp=1" : "";
      router.push(
        `${portalCampaignRoute(data.id, campaignKind)}?fromAutomation=1&stepId=${encodeURIComponent(step.id)}${followUpQuery}&automationId=${encodeURIComponent(autoId)}`,
      );
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Failed to create campaign",
      );
    } finally {
      setCreating(false);
    }
  }

  function openStepCampaign(step: AutoStep) {
    if (!step.campaignId || locked) {
      return;
    }
    const campaignKind = step.campaignKind === "oneone" ? "oneone" : "drip";
    const stepIndex = steps.findIndex((item) => item.id === step.id);
    const isFollowUp =
      stepIndex > 0 ||
      Boolean(
        campaignByStep[step.id]?.tags?.includes(AUTOMATION_FOLLOW_UP_TAG),
      );
    sessionStorage.setItem(
      AUTOMATION_LINK_KEY,
      JSON.stringify({
        campaignId: step.campaignId,
        kind: campaignKind,
        stepId: step.id,
        followUp: isFollowUp,
        automationId: recordId || undefined,
      }),
    );
    const followUpQuery = isFollowUp ? "&automationFollowUp=1" : "";
    const autoIdQuery = recordId
      ? `&automationId=${encodeURIComponent(recordId)}`
      : "";
    router.push(
      `${portalCampaignRoute(step.campaignId, campaignKind)}?fromAutomation=1&stepId=${encodeURIComponent(step.id)}${followUpQuery}${autoIdQuery}`,
    );
  }

  function updateSelectedFollowUp(patch: Partial<AutoStep>) {
    if (!selectedStepId || locked) {
      return;
    }
    setSteps((prev) =>
      prev.map((step) =>
        step.id === selectedStepId ? { ...step, ...patch } : step,
      ),
    );
  }

  async function sendChat(text: string) {
    const message = text.trim();
    if (!message || chatting) {
      return;
    }
    setChatting(true);
    setChatError("");
    const nextHistory = [...chat, { role: "user" as const, content: message }];
    setChat(nextHistory);
    setDraft("");
    try {
      const response = await fetch("/api/automation/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: nextHistory,
          context: {
            kind,
            campaignName: name,
            stepCount: steps.length,
          },
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Chat failed",
        );
      }
      setChat((prev) => [
        ...prev,
        { role: "assistant", content: String(data.reply || "") },
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
      const alreadySent =
        firstCampaign.status === "sent" || firstStep?.whoSource === "past";
      if (!alreadySent) {
        const timezone = firstCampaign.timezone || "Asia/Kolkata";
        const response = await fetch("/api/campaigns/launch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign: firstCampaign,
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
          kind,
        });
      }
      setStatus(nextStatus);
      persistEnabledRef.current = false;
      setScheduleOpen(false);
      setAddOpen(false);
      const followUpCount = Math.max(0, steps.length - 1);
      setLaunchNotice(
        alreadySent
          ? followUpCount > 0
            ? "Started from the past campaign. Follow-ups will send after the wait to openers/clickers."
            : "Started from the past campaign. This automation is now locked."
          : followUpCount > 0
            ? scheduleMode === "now"
              ? `Step 1 launched. This automation is now locked.`
              : `Step 1 scheduled. This automation is now locked.`
            : scheduleMode === "now"
              ? "Campaign launched. This automation is now locked."
              : "Campaign scheduled. This automation is now locked.",
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

  return (
    <div className={`auto-page${sidebarOpen ? "" : " sidebar-collapsed"}`}>
      <aside className="auto-ai">
        <div className="auto-ai-top">
          <h2>How can I help you today?</h2>
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
                key={item}
                type="button"
                className="auto-ai-chip"
                onClick={() => void sendChat(item)}
              >
                {item}
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
                {turn.content}
              </div>
            ))}
            {chatting ? (
              <div className="auto-ai-bubble assistant">Thinking…</div>
            ) : null}
            <div ref={chatEndRef} />
          </div>
        )}

        {chatError ? <p className="auto-ai-error">{chatError}</p> : null}

        <form
          className="auto-ai-composer"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void sendChat(draft);
          }}
        >
          <span className="auto-ai-context">
            {steps.some((step) => stepKind(step) === "oneone") &&
            steps.some((step) => stepKind(step) === "drip")
              ? "Drip + 1-1"
              : stepKind(steps[0] ?? { campaignKind: kind }) === "oneone"
                ? "1-1"
                : "Drip"}{" "}
            · Automation
          </span>
          <div className="auto-ai-input-row">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask about campaigns…"
              disabled={chatting}
            />
            <button
              type="submit"
              className="btn-dark"
              disabled={chatting || !draft.trim()}
            >
              Send
            </button>
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
            <span className={`auto-badge${locked ? " auto-badge-locked" : ""}`}>
              {statusBadgeLabel(status)}
            </span>
            {automationReady && !locked ? (
              <span className="auto-ready-tick" title="Ready to launch">
                ✓ Ready
              </span>
            ) : null}
            {locked ? (
              <span className="auto-ready-tick auto-locked-tick" title="Locked after launch">
                Locked
              </span>
            ) : null}
            <a className="btn-soft auto-history-link" href={portalAutomationHistoryRoute()}>
              History
            </a>
          </div>

          {locked ? (
            <button type="button" className="btn-soft auto-next" disabled>
              {statusBadgeLabel(status)}
            </button>
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
              {startingFromPast ? "Start" : "Schedule"}
            </button>
          )}
        </header>

        {locked ? (
          <div className="auto-banner-ok">
            This automation was launched and can no longer be edited. Create a new
            one from Automation if you need changes.
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
            <div className="auto-start-node">
              <div className="auto-start-row">
                <span className="lbl">Steps</span>
                <span className="val">{steps.length || "None yet"}</span>
              </div>
              <div className="auto-start-row">
                <span className="lbl">Step 1</span>
                <span className="val">
                  {firstReady
                    ? startingFromPast
                      ? "Past campaign ready"
                      : "Ready to schedule"
                    : firstCampaign
                      ? `Missing: ${firstGaps.join(", ")}`
                      : "Create first email"}
                </span>
              </div>
            </div>

            {steps.map((step, index) => {
              const open = selectedStepId === step.id;
              const campaign = campaignByStep[step.id];
              const audienceOptional = index > 0;
              const stepReady = campaign
                ? campaign.status === "sent" ||
                  (index === 0 && step.whoSource === "past") ||
                  readinessGaps(campaign, { audienceOptional }).length === 0
                : false;

              return (
                <div key={step.id} className="auto-step-block">
                  <div className="auto-connector" />
                  {index === 0 ? (
                    <div className="auto-delay-pill">
                      {step.whoSource === "past"
                        ? "Email · past campaign"
                        : "Email · start"}
                    </div>
                  ) : (
                    <div className="auto-delay-pill auto-delay-pill-wait">
                      {waitLabel(step)} · {whoLabel(step)}
                    </div>
                  )}
                  <button
                    type="button"
                    className={`auto-step-card${open ? " active" : ""}`}
                    onClick={() =>
                      setSelectedStepId((current) =>
                        current === step.id ? null : step.id,
                      )
                    }
                  >
                    <span className="auto-step-icon" aria-hidden>
                      ✉
                    </span>
                    <span className="auto-step-meta">
                      <strong>
                        Email {index + 1} · {stepKind(step) === "oneone" ? "1-1" : "Drip"}
                        {stepReady ? " ✓" : ""}
                      </strong>
                      <em>
                        {campaign?.name ||
                          step.pastCampaignName ||
                          (index === 0
                            ? step.whoSource === "past"
                              ? "Select a past campaign"
                              : "Create campaign to set up"
                            : "Set wait → then create follow-up email")}
                      </em>
                    </span>
                  </button>

                  {open ? (
                    <div
                      className="auto-step-setup"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <h4>
                        {index === 0
                          ? "Email campaign setup"
                          : `Follow-up email · step ${index + 1}`}
                      </h4>
                      {!locked && index === 0 ? (
                        <>
                          <div className="auto-field">
                            <span>Start from</span>
                            <div className="auto-kind-toggle">
                              <button
                                type="button"
                                className={
                                  step.whoSource !== "past" ? "active" : ""
                                }
                                onClick={() => setFirstStepSource("current")}
                              >
                                Create new
                              </button>
                              <button
                                type="button"
                                className={
                                  step.whoSource === "past" ? "active" : ""
                                }
                                onClick={() => setFirstStepSource("past")}
                              >
                                Past campaign
                              </button>
                            </div>
                          </div>
                          {step.whoSource === "past" ? (
                            <label className="auto-field">
                              Past campaign
                              <select
                                value={stepPastKey(step)}
                                onChange={(event) => {
                                  const picked = findPastCampaignByKey(
                                    event.target.value,
                                    pastCampaigns,
                                  );
                                  if (picked) {
                                    void attachPastCampaignToFirstStep(picked);
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
                          ) : null}
                        </>
                      ) : null}
                      {!locked ? (
                        <div className="auto-field">
                          <span>
                            {index === 0
                              ? "Send this email as"
                              : "Send this follow-up as"}
                          </span>
                          <KindToggle
                            value={stepKind(step)}
                            disabled={
                              Boolean(step.campaignId) ||
                              (index === 0 && step.whoSource === "past")
                            }
                            onChange={(next) => {
                              updateSelectedFollowUp({ campaignKind: next });
                              if (index === 0) {
                                setKind(next);
                              }
                            }}
                          />
                          {step.campaignId ||
                          (index === 0 && step.whoSource === "past") ? (
                            <p className="auto-step-setup-note">
                              {index === 0 && step.whoSource === "past"
                                ? "Type matches the past campaign and stays locked."
                                : "Type is locked after the campaign is created."}
                            </p>
                          ) : index > 0 ? (
                            <p className="auto-step-setup-note">
                              Step 1 can be Drip and this step can be 1-1 (or the
                              reverse). After the wait, openers/clickers get this
                              campaign.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {locked ? (
                        <p className="auto-step-setup-note">
                          View only — this automation is locked after launch.
                          {index > 0
                            ? ` ${waitLabel(step)} · ${whoLabel(step)}.`
                            : ""}
                        </p>
                      ) : null}
                      {!locked && index > 0 ? (
                        <>
                          <p className="auto-step-setup-note">
                            Sender is copied from step 1 (not editable). Recipients stay
                            empty in Drip and fill automatically from opens &amp; clicks
                            after the wait — then this step becomes launch-ready. Finish
                            subject/design in Drip / 1-1, then return here.
                          </p>
                          <div className="auto-wait-grid">
                            <label className="auto-field">
                              Wait (days)
                              <input
                                type="number"
                                min={0}
                                value={String(step.waitDays ?? 0)}
                                onChange={(event) =>
                                  updateSelectedFollowUp(
                                    normalizeWait(
                                      Number(event.target.value) || 0,
                                      Number(step.waitHours) || 0,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label className="auto-field">
                              Hours (0–23)
                              <input
                                type="number"
                                min={0}
                                max={23}
                                value={String(step.waitHours ?? 0)}
                                onChange={(event) =>
                                  updateSelectedFollowUp(
                                    normalizeWait(
                                      Number(step.waitDays) || 0,
                                      Number(event.target.value) || 0,
                                    ),
                                  )
                                }
                              />
                            </label>
                          </div>
                          <div className="auto-field">
                            <span>Who engaged</span>
                            <div className="auto-kind-toggle">
                              <button
                                type="button"
                                className={
                                  step.whoSource !== "past" ? "active" : ""
                                }
                                onClick={() =>
                                  updateSelectedFollowUp({
                                    whoSource: "current",
                                    pastCampaignId: undefined,
                                    pastCampaignName: undefined,
                                  })
                                }
                              >
                                Current campaign
                              </button>
                              <button
                                type="button"
                                className={
                                  step.whoSource === "past" ? "active" : ""
                                }
                                onClick={() => {
                                  setAddOpen(false);
                                  updateSelectedFollowUp({ whoSource: "past" });
                                  void loadPastCampaigns();
                                }}
                              >
                                Past campaign
                              </button>
                            </div>
                          </div>
                          {step.whoSource === "past" ? (
                            <label className="auto-field">
                              Past campaign
                              <select
                                value={stepPastKey(step)}
                                onChange={(event) => {
                                  const picked = findPastCampaignByKey(
                                    event.target.value,
                                    pastCampaigns,
                                  );
                                  updateSelectedFollowUp({
                                    pastCampaignId: picked?.id,
                                    pastCampaignName: picked?.name,
                                    pastCampaignKind: picked
                                      ? campaignKindOf(picked)
                                      : undefined,
                                  });
                                }}
                              >
                                <option value="">
                                  {loadingPast ? "Loading…" : "Select campaign"}
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
                          ) : (
                            <p className="auto-step-setup-note">
                              Uses engagers from the previous email in this automation
                              after the wait.
                            </p>
                          )}
                          <div className="auto-field">
                            <span>Engagement</span>
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
                                    step.engagement === value ? "active" : ""
                                  }
                                  onClick={() =>
                                    updateSelectedFollowUp({ engagement: value })
                                  }
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : !locked && step.whoSource === "past" ? (
                        <p className="auto-step-setup-note">
                          This email already went out. It will not be sent again.
                          Follow-ups wait, then go to people who opened or clicked
                          it. Schedule becomes Start when the rest of the
                          automation is ready.
                        </p>
                      ) : !locked ? (
                        <p className="auto-step-setup-note">
                          Open Drip or 1-1 to finish the campaign (sender, list,
                          design). Then return here — Schedule unlocks with a ✓ when
                          the automation is ready.
                        </p>
                      ) : null}
                      {!locked ? (
                        <>
                          <label className="auto-field">
                            Automation name
                            <input
                              value={name}
                              onChange={(event) => setName(event.target.value)}
                              placeholder="Campaign name"
                            />
                          </label>
                          <div className="auto-step-setup-actions">
                            {step.campaignId ? (
                              <button
                                type="button"
                                className="btn-soft"
                                onClick={() => openStepCampaign(step)}
                              >
                                {index === 0 && step.whoSource === "past"
                                  ? `View in ${stepKind(step) === "oneone" ? "1-1" : "Drip"}`
                                  : `Edit in ${stepKind(step) === "oneone" ? "1-1" : "Drip"}`}
                              </button>
                            ) : null}
                            {!(index === 0 && step.whoSource === "past") ? (
                              <button
                                type="button"
                                className="btn-dark"
                                disabled={creating}
                                onClick={() => void createAndOpenCampaign(step)}
                              >
                                {creating
                                  ? "Opening…"
                                  : step.campaignId
                                    ? "Re-open campaign setup"
                                    : `Create ${stepKind(step) === "oneone" ? "1-1" : "Drip"} campaign`}
                              </button>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {!locked ? (
            <div className="auto-add-wrap" ref={addWrapRef}>
              <div className="auto-connector short" />
              <button
                type="button"
                className={`auto-add-btn${addOpen ? " active" : ""}`}
                onClick={toggleAddStep}
              >
                + Add step
              </button>
              {addOpen ? (
                <div className="auto-add-menu auto-add-menu-wide">
                  <h4 className="auto-add-title">Next email after wait</h4>
                  <p className="auto-add-desc">
                    Wait a gap, then email people who opened or clicked. This next
                    step can be Drip or 1-1, independent of step 1.
                  </p>
                  <div className="auto-field">
                    <span>Send next email as</span>
                    <KindToggle
                      value={draftStepKind}
                      onChange={(next) => {
                        setDraftStepKind(next);
                        applyDraftToLastFollowUp({ campaignKind: next });
                      }}
                    />
                  </div>
                  <div className="auto-delay-pill auto-delay-pill-wait">
                    {waitLabel({
                      waitDays: Number(draftWaitDays) || 0,
                      waitHours: Number(draftWaitHours) || 0,
                    })}{" "}
                    · {draftWho === "past" ? "Past campaign" : "Current campaign"} ·{" "}
                    {draftEngagement === "opens"
                      ? "opens"
                      : draftEngagement === "clicks"
                        ? "clicks"
                        : "opens or clicks"}
                  </div>
                  <div className="auto-wait-grid">
                    <label className="auto-field">
                      After how many days
                      <input
                        type="number"
                        min={0}
                        value={draftWaitDays}
                        onChange={(event) => {
                          const waitDays = Math.max(0, Number(event.target.value) || 0);
                          setDraftWaitDays(String(waitDays));
                          applyDraftToLastFollowUp({
                            waitDays,
                            waitHours: Number(draftWaitHours) || 0,
                          });
                        }}
                      />
                    </label>
                    <label className="auto-field">
                      Hours (0–23)
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={draftWaitHours}
                        onChange={(event) => {
                          const waitHours = Math.max(
                            0,
                            Math.min(23, Number(event.target.value) || 0),
                          );
                          setDraftWaitHours(String(waitHours));
                          applyDraftToLastFollowUp({
                            waitDays: Number(draftWaitDays) || 0,
                            waitHours,
                          });
                        }}
                      />
                    </label>
                  </div>
                  <div className="auto-field">
                    <span>Source</span>
                    <div className="auto-kind-toggle auto-kind-stack">
                      <button
                        type="button"
                        className={draftWho === "current" ? "active" : ""}
                        onClick={() => {
                          setDraftWho("current");
                          applyDraftToLastFollowUp({ whoSource: "current" });
                        }}
                      >
                        Current campaign
                      </button>
                      <button
                        type="button"
                        className={draftWho === "past" ? "active" : ""}
                        onClick={() => {
                          setDraftWho("past");
                          applyDraftToLastFollowUp({ whoSource: "past" });
                          void loadPastCampaigns();
                        }}
                      >
                        Past campaign
                      </button>
                    </div>
                  </div>
                  {draftWho === "past" ? (
                    <label className="auto-field">
                      Past campaign
                      <select
                        value={draftPastId}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDraftPastId(value);
                          const picked = findPastCampaignByKey(
                            value,
                            pastCampaigns,
                          );
                          applyDraftToLastFollowUp({
                            whoSource: "past",
                            pastCampaignId: picked?.id,
                            pastCampaignName: picked?.name,
                            pastCampaignKind: picked
                              ? campaignKindOf(picked)
                              : undefined,
                          });
                        }}
                      >
                        <option value="">
                          {loadingPast ? "Loading…" : "Select campaign"}
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
                  ) : null}
                  <div className="auto-field">
                    <span>Engagement</span>
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
                          className={draftEngagement === value ? "active" : ""}
                          onClick={() => {
                            setDraftEngagement(value);
                            applyDraftToLastFollowUp({ engagement: value });
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="auto-step-setup-actions">
                    <button
                      type="button"
                      className="btn-soft"
                      onClick={() => setAddOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-dark"
                      onClick={confirmAddFollowUp}
                    >
                      {lastFollowUp() && !lastFollowUp()?.campaignId
                        ? "Save wait"
                        : "Add email step"}
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
              <h3>{startingFromPast ? "Start automation" : "Schedule"}</h3>
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
                {startingFromPast
                  ? "Email 1 already sent. Start the automation so follow-ups wait, then go to openers/clickers of that campaign."
                  : "When should step 1 send? Follow-ups wait their gap, then go to openers/clickers."}
              </div>
              {!startingFromPast ? (
              <label className="drip-schedule-option">
                <input
                  type="radio"
                  name="auto-schedule-mode"
                  checked={scheduleMode === "now"}
                  onChange={() => setScheduleMode("now")}
                />
                <span>Send now</span>
              </label>
              ) : null}
              {!startingFromPast ? (
              <label className="drip-schedule-option">
                <input
                  type="radio"
                  name="auto-schedule-mode"
                  checked={scheduleMode === "later"}
                  onChange={() => setScheduleMode("later")}
                />
                <span>Schedule for later</span>
              </label>
              ) : null}
              {!startingFromPast && scheduleMode === "later" ? (
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
                  : startingFromPast
                    ? "Start automation"
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
