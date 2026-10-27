import {
  kanbanPeopleForBotFilter,
  stageIdForPerson,
  type KanbanBoard,
  type KanbanPerson,
} from "@/lib/analytics-kanban";
import { formatEngagementDevice } from "@/lib/engagement-client-meta";
import { OPEN_PIXEL_BLOCKED_TAG } from "@/lib/open-pixel";

function safeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

export function kanbanCsvFilename(boardName: string) {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = safeFilenamePart(boardName) || "pipeline";
  return `${base}-pipeline-${stamp}.csv`;
}

function personName(person: KanbanPerson) {
  const name = person.fullName.trim();
  if (name && name.toLowerCase() !== person.email.trim().toLowerCase()) {
    return name;
  }
  return person.email;
}

function yesNo(value: boolean | undefined) {
  return value ? "Yes" : "No";
}

function formatWhen(iso?: string) {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function csvEscape(value: string | number | boolean | undefined | null) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const COLUMNS = [
  "Name",
  "Email",
  "Company",
  "Domain",
  "Stage",
  "Stage rule",
  "Campaigns",
  "Email sent at",
  "Opened at",
  "Open device",
  "Open tag",
  "Clicked at",
  "Click device",
  "Replied at",
  "Delivered",
  "Opened",
  "Clicked",
  "Replied",
  "Last activity",
  "CRM contact ID",
] as const;

export function buildKanbanBoardCsv(
  board: KanbanBoard,
  options?: { hideBotClicks?: boolean },
): string {
  const people = kanbanPeopleForBotFilter(
    board.people,
    Boolean(options?.hideBotClicks),
  );
  const rows = [...people]
    .map((person) => {
      const stageId = stageIdForPerson(person, board.placements, board.stages);
      const stage = board.stages.find((item) => item.id === stageId);
      return {
        person,
        stageName: stage?.name?.trim() || "Unassigned",
        stageRule: stage?.rule
          ? stage.rule.charAt(0).toUpperCase() + stage.rule.slice(1)
          : stage
            ? "Manual"
            : "",
        sortKey: `${stageNameSort(stage?.name)}|${personName(person).toLowerCase()}`,
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const lines = [COLUMNS.map(csvEscape).join(",")];
  for (const row of rows) {
    const { person, stageName, stageRule } = row;
    lines.push(
      [
        personName(person),
        person.email || "",
        person.companyName?.trim() || "",
        person.companyDomain || "",
        stageName,
        stageRule,
        (person.campaigns || []).join("; "),
        formatWhen(person.sentAt),
        formatWhen(person.openedAt),
        formatEngagementDevice(person.openedDevice) || "",
        person.openPixelBlocked ? OPEN_PIXEL_BLOCKED_TAG : "",
        formatWhen(person.clickedAt),
        formatEngagementDevice(person.clickedDevice) || "",
        formatWhen(person.repliedAt),
        yesNo(person.delivered),
        yesNo(person.opened),
        yesNo(person.clicked),
        yesNo(person.replied),
        formatWhen(person.lastActivityAt),
        person.contactId || "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  // Excel-friendly UTF-8 BOM
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function stageNameSort(name?: string) {
  return (name || "zzz-unassigned").trim().toLowerCase();
}
