import { ObjectId, type WithId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { CloudSenderProvider } from "@/lib/cloud-campaigns";
import {
  BOAT_MEMORY_INSTRUCTIONS_MAX,
  type BoatMemoryDefaults,
  type ProjectBoatMemory,
} from "@/lib/boat-memory-types";

export {
  BOAT_MEMORY_INSTRUCTIONS_MAX,
  type BoatMemoryDefaults,
  type ProjectBoatMemory,
} from "@/lib/boat-memory-types";

type ProjectBoatMemoryDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  instructions: string;
  defaults: BoatMemoryDefaults;
  updatedAt: Date;
  updatedBy?: string;
  createdAt: Date;
};

let indexed = false;

async function memoryCollection() {
  const db = await getDb();
  const collection = db.collection<ProjectBoatMemoryDoc>("project_boat_memory");
  if (!indexed) {
    await collection.createIndex({ projectId: 1 }, { unique: true });
    indexed = true;
  }
  return collection;
}

function iso(value?: Date | null) {
  return value ? value.toISOString() : new Date().toISOString();
}

function mapMemory(doc: WithId<ProjectBoatMemoryDoc>): ProjectBoatMemory {
  const defaults = doc.defaults && typeof doc.defaults === "object" ? doc.defaults : {};
  return {
    projectId: doc.projectId.toHexString(),
    instructions: typeof doc.instructions === "string" ? doc.instructions : "",
    defaults: {
      preferredProvider:
        defaults.preferredProvider === "outlook"
          ? "outlook"
          : defaults.preferredProvider === "gmail"
            ? "gmail"
            : undefined,
      defaultProfileId:
        typeof defaults.defaultProfileId === "string" && defaults.defaultProfileId.trim()
          ? defaults.defaultProfileId.trim()
          : undefined,
      notes:
        typeof defaults.notes === "string" && defaults.notes.trim()
          ? defaults.notes.trim().slice(0, 500)
          : undefined,
    },
    updatedAt: iso(doc.updatedAt),
    updatedBy: doc.updatedBy,
  };
}

export async function getProjectBoatMemory(projectId: ObjectId): Promise<ProjectBoatMemory> {
  const collection = await memoryCollection();
  const doc = await collection.findOne({ projectId });
  if (!doc) {
    return {
      projectId: projectId.toHexString(),
      instructions: "",
      defaults: {},
      updatedAt: new Date(0).toISOString(),
    };
  }
  return mapMemory(doc);
}

export async function patchProjectBoatMemory(
  projectId: ObjectId,
  patch: {
    instructions?: string;
    defaults?: BoatMemoryDefaults;
    updatedBy?: string;
  },
): Promise<ProjectBoatMemory> {
  const collection = await memoryCollection();
  const $set: Record<string, unknown> = {
    updatedAt: new Date(),
  };
  if (typeof patch.instructions === "string") {
    $set.instructions = patch.instructions.trim().slice(0, BOAT_MEMORY_INSTRUCTIONS_MAX);
  }
  if (patch.defaults) {
    const next: BoatMemoryDefaults = {};
    if (patch.defaults.preferredProvider === "outlook" || patch.defaults.preferredProvider === "gmail") {
      next.preferredProvider = patch.defaults.preferredProvider;
    }
    if (typeof patch.defaults.defaultProfileId === "string") {
      const id = patch.defaults.defaultProfileId.trim();
      if (id) next.defaultProfileId = id;
    }
    if (typeof patch.defaults.notes === "string") {
      const notes = patch.defaults.notes.trim().slice(0, 500);
      if (notes) next.notes = notes;
    }
    $set.defaults = next;
  }
  if (typeof patch.updatedBy === "string" && patch.updatedBy.trim()) {
    $set.updatedBy = patch.updatedBy.trim();
  }

  const result = await collection.findOneAndUpdate(
    { projectId },
    {
      $set,
      $setOnInsert: { projectId, createdAt: new Date(), instructions: "", defaults: {} },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!result) {
    return getProjectBoatMemory(projectId);
  }
  return mapMemory(result);
}

/** Merge preferred sender into memory only when those defaults are still empty. */
export async function learnBoatMemoryFromSender(
  projectId: ObjectId,
  input: {
    provider: CloudSenderProvider;
    profileId: string;
    email?: string;
    updatedBy?: string;
  },
) {
  const current = await getProjectBoatMemory(projectId);
  const hasProvider = Boolean(current.defaults.preferredProvider);
  const hasProfile = Boolean(current.defaults.defaultProfileId);
  if (hasProvider && hasProfile) return current;

  const defaults: BoatMemoryDefaults = { ...current.defaults };
  if (!hasProvider) defaults.preferredProvider = input.provider;
  if (!hasProfile) defaults.defaultProfileId = input.profileId;
  if (!current.instructions.trim() && input.email?.includes("@")) {
    const product = input.provider === "outlook" ? "Outlook" : "Gmail";
    return patchProjectBoatMemory(projectId, {
      instructions: `Send email via ${product} as ${input.email}.`,
      defaults,
      updatedBy: input.updatedBy,
    });
  }
  return patchProjectBoatMemory(projectId, {
    defaults,
    updatedBy: input.updatedBy,
  });
}

/** Block prepended to Boat desktop tasks so the agent remembers project prefs. */
export function formatBoatMemoryBlock(memory: ProjectBoatMemory) {
  const lines: string[] = [];
  const instructions = memory.instructions.trim();
  if (instructions) {
    lines.push("PROJECT_MEMORY (durable prefs for this project — follow unless the task overrides):");
    lines.push("-----PROJECT_MEMORY_START-----");
    lines.push(instructions.slice(0, BOAT_MEMORY_INSTRUCTIONS_MAX));
    lines.push("-----PROJECT_MEMORY_END-----");
  }
  if (memory.defaults.preferredProvider) {
    const product = memory.defaults.preferredProvider === "outlook" ? "Outlook" : "Gmail";
    lines.push(`Preferred mail client: ${product}.`);
  }
  if (memory.defaults.defaultProfileId) {
    lines.push(`Preferred Chrome sender profile id: ${memory.defaults.defaultProfileId}.`);
  }
  if (memory.defaults.notes?.trim()) {
    lines.push(`Notes: ${memory.defaults.notes.trim()}`);
  }
  if (!lines.length) return "";
  return `${lines.join("\n")}\n`;
}
