import {
  DEFAULT_STAGE_COLOR,
  KANBAN_DOT_COLORS,
  KANBAN_STAGE_RULES,
  type KanbanList,
  type KanbanStage,
  type KanbanStageRule,
} from "@/lib/analytics-kanban";

export type PipelineScope = "full" | "stages";

export type StageSetupRow = {
  key: string;
  name: string;
  color?: string;
  /** Engagement sync trigger. Omitted for custom (old-pipeline) stages. */
  rule?: KanbanStageRule;
  custom?: boolean;
  /** Free-text label in “Moves in when” for custom stages (user-editable). */
  customLabel?: string;
};

/** Standard create stages: Sent / Open / Click / Reply. */
export function engagementStageRows(): StageSetupRow[] {
  return KANBAN_STAGE_RULES.map((item, index) => ({
    key: `s-${item.value}`,
    name: item.label,
    rule: item.value,
    color: KANBAN_DOT_COLORS[index % KANBAN_DOT_COLORS.length],
    custom: false,
  }));
}

function selectedPipelineStages(
  board: Pick<KanbanList, "stages">,
  scope: PipelineScope,
  stageIds: string[],
) {
  return scope === "full"
    ? board.stages
    : board.stages.filter((stage) => stageIds.includes(stage.id));
}

/**
 * Old-pipeline stages as Custom columns — no Sent/Open/Click/Reply sync
 * (those rules cannot be remapped from another board reliably).
 */
export function customStageRowsFromPipeline(
  board: Pick<KanbanList, "stages">,
  scope: PipelineScope,
  stageIds: string[],
): StageSetupRow[] {
  return selectedPipelineStages(board, scope, stageIds).map((stage, index) => ({
    key: `custom-${stage.id}`,
    name: stage.name.trim() || `Custom ${index + 1}`,
    color: stage.color || DEFAULT_STAGE_COLOR,
    custom: true,
    customLabel: "Custom",
  }));
}

/**
 * Build step-2 rows from create sources:
 * - campaigns only → Sent/Open/Click/Reply
 * - old pipeline only → custom stages
 * - both → engagement + custom from pipeline
 */
export function buildCreateStageRows(input: {
  hasCampaigns: boolean;
  pipeline: Pick<KanbanList, "stages"> | null;
  pipelineScope: PipelineScope;
  pipelineStageIds: string[];
}): StageSetupRow[] {
  const engagement = input.hasCampaigns ? engagementStageRows() : [];
  const custom =
    input.pipeline != null
      ? customStageRowsFromPipeline(
          input.pipeline,
          input.pipelineScope,
          input.pipelineStageIds,
        )
      : [];
  if (engagement.length > 0 && custom.length > 0) {
    return [...engagement, ...custom];
  }
  if (custom.length > 0) {
    return custom;
  }
  return engagement.length > 0 ? engagement : engagementStageRows();
}

/** Merge old-pipeline stages onto a board as custom columns (no rule sync). */
export function mergeImportedStages(
  current: KanbanStage[],
  incoming: KanbanStage[],
): KanbanStage[] {
  const usedNames = new Set(current.map((stage) => stage.name.trim().toLowerCase()));
  const next = [...current];
  for (const stage of incoming) {
    const name = stage.name.trim().slice(0, 40);
    if (!name || usedNames.has(name.toLowerCase())) {
      continue;
    }
    usedNames.add(name.toLowerCase());
    next.push({
      id: `custom-${next.length}-${Date.now().toString(36)}`,
      name,
      color: stage.color || DEFAULT_STAGE_COLOR,
    });
  }
  return next;
}

export function campaignKeysFromPipeline(board: Pick<KanbanList, "campaigns">) {
  return board.campaigns.map((campaign) => `${campaign.kind}:${campaign.campaignId}`);
}
