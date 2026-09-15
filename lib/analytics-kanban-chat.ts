import {
  autoStageId,
  DEFAULT_STAGE_COLOR,
  KANBAN_DOT_COLORS,
  stageIdForPerson,
  type KanbanBoard,
  type KanbanPerson,
  type KanbanStage,
} from "@/lib/analytics-kanban";

export type KanbanChatAction =
  | { type: "create_stage"; name: string; color?: string }
  | { type: "move"; who: string; to: string; from?: string };

const DOT_SET = new Set<string>(KANBAN_DOT_COLORS);

function normalizeColor(value: unknown) {
  const color = String(value ?? "").trim().toLowerCase();
  return DOT_SET.has(color) ? color : DEFAULT_STAGE_COLOR;
}

function findStage(stages: KanbanStage[], name: string) {
  const query = name.trim().toLowerCase();
  if (!query) {
    return undefined;
  }
  return (
    stages.find((stage) => stage.id === query) ||
    stages.find((stage) => stage.name.toLowerCase() === query) ||
    stages.find((stage) => stage.name.toLowerCase().includes(query))
  );
}

function findPeople(
  board: KanbanBoard,
  who: string,
  fromName?: string,
): KanbanPerson[] {
  const query = who.trim().toLowerCase();
  if (!query) {
    return [];
  }
  if (fromName) {
    const from = findStage(board.stages, fromName);
    if (!from) {
      return [];
    }
    return board.people.filter(
      (person) =>
        stageIdForPerson(person, board.placements, board.stages) === from.id,
    );
  }
  const everyone = query.match(/^(everyone|all)(?:\s+(?:in|from)\s+(.+))?$/);
  if (everyone) {
    if (everyone[2]) {
      return findPeople(board, "everyone", everyone[2]);
    }
    return board.people;
  }
  return board.people.filter((person) => {
    const email = person.email.trim().toLowerCase();
    const name = person.fullName.trim().toLowerCase();
    return email.includes(query) || name.includes(query);
  });
}

export function applyKanbanChatActions(
  board: KanbanBoard,
  actions: KanbanChatAction[],
): { board: KanbanBoard; notes: string[] } {
  let stages = [...board.stages];
  let placements = { ...board.placements };
  const notes: string[] = [];

  for (const action of actions) {
    if (action.type === "create_stage") {
      const name = action.name.trim();
      if (!name) {
        notes.push("Skipped an empty stage name.");
        continue;
      }
      if (stages.some((stage) => stage.name.toLowerCase() === name.toLowerCase())) {
        notes.push(`Stage "${name}" already exists.`);
        continue;
      }
      stages = [
        ...stages,
        {
          id: `stage-${Math.random().toString(36).slice(2, 10)}`,
          name,
          color: normalizeColor(action.color),
        },
      ];
      notes.push(`Created stage "${name}".`);
      continue;
    }
    if (action.type === "move") {
      const to = findStage(stages, action.to);
      if (!to) {
        notes.push(`Could not find stage "${action.to}".`);
        continue;
      }
      const people = findPeople(
        { ...board, stages, placements },
        action.who,
        action.from,
      );
      if (people.length === 0) {
        notes.push(`Could not find ${action.who} to move.`);
        continue;
      }
      for (const person of people) {
        const email = person.email.trim().toLowerCase();
        if (autoStageId(person) === to.id) {
          delete placements[email];
        } else {
          placements[email] = to.id;
        }
      }
      notes.push(
        `Moved ${people.length} ${people.length === 1 ? "person" : "people"} to ${to.name}.`,
      );
    }
  }

  return {
    board: { ...board, stages, placements },
    notes,
  };
}

export function parseKanbanChatFallback(message: string): {
  reply: string;
  actions: KanbanChatAction[];
} {
  const text = message.trim();
  const create = text.match(
    /(?:create|add|make)\s+(?:a\s+|new\s+)?stage(?:\s+(?:called|named))?\s+["']?([^"'\n.]+)["']?/i,
  );
  if (create?.[1]) {
    const name = create[1].trim();
    return {
      reply: `I'll add a stage called ${name}.`,
      actions: [{ type: "create_stage", name }],
    };
  }
  const moveFrom = text.match(
    /move\s+(everyone|all)\s+(?:in|from)\s+(.+?)\s+to\s+(.+)/i,
  );
  if (moveFrom) {
    return {
      reply: `I'll move everyone from ${moveFrom[2]} to ${moveFrom[3]}.`,
      actions: [
        { type: "move", who: "everyone", from: moveFrom[2].trim(), to: moveFrom[3].trim() },
      ],
    };
  }
  const move = text.match(/move\s+(.+?)\s+(?:to|into)\s+(.+)/i);
  if (move) {
    return {
      reply: `I'll move ${move[1]} to ${move[2]}.`,
      actions: [{ type: "move", who: move[1].trim(), to: move[2].trim() }],
    };
  }
  return {
    reply:
      "I can move people between stages or create a stage. Try “Move Jane to Engage” or “Create stage Meeting”.",
    actions: [],
  };
}

export function parseKanbanChatJson(content: string): {
  reply: string;
  actions: KanbanChatAction[];
} | null {
  const raw = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const data = JSON.parse(raw) as {
      reply?: unknown;
      actions?: unknown;
    };
    const actions: KanbanChatAction[] = [];
    if (Array.isArray(data.actions)) {
      for (const item of data.actions) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const row = item as Record<string, unknown>;
        if (row.type === "create_stage" && typeof row.name === "string") {
          actions.push({
            type: "create_stage",
            name: row.name,
            color: typeof row.color === "string" ? row.color : undefined,
          });
        }
        if (
          row.type === "move" &&
          typeof row.who === "string" &&
          typeof row.to === "string"
        ) {
          actions.push({
            type: "move",
            who: row.who,
            to: row.to,
            from: typeof row.from === "string" ? row.from : undefined,
          });
        }
      }
    }
    return {
      reply:
        typeof data.reply === "string" && data.reply.trim()
          ? data.reply.trim()
          : "Done.",
      actions,
    };
  } catch {
    return null;
  }
}
