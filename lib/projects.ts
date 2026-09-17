export type Project = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string;
  users: number;
  /** When true, open bot-grace delay is skipped for this project. */
  instantOpen: boolean;
  /** When true, click bot-grace delay is skipped for this project. */
  instantClick: boolean;
  /** Max emails this project can send (maps to home sending usage). */
  sendingLimit: number;
};

export const DEFAULT_PROJECT_SENDING_LIMIT = 50_000;

export function normalizeSendingLimit(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_PROJECT_SENDING_LIMIT;
  }
  return Math.min(Math.floor(n), 10_000_000);
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
