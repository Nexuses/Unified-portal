// Usage: node --env-file=.env.local scripts/restore-instant-click-bursts.mjs [--apply]
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createJiti } from "jiti";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const { getDb } = await jiti.import(path.join(root, "lib/mongodb.ts"));
const { restoreClickBurstsForProject } = await jiti.import(
  path.join(root, "lib/campaign-blasts-server.ts"),
);

const apply = process.argv.includes("--apply");
const db = await getDb();
const projects = await db
  .collection("projects")
  .find({
    $or: [{ instantClick: true }, { instantClick: { $exists: false }, instantOpenClick: true }],
  })
  .project({ name: 1 })
  .toArray();

for (const project of projects) {
  if (apply) {
    const result = await restoreClickBurstsForProject(project._id);
    console.log(`${project.name}: restored ${result.restoredSends} sends across ${result.campaigns} campaigns`);
  } else {
    const flagged = await db.collection("campaign_sends").countDocuments({
      projectId: project._id,
      $or: [{ clickBurstIgnored: true }, { "clickEvents.ignored": true }],
    });
    console.log(`${project.name}: ${flagged} sends with ignored clicks (dry run, pass --apply to restore)`);
  }
}
process.exit(0);
