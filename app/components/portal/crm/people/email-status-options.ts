export type EmailStatusCategoryId = "safe" | "caution" | "do_not_send";

export type EmailStatusIconId = "deliverables" | "risky_deliverables" | "not_found";

export type EmailStatusOption = {
  id: string;
  label: string;
  category: EmailStatusCategoryId;
  /** Case-insensitive, anchored regex source matched against `email_status` (shared by Mongo and the UI). */
  matchPattern: string;
  badgeClass: string;
  icon: EmailStatusIconId;
};

export const EMAIL_STATUS_CATEGORIES: Array<{ id: EmailStatusCategoryId; label: string }> = [
  { id: "safe", label: "Safe to send" },
  { id: "caution", label: "Send with caution" },
  { id: "do_not_send", label: "Do not send" },
];

export const EMAIL_STATUS_OPTIONS: EmailStatusOption[] = [
  {
    id: "deliverables",
    label: "deliverables",
    category: "safe",
    matchPattern: "^\\s*deliverables?\\s*$",
    badgeClass: "bg-emerald-100 text-emerald-800",
    icon: "deliverables",
  },
  {
    id: "risky_deliverables",
    label: "Risky deliverables",
    category: "caution",
    // Imported sheets carry misspellings ("risky delivereble", "risky deliverable", ...).
    matchPattern: "^\\s*risky(\\s+deliv\\w*)?\\s*$",
    badgeClass: "bg-amber-100 text-amber-900",
    icon: "risky_deliverables",
  },
  {
    id: "not_found",
    label: "not found",
    category: "do_not_send",
    matchPattern: "^\\s*not[\\s_-]?found\\s*$",
    badgeClass: "bg-red-100 text-red-800",
    icon: "not_found",
  },
];

const OPTION_REGEX = new Map(
  EMAIL_STATUS_OPTIONS.map((option) => [option.id, new RegExp(option.matchPattern, "i")])
);

export function getEmailStatusOptionById(id: string) {
  return EMAIL_STATUS_OPTIONS.find((option) => option.id === id);
}

export function getEmailStatusOptionByDbValue(value: string) {
  return EMAIL_STATUS_OPTIONS.find((option) => OPTION_REGEX.get(option.id)?.test(value));
}

/** Resolve selected option ids (or raw DB values from AI filters) to regex sources. */
export function getEmailStatusMatchPatterns(selected: string[]): string[] {
  const patterns = new Set<string>();

  for (const entry of selected) {
    const option = getEmailStatusOptionById(entry) ?? getEmailStatusOptionByDbValue(entry);
    if (option) {
      patterns.add(option.matchPattern);
    } else if (entry.trim()) {
      patterns.add(`^\\s*${entry.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
    }
  }

  return [...patterns];
}

export function getEmailStatusCount(
  option: EmailStatusOption,
  counts: Record<string, number>
): number {
  const regex = OPTION_REGEX.get(option.id);
  if (!regex) return 0;
  return Object.entries(counts).reduce(
    (total, [key, count]) => (regex.test(key) ? total + count : total),
    0
  );
}
