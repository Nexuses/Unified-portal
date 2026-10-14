// Usage: node --env-file=.env.local scripts/repair-click-bursts.mjs [--apply]
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createJiti } from "jiti";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const { repairClickBursts } = await jiti.import(path.join(root, "lib/campaign-blasts-server.ts"));

const apply = process.argv.includes("--apply");
const result = await repairClickBursts({ dryRun: !apply });

console.log(`${apply ? "Applied" : "Dry run"}: scanned ${result.scanned} sends with 2+ clicks, ${result.flaggedSends} scanner bursts`);
for (const campaign of result.campaigns.sort((a, b) => b.flaggedSends - a.flaggedSends)) {
  const after = campaign.clicksAfter === undefined ? "" : ` -> ${campaign.clicksAfter}`;
  console.log(`#${campaign.campaignId} ${campaign.name}: ${campaign.flaggedSends} bursts, clicks ${campaign.clicksBefore}${after}`);
}
process.exit(0);
