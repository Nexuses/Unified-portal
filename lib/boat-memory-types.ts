import type { CloudSenderProvider } from "@/lib/cloud-campaigns";

export const BOAT_MEMORY_INSTRUCTIONS_MAX = 4000;

export type BoatMemoryDefaults = {
  preferredProvider?: CloudSenderProvider;
  defaultProfileId?: string;
  notes?: string;
};

export type ProjectBoatMemory = {
  projectId: string;
  instructions: string;
  defaults: BoatMemoryDefaults;
  updatedAt: string;
  updatedBy?: string;
};
