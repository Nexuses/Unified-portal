/**
 * Smoke tests for old-pipeline import helpers.
 * Run: npx tsx scripts/test-kanban-pipeline-import.mjs
 */
import assert from "node:assert/strict";
import {
  buildCreateStageRows,
  campaignKeysFromPipeline,
  customStageRowsFromPipeline,
  engagementStageRows,
  mergeImportedStages,
} from "../lib/analytics-kanban-pipeline-import.ts";

const board = {
  id: "b1",
  name: "Old board",
  campaigns: [
    { campaignId: "c1", kind: "drip", name: "Launch" },
    { campaignId: "c2", kind: "oneone", name: "Follow-up" },
  ],
  stages: [
    { id: "s1", name: "Prospect", color: "#3b82f6", rule: "delivered" },
    { id: "s2", name: "Engage", color: "#f97316", rule: "opened" },
    { id: "s3", name: "Hot", color: "#8b5cf6", rule: "clicked" },
  ],
  createdAt: "",
  updatedAt: "",
};

{
  const rows = engagementStageRows();
  assert.deepEqual(
    rows.map((row) => row.rule),
    ["delivered", "opened", "clicked", "replied"],
  );
  assert.deepEqual(
    rows.map((row) => row.name),
    ["Sent", "Open", "Click", "Reply"],
  );
}

{
  const rows = customStageRowsFromPipeline(board, "full", []);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.custom && !row.rule));
  assert.equal(rows[2].name, "Hot");
  assert.deepEqual(campaignKeysFromPipeline(board), ["drip:c1", "oneone:c2"]);
}

{
  const rows = customStageRowsFromPipeline(board, "stages", ["s2"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Engage");
  assert.equal(rows[0].custom, true);
}

{
  // Campaigns only → synced stages
  const rows = buildCreateStageRows({
    hasCampaigns: true,
    pipeline: null,
    pipelineScope: "full",
    pipelineStageIds: [],
  });
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.rule && !row.custom));
}

{
  // Old pipeline only → custom stages
  const rows = buildCreateStageRows({
    hasCampaigns: false,
    pipeline: board,
    pipelineScope: "stages",
    pipelineStageIds: ["s3"],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Hot");
  assert.equal(rows[0].custom, true);
  assert.equal(rows[0].rule, undefined);
}

{
  // CRM list only → default custom stage
  const rows = buildCreateStageRows({
    hasCampaigns: false,
    hasList: true,
    pipeline: null,
    pipelineScope: "full",
    pipelineStageIds: [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].custom, true);
  assert.equal(rows[0].name, "Stage 1");
}

{
  // Both → Sent/Open/Click/Reply + custom from pipeline
  const rows = buildCreateStageRows({
    hasCampaigns: true,
    pipeline: board,
    pipelineScope: "stages",
    pipelineStageIds: ["s3"],
  });
  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.slice(0, 4).map((row) => row.name),
    ["Sent", "Open", "Click", "Reply"],
  );
  assert.equal(rows[4].name, "Hot");
  assert.equal(rows[4].custom, true);
}

{
  const current = [
    { id: "cur-1", name: "Sent", color: "#3b82f6", rule: "delivered" },
  ];
  const merged = mergeImportedStages(current, board.stages);
  assert.equal(merged.length, 4);
  assert.equal(merged[0].rule, "delivered");
  assert.ok(!merged[1].rule);
  assert.equal(merged[1].name, "Prospect");
  assert.equal(merged[3].name, "Hot");
}

console.log("kanban pipeline import: all checks passed");
