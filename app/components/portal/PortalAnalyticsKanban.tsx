"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  autoStageId,
  chatKanbanBoard,
  companyFaviconUrl,
  DEFAULT_STAGE_COLOR,
  fetchKanbanBoard,
  fetchKanbanLists,
  KANBAN_DOT_COLORS,
  KANBAN_STAGE_RULES,
  patchKanbanBoard,
  kanbanPeopleForBotFilter,
  personReachesStageRule,
  portalContactsKanbanPickRoute,
  portalKanbanRoute,
  stageIdForPerson,
  type KanbanBoard,
  type KanbanCampaignRef,
  type KanbanList,
  type KanbanManualPerson,
  type KanbanPerson,
  type KanbanStage,
} from "@/lib/analytics-kanban";
import {
  campaignKeysFromPipeline,
  mergeImportedStages,
} from "@/lib/analytics-kanban-pipeline-import";
import {
  fetchDripCampaigns,
  type DripCampaign,
} from "@/lib/drip-campaigns";
import { PORTAL_ROUTES, portalContactRoute } from "@/lib/portal-nav";
import { formatAnalyticsExpiry } from "@/lib/analytics";
import PipelineFunnelChart from "@/app/components/portal/PipelineFunnelChart";

const CARD_BATCH = 30;

function campaignKey(campaign: Pick<DripCampaign, "id" | "kind">) {
  return `${campaign.kind === "oneone" ? "oneone" : "drip"}:${campaign.id}`;
}

function displayName(person: KanbanPerson) {
  const name = person.fullName.trim();
  if (name && name.toLowerCase() !== person.email.trim().toLowerCase()) {
    return name;
  }
  return person.email;
}

function stageLabel(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return name;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function stageDotColor(stage: KanbanStage) {
  return stage.color || DEFAULT_STAGE_COLOR;
}

function StageGrip() {
  return (
    <span className="an-kanban-grip" aria-hidden>
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function CompanyMark({
  logoUrl,
  domain,
}: {
  logoUrl?: string;
  domain?: string;
}) {
  const [source, setSource] = useState<"brand" | "favicon" | "icon">(
    logoUrl ? "brand" : domain ? "favicon" : "icon",
  );

  useEffect(() => {
    setSource(logoUrl ? "brand" : domain ? "favicon" : "icon");
  }, [logoUrl, domain]);

  if (source === "brand" && logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="an-kanban-company-logo"
        src={logoUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setSource(domain ? "favicon" : "icon")}
      />
    );
  }

  if (source === "favicon" && domain) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="an-kanban-company-logo"
        src={companyFaviconUrl(domain)}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setSource("icon")}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

export default function PortalAnalyticsKanban({
  boardId,
  sharedBoard,
  shareToken,
  initialView = "board",
  initialHideBotClicks = false,
}: {
  boardId: string;
  /** Public view: cards can move between stages; no stage edits, chat or portal links. */
  sharedBoard?: KanbanBoard;
  shareToken?: string;
  /** Board | Funnel — used by public links (`?view=funnel`). */
  initialView?: "board" | "funnel";
  /** Public links can start with bots hidden (`?hideBotClicks=1`). */
  initialHideBotClicks?: boolean;
}) {
  const readOnly = Boolean(sharedBoard);
  const [board, setBoard] = useState<KanbanBoard | null>(sharedBoard ?? null);
  const [loading, setLoading] = useState(!sharedBoard);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareExpiresAt, setShareExpiresAt] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [stageName, setStageName] = useState("");
  const [stageColor, setStageColor] = useState<string>(DEFAULT_STAGE_COLOR);
  const [adding, setAdding] = useState(false);
  const [draggingPerson, setDraggingPerson] = useState("");
  const [draggingStage, setDraggingStage] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [leadQuery, setLeadQuery] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chat, setChat] = useState<Array<{ role: "user" | "assistant"; content: string }>>(
    [],
  );
  const [editingCampaigns, setEditingCampaigns] = useState(false);
  const [allCampaigns, setAllCampaigns] = useState<DripCampaign[]>([]);
  const [pipelineLists, setPipelineLists] = useState<KanbanList[]>([]);
  const [campaignEditSource, setCampaignEditSource] = useState<"campaigns" | "pipeline">(
    "campaigns",
  );
  const [pickedCampaigns, setPickedCampaigns] = useState<string[]>([]);
  const [sourcePipelineId, setSourcePipelineId] = useState("");
  const [pipelineScope, setPipelineScope] = useState<"full" | "stages">("full");
  const [pipelineStageIds, setPipelineStageIds] = useState<string[]>([]);
  const [importPipelineStages, setImportPipelineStages] = useState(true);
  const [savingCampaigns, setSavingCampaigns] = useState(false);
  const [campaignQuery, setCampaignQuery] = useState("");
  const [pipelineQuery, setPipelineQuery] = useState("");
  const [visibleByStage, setVisibleByStage] = useState<Record<string, number>>({});
  const [editingStageId, setEditingStageId] = useState("");
  const [editingStageName, setEditingStageName] = useState("");
  const [editingBoardName, setEditingBoardName] = useState(false);
  const [boardNameDraft, setBoardNameDraft] = useState("");
  const [removeLeadPrompt, setRemoveLeadPrompt] = useState<{
    email: string;
    name: string;
  } | null>(null);
  const [removingLead, setRemovingLead] = useState(false);
  const [removeStagePrompt, setRemoveStagePrompt] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [headMenuOpen, setHeadMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"board" | "funnel">(
    initialView === "funnel" ? "funnel" : "board",
  );
  const [hideBotClicks, setHideBotClicks] = useState(Boolean(initialHideBotClicks));
  const showBotEngagement = !hideBotClicks;
  const router = useRouter();

  function patchPublicQuery(mutate: (url: URL) => void) {
    if (!shareToken || typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    mutate(url);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function setPipelineView(next: "board" | "funnel") {
    setViewMode(next);
    if (next === "funnel") {
      setEditingCampaigns(false);
    }
    patchPublicQuery((url) => {
      if (next === "funnel") {
        url.searchParams.set("view", "funnel");
      } else {
        url.searchParams.delete("view");
      }
    });
  }

  function setBotFilter(hideBots: boolean) {
    setHideBotClicks(hideBots);
    patchPublicQuery((url) => {
      if (hideBots) {
        url.searchParams.set("hideBotClicks", "1");
      } else {
        url.searchParams.delete("hideBotClicks");
      }
    });
  }
  const boardRef = useRef<HTMLDivElement | null>(null);
  const editStageInputRef = useRef<HTMLInputElement | null>(null);
  const editBoardNameInputRef = useRef<HTMLInputElement | null>(null);
  const headMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!headMenuOpen) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      if (!headMenuRef.current?.contains(event.target as Node)) {
        setHeadMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setHeadMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [headMenuOpen]);


  function scrollElementIntoView(
    container: HTMLElement,
    target: HTMLElement,
    axis: "left" | "top",
    pad: number,
  ) {
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const start = axis === "left" ? containerRect.left : containerRect.top;
    const end = axis === "left" ? containerRect.right : containerRect.bottom;
    const targetStart = axis === "left" ? targetRect.left : targetRect.top;
    const targetEnd = axis === "left" ? targetRect.right : targetRect.bottom;
    let delta = 0;
    if (targetEnd > end) {
      delta = targetEnd - end + pad;
    } else if (targetStart < start) {
      delta = targetStart - start - pad;
    }
    if (delta !== 0) {
      container.scrollBy({
        [axis]: delta,
        behavior: "smooth",
      });
    }
  }

  function scrollBoardToHiddenMatch() {
    const scroller = boardRef.current;
    if (!scroller || !leadQuery.trim()) {
      return;
    }
    const matches = Array.from(
      scroller.querySelectorAll<HTMLElement>(".an-kanban-card.matched"),
    );
    if (matches.length === 0) {
      return;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const target =
      matches.find((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left > scrollerRect.right - 8 || rect.right > scrollerRect.right + 8;
      }) ?? matches[0];
    scrollElementIntoView(scroller, target, "left", 24);
    const columnCards = target.closest<HTMLElement>(".an-kanban-cards");
    if (columnCards) {
      scrollElementIntoView(columnCards, target, "top", 12);
    }
  }

  function scrollBoardWhileDragging(event: React.DragEvent<HTMLElement>) {
    const scroller = boardRef.current;
    if (!scroller) {
      return;
    }
    const rect = scroller.getBoundingClientRect();
    const edge = 96;
    const maxSpeed = 28;
    let delta = 0;
    if (event.clientX > rect.right - edge) {
      const t = Math.min(1, (event.clientX - (rect.right - edge)) / edge);
      delta = Math.ceil(maxSpeed * t);
    } else if (event.clientX < rect.left + edge) {
      const t = Math.min(1, (rect.left + edge - event.clientX) / edge);
      delta = -Math.ceil(maxSpeed * t);
    }
    if (delta !== 0) {
      scroller.scrollLeft += delta;
    }
  }

  useEffect(() => {
    if (readOnly) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchKanbanBoard(boardId)
      .then((next) => {
        if (!cancelled) {
          setBoard(next);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setBoard(null);
          setError(err instanceof Error ? err.message : "Failed to load board");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, readOnly]);

  async function createPublicUrl() {
    if (!board || sharing) {
      return;
    }
    setSharing(true);
    setError("");
    try {
      const response = await fetch(`/api/analytics/kanban/${encodeURIComponent(board.id)}/share`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        url?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!response.ok || !data.url) {
        throw new Error(data.error || "Failed to create public URL");
      }
      setShareUrl(data.url);
      setShareExpiresAt(data.expiresAt ?? "");
      try {
        await navigator.clipboard.writeText(data.url);
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 2400);
      } catch {
        // The link stays visible in the banner to copy by hand.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create public URL");
    } finally {
      setSharing(false);
    }
  }

  async function exportCsv() {
    if (!board || exportingCsv) {
      return;
    }
    setExportingCsv(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (hideBotClicks) {
        params.set("hideBotClicks", "1");
      }
      const query = params.toString();
      const path = shareToken
        ? `/api/public/kanban/${encodeURIComponent(shareToken)}/export`
        : `/api/analytics/kanban/${encodeURIComponent(board.id)}/export`;
      const response = await fetch(`${path}${query ? `?${query}` : ""}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || "Failed to export CSV");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const matched = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(
        disposition,
      );
      const filename = matched
        ? decodeURIComponent(matched[1] || matched[2])
        : `${board.name || "pipeline"}.csv`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export CSV");
    } finally {
      setExportingCsv(false);
    }
  }

  const visiblePeople = useMemo(
    () =>
      board
        ? kanbanPeopleForBotFilter(board.people, hideBotClicks)
        : [],
    [board, hideBotClicks],
  );

  const columns = useMemo(() => {
    if (!board) {
      return [];
    }
    const byStage = new Map<string, KanbanPerson[]>(
      board.stages.map((stage) => [stage.id, []]),
    );
    for (const person of visiblePeople) {
      const stageId = stageIdForPerson(person, board.placements, board.stages);
      if (stageId) {
        byStage.get(stageId)?.push(person);
      }
    }
    return board.stages.map((stage) => ({
      stage,
      people: byStage.get(stage.id) ?? [],
    }));
  }, [board, visiblePeople]);

  const funnelStages = useMemo(() => {
    if (!board) {
      return [];
    }
    return board.stages.map((stage) => {
      // Rule stages use cumulative reach (Open = opened OR clicked).
      // Custom stages stay as exclusive board-column counts.
      const people = stage.rule
        ? visiblePeople.filter((person) =>
            personReachesStageRule(person, stage.rule!),
          )
        : (columns.find((column) => column.stage.id === stage.id)?.people ??
          []);
      return {
        key: stage.id,
        label: stageLabel(stage.name),
        hint: `${people.length} lead${people.length === 1 ? "" : "s"}`,
        value: people.length,
      };
    });
  }, [board, columns, visiblePeople]);

  function visibleLimit(stageId: string, people: KanbanPerson[]) {
    const base = visibleByStage[stageId] ?? CARD_BATCH;
    const query = leadQuery.trim().toLowerCase();
    if (!query) {
      return base;
    }
    let lastMatch = -1;
    people.forEach((person, index) => {
      if (
        person.email.toLowerCase().includes(query) ||
        displayName(person).toLowerCase().includes(query) ||
        person.companyName.toLowerCase().includes(query)
      ) {
        lastMatch = index;
      }
    });
    return Math.max(base, lastMatch + 1);
  }

  function loadMoreOnScroll(stageId: string, total: number, element: HTMLElement) {
    const shown = visibleByStage[stageId] ?? CARD_BATCH;
    if (shown >= total) {
      return;
    }
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 240) {
      setVisibleByStage((current) => ({
        ...current,
        [stageId]: (current[stageId] ?? CARD_BATCH) + CARD_BATCH,
      }));
    }
  }

  useEffect(() => {
    if (!leadQuery.trim()) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      scrollBoardToHiddenMatch();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [leadQuery, columns]);

  // Nested column vertical scrollers steal wheel events — map horizontal
  // trackpad / shift+wheel gestures onto the board scroller.
  useEffect(() => {
    const scroller = boardRef.current;
    if (!scroller || !board) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      const absX = Math.abs(event.deltaX);
      const absY = Math.abs(event.deltaY);
      const shiftHorizontal = event.shiftKey && absY > 0 && absX < 1;
      const trackpadHorizontal = absX > absY && absX > 0.5;

      if (!shiftHorizontal && !trackpadHorizontal) {
        return;
      }

      const delta = shiftHorizontal ? event.deltaY : event.deltaX;
      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      if (maxScroll <= 0) {
        return;
      }

      const next = Math.min(maxScroll, Math.max(0, scroller.scrollLeft + delta));
      if (next === scroller.scrollLeft) {
        return;
      }

      event.preventDefault();
      scroller.scrollLeft = next;
    };

    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [board]);

  async function persist(
    next: Pick<KanbanBoard, "stages" | "placements"> & {
      name?: string;
      manualPeople?: KanbanManualPerson[];
      excludedEmails?: string[];
    },
  ) {
    if (!board) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (shareToken) {
        const response = await fetch(`/api/public/kanban/${encodeURIComponent(shareToken)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ placements: next.placements }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          placements?: Record<string, string>;
          error?: string;
        };
        if (!response.ok || !data.placements) {
          throw new Error(data.error || "Failed to save");
        }
        const placements = data.placements;
        setBoard((current) => (current ? { ...current, placements } : current));
        return;
      }
      const saved = await patchKanbanBoard(board.id, next);
      setBoard((current) => ({
        ...saved,
        people:
          saved.people.length > 0
            ? saved.people
            : (current?.people ?? saved.people),
        manualPeople: saved.manualPeople ?? current?.manualPeople ?? [],
        excludedEmails:
          saved.excludedEmails ?? current?.excludedEmails ?? [],
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function startRenameBoard() {
    if (!board || readOnly) {
      return;
    }
    setEditingBoardName(true);
    setBoardNameDraft(board.name);
    setError("");
  }

  function cancelRenameBoard() {
    setEditingBoardName(false);
    setBoardNameDraft("");
  }

  function commitRenameBoard() {
    if (!board || !editingBoardName) {
      return;
    }
    const name = boardNameDraft.trim().slice(0, 80);
    if (!name) {
      setError("Kanban name is required");
      return;
    }
    if (name === board.name) {
      cancelRenameBoard();
      return;
    }
    setBoard({ ...board, name });
    cancelRenameBoard();
    void persist({
      name,
      stages: board.stages,
      placements: board.placements,
    });
  }

  async function confirmRemoveLead() {
    if (!board || !removeLeadPrompt || readOnly) {
      return;
    }
    const email = removeLeadPrompt.email.trim().toLowerCase();
    const excludedEmails = [
      ...new Set([...(board.excludedEmails ?? []), email]),
    ];
    const manualPeople = (board.manualPeople ?? []).filter(
      (person) => person.email.trim().toLowerCase() !== email,
    );
    const placements = { ...board.placements };
    delete placements[email];
    const people = board.people.filter(
      (person) => person.email.trim().toLowerCase() !== email,
    );
    setRemovingLead(true);
    setError("");
    setBoard({
      ...board,
      people,
      placements,
      manualPeople,
      excludedEmails,
    });
    setRemoveLeadPrompt(null);
    try {
      await persist({
        stages: board.stages,
        placements,
        manualPeople,
        excludedEmails,
      });
    } finally {
      setRemovingLead(false);
    }
  }

  function movePerson(person: KanbanPerson, stageId: string) {
    if (!board) {
      return;
    }
    const email = person.email.trim().toLowerCase();
    const next = { ...board.placements };
    if (autoStageId(person, board.stages) === stageId) {
      delete next[email];
    } else {
      next[email] = stageId;
    }
    setBoard({ ...board, placements: next });
    void persist({ stages: board.stages, placements: next });
  }

  function moveStage(fromId: string, toId: string) {
    if (!board || fromId === toId) {
      return;
    }
    const from = board.stages.findIndex((stage) => stage.id === fromId);
    const to = board.stages.findIndex((stage) => stage.id === toId);
    if (from < 0 || to < 0) {
      return;
    }
    const stages = [...board.stages];
    const [item] = stages.splice(from, 1);
    stages.splice(to, 0, item);
    setBoard({ ...board, stages });
    void persist({ stages, placements: board.placements });
  }

  function addStage() {
    const name = stageName.trim();
    if (!board || !name) {
      return;
    }
    if (board.stages.some((stage) => stage.name.toLowerCase() === name.toLowerCase())) {
      setError("That stage already exists");
      return;
    }
    const stage: KanbanStage = {
      id: `stage-${Math.random().toString(36).slice(2, 10)}`,
      name,
      color: stageColor,
    };
    const stages = [...board.stages, stage];
    setStageName("");
    setStageColor(DEFAULT_STAGE_COLOR);
    setAdding(false);
    setBoard({ ...board, stages });
    void persist({ stages, placements: board.placements });
  }

  function confirmRemoveStage() {
    if (!board || !removeStagePrompt) {
      return;
    }
    const stageId = removeStagePrompt.id;
    const stages = board.stages.filter((stage) => stage.id !== stageId);
    const placements = { ...board.placements };
    for (const [email, id] of Object.entries(placements)) {
      if (id === stageId) {
        delete placements[email];
      }
    }
    setRemoveStagePrompt(null);
    setBoard({ ...board, stages, placements });
    void persist({ stages, placements });
  }

  function startRenameStage(stage: KanbanStage) {
    setEditingStageId(stage.id);
    setEditingStageName(stage.name);
    setError("");
  }

  function cancelRenameStage() {
    setEditingStageId("");
    setEditingStageName("");
  }

  function commitRenameStage() {
    if (!board || !editingStageId) {
      return;
    }
    const name = editingStageName.trim().slice(0, 40);
    const current = board.stages.find((stage) => stage.id === editingStageId);
    if (!current) {
      cancelRenameStage();
      return;
    }
    if (!name) {
      setError("Stage name is required");
      return;
    }
    if (
      board.stages.some(
        (stage) =>
          stage.id !== editingStageId &&
          stage.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      setError("That stage already exists");
      return;
    }
    if (current.name === name) {
      cancelRenameStage();
      return;
    }
    const stages = board.stages.map((stage) =>
      stage.id === editingStageId ? { ...stage, name } : stage,
    );
    setBoard({ ...board, stages });
    cancelRenameStage();
    void persist({ stages, placements: board.placements });
  }

  useEffect(() => {
    if (!editingStageId) {
      return;
    }
    const input = editStageInputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, [editingStageId]);

  useEffect(() => {
    if (!editingBoardName) {
      return;
    }
    const input = editBoardNameInputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, [editingBoardName]);

  const pickableCampaigns = useMemo(
    () =>
      allCampaigns
        .filter(
          (campaign) =>
            campaign.status === "sent" ||
            campaign.status === "sending" ||
            campaign.status === "paused" ||
            (campaign.delivered ?? campaign.recipients) > 0,
        )
        .sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || "")),
    [allCampaigns],
  );

  const visibleCampaigns = useMemo(() => {
    const query = campaignQuery.trim().toLowerCase();
    if (!query) {
      return pickableCampaigns;
    }
    return pickableCampaigns.filter((campaign) => {
      const kind = campaign.kind === "oneone" ? "1-1" : "drip";
      const status =
        campaign.status === "sending"
          ? "running"
          : campaign.status === "paused"
            ? "paused"
            : "sent";
      return (
        campaign.name.toLowerCase().includes(query) ||
        kind.includes(query) ||
        status.includes(query)
      );
    });
  }, [campaignQuery, pickableCampaigns]);

  const otherPipelines = useMemo(
    () => pipelineLists.filter((item) => item.id !== board?.id),
    [pipelineLists, board?.id],
  );

  const visiblePipelines = useMemo(() => {
    const query = pipelineQuery.trim().toLowerCase();
    if (!query) {
      return otherPipelines;
    }
    return otherPipelines.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.campaigns.some((campaign) => campaign.name.toLowerCase().includes(query)),
    );
  }, [otherPipelines, pipelineQuery]);

  const sourcePipeline = useMemo(
    () => otherPipelines.find((item) => item.id === sourcePipelineId) ?? null,
    [otherPipelines, sourcePipelineId],
  );

  function campaignRefKey(campaign: KanbanCampaignRef) {
    return `${campaign.kind}:${campaign.campaignId}`;
  }

  function applyPipelineSelection(pipeline: KanbanList) {
    setSourcePipelineId(pipeline.id);
    setPipelineScope("full");
    setPipelineStageIds(pipeline.stages.map((stage) => stage.id));
    setPickedCampaigns((current) => {
      const next = new Set(current);
      for (const key of campaignKeysFromPipeline(pipeline)) {
        next.add(key);
      }
      return [...next];
    });
  }

  function stagesToImport(pipeline: KanbanList): KanbanStage[] {
    return pipelineScope === "full"
      ? pipeline.stages
      : pipeline.stages.filter((stage) => pipelineStageIds.includes(stage.id));
  }

  async function openCampaignEditor() {
    setEditingCampaigns(true);
    setCampaignEditSource("campaigns");
    setCampaignQuery("");
    setPipelineQuery("");
    setSourcePipelineId("");
    setPipelineScope("full");
    setPipelineStageIds([]);
    setImportPipelineStages(true);
    setChatOpen(false);
    if (board) {
      setPickedCampaigns(
        board.campaigns.map(
          (campaign) => `${campaign.kind}:${campaign.campaignId}`,
        ),
      );
    }
    try {
      const tasks: Array<Promise<void>> = [];
      if (allCampaigns.length === 0) {
        tasks.push(
          Promise.all([fetchDripCampaigns("drip"), fetchDripCampaigns("oneone")]).then(
            ([drip, oneone]) => {
              setAllCampaigns([...drip, ...oneone]);
            },
          ),
        );
      }
      if (pipelineLists.length === 0) {
        tasks.push(
          fetchKanbanLists().then((lists) => {
            setPipelineLists(lists);
          }),
        );
      }
      if (tasks.length > 0) {
        await Promise.all(tasks);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns");
    }
  }

  async function saveCampaigns() {
    if (!board || savingCampaigns) {
      return;
    }

    const fromPickable = pickableCampaigns
      .filter((campaign) => pickedCampaigns.includes(campaignKey(campaign)))
      .map((campaign) => ({
        campaignId: campaign.id,
        kind: (campaign.kind === "oneone" ? "oneone" : "drip") as KanbanCampaignRef["kind"],
        name: campaign.name,
      }));

    const fromPipelines: KanbanCampaignRef[] = [];
    if (sourcePipeline) {
      for (const campaign of sourcePipeline.campaigns) {
        if (pickedCampaigns.includes(campaignRefKey(campaign))) {
          fromPipelines.push({
            campaignId: campaign.campaignId,
            kind: campaign.kind === "oneone" ? "oneone" : "drip",
            name: campaign.name,
          });
        }
      }
    }

    const byKey = new Map<string, KanbanCampaignRef>();
    for (const campaign of [...fromPickable, ...fromPipelines, ...board.campaigns]) {
      const key = campaignRefKey(campaign);
      if (pickedCampaigns.includes(key) && !byKey.has(key)) {
        byKey.set(key, {
          campaignId: campaign.campaignId,
          kind: campaign.kind === "oneone" ? "oneone" : "drip",
          name: campaign.name,
        });
      }
    }
    const campaigns = [...byKey.values()];
    if (campaigns.length === 0) {
      setError("Select at least one campaign or an old pipeline");
      return;
    }

    const patch: {
      campaigns: KanbanCampaignRef[];
      stages?: KanbanStage[];
    } = { campaigns };

    if (
      campaignEditSource === "pipeline" &&
      importPipelineStages &&
      sourcePipeline
    ) {
      const incoming = stagesToImport(sourcePipeline);
      if (incoming.length > 0) {
        patch.stages = mergeImportedStages(board.stages, incoming);
      }
    }

    setSavingCampaigns(true);
    setError("");
    try {
      const saved = await patchKanbanBoard(board.id, patch);
      setBoard(saved);
      setEditingCampaigns(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save campaigns");
    } finally {
      setSavingCampaigns(false);
    }
  }

  async function sendChat() {
    const message = chatDraft.trim();
    if (!board || !message || chatBusy) {
      return;
    }
    const next = [...chat, { role: "user" as const, content: message }];
    setChat(next);
    setChatDraft("");
    setChatBusy(true);
    setChatError("");
    try {
      const result = await chatKanbanBoard(board.id, {
        message,
        history: next.slice(0, -1),
      });
      setBoard(result.board);
      setChat([...next, { role: "assistant", content: result.reply }]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to chat");
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <div className="an-page an-kanban-page">
      <div className="an-kanban-head">
        <div className="an-kanban-title">
          {readOnly ? null : (
            <Link
              href={PORTAL_ROUTES["analytics-kanban"]}
              className="cd-back"
              aria-label="Back to kanban lists"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Link>
          )}
          {editingBoardName ? (
            <input
              ref={editBoardNameInputRef}
              className="an-kanban-board-name-input"
              value={boardNameDraft}
              maxLength={80}
              onChange={(event) => setBoardNameDraft(event.target.value)}
              onBlur={() => commitRenameBoard()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRenameBoard();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRenameBoard();
                }
              }}
              aria-label="Kanban name"
            />
          ) : (
            <>
              <h2>{board?.name || "Pipeline"}</h2>
              {readOnly || !board ? null : (
                <button
                  type="button"
                  className="an-kanban-rename-btn"
                  onClick={startRenameBoard}
                  aria-label="Rename kanban"
                  title="Rename"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
        {board ? (
          <div className="an-kanban-head-actions-top">
            <div className="an-kanban-view-toggle" role="group" aria-label="Board or funnel view">
              <button
                type="button"
                className={viewMode === "board" ? "is-active" : ""}
                aria-pressed={viewMode === "board"}
                onClick={() => setPipelineView("board")}
              >
                Board
              </button>
              <button
                type="button"
                className={viewMode === "funnel" ? "is-active" : ""}
                aria-pressed={viewMode === "funnel"}
                onClick={() => setPipelineView("funnel")}
              >
                Funnel
              </button>
            </div>
            <div
              className="an-kanban-view-toggle"
              role="group"
              aria-label="Bot opens and clicks"
              title={
                showBotEngagement
                  ? "Bot opens/clicks included in board and funnel"
                  : "Bot opens/clicks hidden from board and funnel"
              }
            >
              <button
                type="button"
                className={showBotEngagement ? "is-active" : ""}
                aria-pressed={showBotEngagement}
                onClick={() => setBotFilter(false)}
              >
                Bots on
              </button>
              <button
                type="button"
                className={!showBotEngagement ? "is-active" : ""}
                aria-pressed={!showBotEngagement}
                onClick={() => setBotFilter(true)}
              >
                Bots off
              </button>
            </div>
            <div className="drip-more-wrap an-kanban-head-more" ref={headMenuRef}>
              <button
                type="button"
                className={`kebab${headMenuOpen ? " active" : ""}`}
                aria-label="Board actions"
                aria-expanded={headMenuOpen}
                onClick={() => setHeadMenuOpen((open) => !open)}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="12" cy="19" r="1.6" />
                </svg>
              </button>
              {headMenuOpen ? (
                <div className="drip-more-menu" role="menu">
                  {!readOnly ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setHeadMenuOpen(false);
                        void openCampaignEditor();
                      }}
                    >
                      Campaigns
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={exportingCsv}
                    onClick={() => {
                      setHeadMenuOpen(false);
                      void exportCsv();
                    }}
                  >
                    {exportingCsv ? "Exporting…" : "Export CSV"}
                  </button>
                  {!readOnly ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={sharing}
                        onClick={() => {
                          setHeadMenuOpen(false);
                          void createPublicUrl();
                        }}
                      >
                        {shareCopied
                          ? "Public URL copied"
                          : sharing
                            ? "Creating…"
                            : "Create public URL"}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setHeadMenuOpen(false);
                          setChatOpen(true);
                          setEditingCampaigns(false);
                        }}
                      >
                        Chat
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {board && viewMode === "board" ? (
        <div className="drip-toolbar an-kanban-toolbar-search">
          <label className="drip-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={leadQuery}
              onChange={(event) => setLeadQuery(event.target.value)}
              placeholder="Search a lead by name or email…"
            />
          </label>
        </div>
      ) : null}

      {shareUrl ? (
        <div className="an-share-banner">
          <span>Share this board with a client:</span>
          <input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
          <span className="an-share-expiry">
            Read-only. Expires on {formatAnalyticsExpiry(shareExpiresAt || new Date())}.
          </span>
        </div>
      ) : null}

      {error ? <div className="an-error">{error}</div> : null}
      {loading && !board ? <div className="an-empty">Loading board…</div> : null}

      {board && editingCampaigns ? (
        <div className="an-kanban-campaigns">
          <div className="an-kanban-campaigns-top">
            <strong>Edit campaigns</strong>
            <span>
              Add campaigns directly, or pull campaigns and stages from an old
              pipeline.
            </span>
          </div>
          <div className="an-kanban-create-accordions">
            <div
              className={`an-kanban-accordion${campaignEditSource === "campaigns" ? " is-open" : ""}`}
            >
              <button
                type="button"
                className="an-kanban-accordion-trigger"
                aria-expanded={campaignEditSource === "campaigns"}
                onClick={() => setCampaignEditSource("campaigns")}
              >
                <span>Campaigns</span>
                <em>
                  {pickedCampaigns.length > 0
                    ? `${pickedCampaigns.length} selected`
                    : "Pick sent or running campaigns"}
                </em>
              </button>
              {campaignEditSource === "campaigns" ? (
                <div className="an-kanban-accordion-body">
                  <div className="an-kanban-pick">
                    {pickableCampaigns.length === 0 ? (
                      <p>No sent or running campaigns yet.</p>
                    ) : (
                      <input
                        className="an-kanban-pick-search"
                        value={campaignQuery}
                        onChange={(event) => setCampaignQuery(event.target.value)}
                        placeholder="Search campaigns…"
                      />
                    )}
                    {pickableCampaigns.length === 0 ? null : visibleCampaigns.length === 0 ? (
                      <p>No campaigns match that search.</p>
                    ) : (
                      <div className="an-kanban-pick-list">
                        {visibleCampaigns.map((campaign) => {
                          const key = campaignKey(campaign);
                          return (
                            <label key={key} className="an-kanban-pick-row">
                              <input
                                type="checkbox"
                                checked={pickedCampaigns.includes(key)}
                                onChange={() =>
                                  setPickedCampaigns((current) =>
                                    current.includes(key)
                                      ? current.filter((item) => item !== key)
                                      : [...current, key],
                                  )
                                }
                              />
                              <strong>{campaign.name}</strong>
                              <em>
                                {campaign.kind === "oneone" ? "1-1" : "Drip"} ·{" "}
                                {campaign.status === "sending"
                                  ? "Running"
                                  : campaign.status === "paused"
                                    ? "Paused"
                                    : "Sent"}
                              </em>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div
              className={`an-kanban-accordion${campaignEditSource === "pipeline" ? " is-open" : ""}`}
            >
              <button
                type="button"
                className="an-kanban-accordion-trigger"
                aria-expanded={campaignEditSource === "pipeline"}
                onClick={() => setCampaignEditSource("pipeline")}
              >
                <span>Old pipeline</span>
                <em>
                  {sourcePipeline
                    ? pipelineScope === "full"
                      ? `${sourcePipeline.name} · full pipeline`
                      : `${sourcePipeline.name} · ${pipelineStageIds.length} stage${pipelineStageIds.length === 1 ? "" : "s"}`
                    : "Import campaigns from another board"}
                </em>
              </button>
              {campaignEditSource === "pipeline" ? (
                <div className="an-kanban-accordion-body">
                  <div className="an-kanban-pick">
                    {otherPipelines.length === 0 ? (
                      <p>No other pipelines available yet.</p>
                    ) : (
                      <input
                        className="an-kanban-pick-search"
                        value={pipelineQuery}
                        onChange={(event) => setPipelineQuery(event.target.value)}
                        placeholder="Search pipelines…"
                      />
                    )}
                    {otherPipelines.length === 0 ? null : visiblePipelines.length === 0 ? (
                      <p>No pipelines match that search.</p>
                    ) : (
                      <div className="an-kanban-pick-list">
                        {visiblePipelines.map((pipeline) => {
                          const active = sourcePipelineId === pipeline.id;
                          return (
                            <div key={pipeline.id} className="an-kanban-pipeline-block">
                              <label className="an-kanban-pick-row">
                                <input
                                  type="radio"
                                  name="kanban-edit-source-pipeline"
                                  checked={active}
                                  onChange={() => applyPipelineSelection(pipeline)}
                                />
                                <strong>{pipeline.name}</strong>
                                <em>
                                  {pipeline.campaigns.length} campaign
                                  {pipeline.campaigns.length === 1 ? "" : "s"} ·{" "}
                                  {pipeline.stages.length} stage
                                  {pipeline.stages.length === 1 ? "" : "s"}
                                </em>
                              </label>
                              {active ? (
                                <div className="an-kanban-pipeline-stages">
                                  <label className="an-kanban-pick-row an-kanban-pipeline-scope">
                                    <input
                                      type="radio"
                                      name={`kanban-edit-pipeline-scope-${pipeline.id}`}
                                      checked={pipelineScope === "full"}
                                      onChange={() => {
                                        setPipelineScope("full");
                                        setPipelineStageIds(
                                          pipeline.stages.map((stage) => stage.id),
                                        );
                                        applyPipelineSelection(pipeline);
                                      }}
                                    />
                                    <strong>Full pipeline</strong>
                                    <em>Add all campaigns from this board</em>
                                  </label>
                                  <label className="an-kanban-pick-row an-kanban-pipeline-scope">
                                    <input
                                      type="radio"
                                      name={`kanban-edit-pipeline-scope-${pipeline.id}`}
                                      checked={pipelineScope === "stages"}
                                      onChange={() => setPipelineScope("stages")}
                                    />
                                    <strong>Choose stages</strong>
                                    <em>Pick stages to import (campaigns still added)</em>
                                  </label>
                                  {pipelineScope === "stages" ? (
                                    <div className="an-kanban-pipeline-stage-list">
                                      {pipeline.stages.map((stage) => (
                                        <label
                                          key={stage.id}
                                          className="an-kanban-pick-row an-kanban-pipeline-stage"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={pipelineStageIds.includes(stage.id)}
                                            onChange={() =>
                                              setPipelineStageIds((current) =>
                                                current.includes(stage.id)
                                                  ? current.filter((id) => id !== stage.id)
                                                  : [...current, stage.id],
                                              )
                                            }
                                          />
                                          <strong>
                                            <i
                                              className="an-kanban-dot"
                                              style={{ background: stage.color }}
                                              aria-hidden
                                            />
                                            {stage.name}
                                          </strong>
                                          <em>
                                            {stage.rule
                                              ? KANBAN_STAGE_RULES.find(
                                                  (item) => item.value === stage.rule,
                                                )?.label || stage.rule
                                              : "Custom"}
                                          </em>
                                        </label>
                                      ))}
                                    </div>
                                  ) : null}
                                  <label className="an-kanban-pick-row an-kanban-pipeline-scope">
                                    <input
                                      type="checkbox"
                                      checked={importPipelineStages}
                                      onChange={(event) =>
                                        setImportPipelineStages(event.target.checked)
                                      }
                                    />
                                    <strong>Also import stages</strong>
                                    <em>Merge selected stages into this board</em>
                                  </label>
                                  {pipeline.campaigns.length === 0 ? (
                                    <p>This pipeline has no campaigns linked.</p>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="an-kanban-add-actions">
            <button
              type="button"
              className="btn-link-purple"
              onClick={() => setEditingCampaigns(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-dark"
              disabled={savingCampaigns || pickedCampaigns.length === 0}
              onClick={() => void saveCampaigns()}
            >
              {savingCampaigns ? "Saving…" : "Save campaigns"}
            </button>
          </div>
        </div>
      ) : null}

      {board && viewMode === "funnel" ? (
        <div className="an-kanban-funnel-wrap">
          <div className="drip-report-section-head">
            <h3>Pipeline funnel</h3>
            <span>
              {board.people.length.toLocaleString()} lead
              {board.people.length === 1 ? "" : "s"} across{" "}
              {columns.length} stage{columns.length === 1 ? "" : "s"}
            </span>
          </div>
          {columns.length === 0 ? (
            <p className="an-empty">No stages on this board yet.</p>
          ) : (
            <PipelineFunnelChart stages={funnelStages} />
          )}
        </div>
      ) : null}

      {board && viewMode === "board" ? (
        <div className="an-kanban">
          <div
            ref={boardRef}
            className="an-kanban-board"
            onDragOver={(event) => {
              event.preventDefault();
              scrollBoardWhileDragging(event);
            }}
          >
            {columns.map(({ stage, people }) => (
              <section
                key={stage.id}
                className={`an-kanban-col${draggingPerson ? " droppable" : ""}${
                  draggingStage === stage.id ? " dragging-stage" : ""
                }${draggingStage && draggingStage !== stage.id ? " stage-target" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  scrollBoardWhileDragging(event);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (readOnly && !shareToken) {
                    return;
                  }
                  if (draggingStage) {
                    moveStage(draggingStage, stage.id);
                    setDraggingStage("");
                    return;
                  }
                  const email = event.dataTransfer.getData("text/plain");
                  const person = board.people.find(
                    (item) => item.email.trim().toLowerCase() === email,
                  );
                  if (person) {
                    movePerson(person, stage.id);
                  }
                  setDraggingPerson("");
                }}
              >
                <header className="an-kanban-col-head">
                  <i
                    className="an-kanban-dot"
                    style={{ background: stageDotColor(stage) }}
                  />
                  {editingStageId === stage.id ? (
                    <input
                      ref={editStageInputRef}
                      className="an-kanban-rename"
                      value={editingStageName}
                      maxLength={40}
                      aria-label={`Rename ${stage.name}`}
                      onChange={(event) => setEditingStageName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitRenameStage();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRenameStage();
                        }
                      }}
                      onBlur={() => commitRenameStage()}
                    />
                  ) : (
                    <h3>{stageLabel(stage.name)}</h3>
                  )}
                  <em>{people.length}</em>
                  {readOnly ? null : (
                    <span className="an-kanban-head-actions">
                      <button
                        type="button"
                        className="an-kanban-add-lead-btn"
                        onClick={() =>
                          router.push(
                            portalContactsKanbanPickRoute(
                              board.id,
                              stage.id,
                              stage.name,
                            ),
                          )
                        }
                        aria-label={`Add lead to ${stage.name}`}
                        title="Add lead from contacts"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="an-kanban-rename-btn"
                        onClick={() => startRenameStage(stage)}
                        aria-label={`Rename ${stage.name}`}
                        title="Rename stage"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="an-kanban-grip-btn"
                        draggable
                        aria-label={`Move ${stage.name}`}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/stage", stage.id);
                          event.dataTransfer.effectAllowed = "move";
                          setDraggingStage(stage.id);
                        }}
                        onDragEnd={() => setDraggingStage("")}
                      >
                        <StageGrip />
                      </button>
                      {!stage.system ? (
                        <button
                          type="button"
                          className="an-kanban-remove"
                          onClick={() =>
                            setRemoveStagePrompt({
                              id: stage.id,
                              name: stage.name,
                            })
                          }
                          aria-label={`Remove ${stage.name}`}
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  )}
                </header>
                <div
                  className="an-kanban-cards"
                  onScroll={(event) =>
                    loadMoreOnScroll(stage.id, people.length, event.currentTarget)
                  }
                >
                  {people.slice(0, visibleLimit(stage.id, people)).map((person) => {
                    const email = person.email.trim().toLowerCase();
                    const name = displayName(person);
                    const query = leadQuery.trim().toLowerCase();
                    const matched =
                      query.length > 0 &&
                      (name.toLowerCase().includes(query) ||
                        email.includes(query) ||
                        person.companyName.toLowerCase().includes(query));
                    return (
                      <article
                        key={person.id}
                        className={`an-kanban-card${draggingPerson === email ? " dragging" : ""}${
                          matched ? " matched" : ""
                        }`}
                        draggable={!readOnly || Boolean(shareToken)}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", email);
                          event.dataTransfer.effectAllowed = "move";
                          setDraggingPerson(email);
                        }}
                        onDragEnd={() => setDraggingPerson("")}
                      >
                        {readOnly ? null : (
                          <button
                            type="button"
                            className="an-kanban-card-remove"
                            aria-label={`Remove ${name} from kanban`}
                            title="Remove"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setRemoveLeadPrompt({ email, name });
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onDragStart={(event) => event.preventDefault()}
                          >
                            ×
                          </button>
                        )}
                        <span className="an-kanban-card-copy">
                          <span className="an-kanban-card-row">
                            <span className="an-kanban-row-ico" aria-hidden>
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <circle cx="12" cy="8" r="4" />
                                <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
                              </svg>
                            </span>
                            {person.contactId ? (
                              <Link
                                className="an-kanban-card-name is-link"
                                href={portalContactRoute(
                                  person.contactId,
                                  portalKanbanRoute(board.id),
                                )}
                              >
                                {name}
                              </Link>
                            ) : (
                              <strong className="an-kanban-card-name">{name}</strong>
                            )}
                          </span>
                          {name.toLowerCase() !== email ? (
                            <span className="an-kanban-card-row">
                              <span className="an-kanban-row-ico" aria-hidden>
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.7"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
                                  <path d="m5 8 7 5 7-5" />
                                </svg>
                              </span>
                              <em className="an-kanban-card-email">{person.email}</em>
                            </span>
                          ) : null}
                          {person.companyName.trim() ? (
                            <span className="an-kanban-card-row an-kanban-card-company">
                              <span className="an-kanban-row-ico" aria-hidden>
                                <CompanyMark
                                  logoUrl={person.companyLogoUrl}
                                  domain={person.companyDomain}
                                />
                              </span>
                              <em>{person.companyName.trim()}</em>
                            </span>
                          ) : null}
                        </span>
                      </article>
                    );
                  })}
                  {people.length > visibleLimit(stage.id, people) ? (
                    <div className="an-kanban-more">
                      Showing {visibleLimit(stage.id, people)} of {people.length} · scroll for more
                    </div>
                  ) : null}
                </div>
              </section>
            ))}

            {readOnly ? null : adding ? (
              <form
                className="an-kanban-add"
                onSubmit={(event) => {
                  event.preventDefault();
                  addStage();
                }}
              >
                <input
                  value={stageName}
                  onChange={(event) => setStageName(event.target.value)}
                  placeholder="Stage name"
                  autoFocus
                  disabled={saving}
                />
                <div className="an-kanban-colors" role="radiogroup" aria-label="Stage color">
                  {KANBAN_DOT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={stageColor === color}
                      className={`an-kanban-color${stageColor === color ? " selected" : ""}`}
                      style={{ background: color }}
                      onClick={() => setStageColor(color)}
                      aria-label={`Use ${color}`}
                    />
                  ))}
                </div>
                <div className="an-kanban-add-actions">
                  <button
                    type="button"
                    className="btn-link-purple"
                    onClick={() => {
                      setAdding(false);
                      setStageName("");
                      setStageColor(DEFAULT_STAGE_COLOR);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-dark"
                    disabled={saving || !stageName.trim()}
                  >
                    Add
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="an-kanban-add-btn"
                onClick={() => setAdding(true)}
                aria-label="Add stage"
              >
                +
              </button>
            )}
          </div>
        </div>
      ) : null}

      {chatOpen ? (
        <div
          className="crm-modal-backdrop"
          onClick={() => setChatOpen(false)}
        >
          <div
            className="an-kanban-chat-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="an-kanban-chat-head">
              <span className="an-kanban-chat-mark" aria-hidden />
              <div>
                <h3>Board assistant</h3>
                <p>Move leads or add a stage.</p>
              </div>
              <button
                type="button"
                className="an-kanban-chat-x"
                aria-label="Close chat"
                onClick={() => setChatOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="an-kanban-chat-body">
              <div className="an-kanban-chat-thread">
                {chat.length === 0 ? (
                  <div className="an-kanban-chat-empty">
                    <p>Ask the board to move a lead or create a stage.</p>
                    <div className="an-kanban-chat-chips">
                      {[
                        "Create stage Meeting",
                        "Move everyone in Prospect to Engage",
                      ].map((hint) => (
                        <button
                          key={hint}
                          type="button"
                          className="an-kanban-chat-chip"
                          onClick={() => setChatDraft(hint)}
                        >
                          {hint}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  chat.map((turn, index) => (
                    <div
                      key={`${turn.role}-${index}`}
                      className={`an-kanban-chat-row ${turn.role}`}
                    >
                      {turn.role === "assistant" ? (
                        <span className="an-kanban-chat-mark sm" aria-hidden />
                      ) : null}
                      <div className={`an-kanban-chat-bubble ${turn.role}`}>
                        {turn.content}
                      </div>
                    </div>
                  ))
                )}
                {chatBusy ? (
                  <div className="an-kanban-chat-row assistant">
                    <span className="an-kanban-chat-mark sm" aria-hidden />
                    <div className="an-kanban-chat-bubble assistant thinking">
                      <i /><i /><i />
                    </div>
                  </div>
                ) : null}
              </div>
              {chatError ? <p className="an-kanban-chat-error">{chatError}</p> : null}
              <form
                className="an-kanban-chat-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendChat();
                }}
              >
                <textarea
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendChat();
                    }
                  }}
                  placeholder="Write a message… Enter to send"
                  disabled={chatBusy}
                  rows={2}
                />
                <button
                  type="submit"
                  className="an-kanban-chat-send"
                  disabled={chatBusy || !chatDraft.trim()}
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {removeLeadPrompt ? (
        <div
          className="crm-modal-backdrop"
          onClick={() => {
            if (!removingLead) {
              setRemoveLeadPrompt(null);
            }
          }}
        >
          <div
            className="crm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kanban-remove-lead-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="crm-modal-head">
              <h3 id="kanban-remove-lead-title">Remove from kanban?</h3>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                disabled={removingLead}
                onClick={() => setRemoveLeadPrompt(null)}
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body">
              <p>
                Remove <strong>{removeLeadPrompt.name}</strong> (
                {removeLeadPrompt.email}) from this kanban? They will no longer
                appear on the board.
              </p>
            </div>
            <div className="crm-modal-foot">
              <button
                type="button"
                className="btn-soft"
                disabled={removingLead}
                onClick={() => setRemoveLeadPrompt(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                disabled={removingLead}
                onClick={() => void confirmRemoveLead()}
              >
                {removingLead ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {removeStagePrompt ? (
        <div
          className="crm-modal-backdrop"
          onClick={() => setRemoveStagePrompt(null)}
        >
          <div
            className="crm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kanban-remove-stage-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="crm-modal-head">
              <h3 id="kanban-remove-stage-title">Delete stage?</h3>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                onClick={() => setRemoveStagePrompt(null)}
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body">
              <p>
                Delete the <strong>{removeStagePrompt.name}</strong> stage?
                Contacts in this stage will move back to their automatic stage.
              </p>
            </div>
            <div className="crm-modal-foot">
              <button
                type="button"
                className="btn-soft"
                onClick={() => setRemoveStagePrompt(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                onClick={() => confirmRemoveStage()}
              >
                Delete stage
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
