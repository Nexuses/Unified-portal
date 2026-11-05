import fs from "fs";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].trim();
  }
}

const { runWeeklyReport } = await import("../lib/weekly-report-server.ts");
const result = await runWeeklyReport({ force: true });
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok && !result.skipped ? 0 : 1);
