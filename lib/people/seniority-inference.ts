/**
 * Infer management/seniority level from a job title when seniority is missing.
 * Used for filtering (title OR seniority) — never overwrites original title.
 */

export type InferredSeniority =
  | "Owner"
  | "Founder"
  | "C suite"
  | "Partner"
  | "President"
  | "Executive Vice President"
  | "Senior Vice President"
  | "Vp"
  | "Head"
  | "Director"
  | "Manager"
  | "Senior"
  | "Lead"
  | "Entry"
  | "Intern";

/** Patterns applied to title/seniority text (case-insensitive). Order = specificity first. */
export const SENIORITY_TITLE_PATTERNS: Record<string, string> = {
  Intern: "\\bintern\\b|\\binternship\\b|\\btrainee\\b",
  Owner: "\\bowner\\b|\\bproprietor\\b",
  Founder: "\\bfounder\\b|\\bco[\\s-]?founder\\b",
  Partner: "\\bpartner\\b(?!\\s+manager)",
  "C suite":
    "c[\\s_-]?(?:suite|level)|\\bchief\\s+\\w+\\s+officer\\b|\\bceo\\b|\\bcfo\\b|\\bcoo\\b|\\bcto\\b|\\bcio\\b|\\bciso\\b|\\bcro\\b|\\bcmo\\b|\\bcpo\\b|\\bchro\\b|\\bcdo\\b|\\bcxo\\b|\\bclo\\b|\\bcso\\b|\\bcno\\b|\\bcco\\b|\\bcao\\b",
  "Executive Vice President":
    "\\bev\\s*p\\b|\\bexecutive\\s+vice[\\s_-]?president\\b|\\bexecutive\\s+vp\\b",
  "Senior Vice President":
    "\\bsv\\s*p\\b|\\bsenior\\s+vice[\\s_-]?president\\b|\\bsenior\\s+vp\\b",
  President: "\\bpresident\\b(?!\\s+vice)",
  Vp: "\\bvp\\b|\\bv\\.?p\\.?\\b|\\bvice[\\s_-]?president\\b|\\bavp\\b|\\bassistant\\s+vice[\\s_-]?president\\b",
  Head: "\\bhead\\s+of\\b|\\bhead\\b",
  Director: "\\bdirector\\b|\\bdir\\.?\\b",
  Manager: "\\bmanager\\b|\\bmgr\\.?\\b",
  Senior: "\\bsenior\\b|\\bsr\\.?\\b",
  Lead: "\\blead\\b|\\bprincipal\\b|\\bstaff\\b",
  Entry: "\\bjunior\\b|\\bjr\\.?\\b|\\bassociate\\b|\\bentry[\\s_-]?level\\b|\\bcoordinator\\b|\\bassistant\\b|\\bexecutive\\b",
};

/** Map UI management-level labels to pattern keys. */
export const MANAGEMENT_LEVEL_TO_PATTERN_KEY: Record<string, string> = {
  Owner: "Owner",
  Founder: "Founder",
  "C suite": "C suite",
  Partner: "Partner",
  President: "President",
  "Executive Vice President": "Executive Vice President",
  "Senior Vice President": "Senior Vice President",
  Vp: "Vp",
  Head: "Head",
  Director: "Director",
  Manager: "Manager",
  Senior: "Senior",
  Lead: "Lead",
  Entry: "Entry",
  Intern: "Intern",
};

export function seniorityPatternForLevel(level: string): string {
  const key = MANAGEMENT_LEVEL_TO_PATTERN_KEY[level] ?? level;
  return SENIORITY_TITLE_PATTERNS[key] ?? level.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Infer the most specific seniority from a title string.
 * Returns null if no confident match.
 */
export function inferSeniorityFromTitle(title: string): InferredSeniority | null {
  const text = title.trim();
  if (!text) return null;

  const ordered: InferredSeniority[] = [
    "Intern",
    "Owner",
    "Founder",
    "Partner",
    "C suite",
    "Executive Vice President",
    "Senior Vice President",
    "President",
    "Vp",
    "Head",
    "Director",
    "Manager",
    "Senior",
    "Lead",
    "Entry",
  ];

  for (const level of ordered) {
    const pattern = SENIORITY_TITLE_PATTERNS[level];
    if (pattern && new RegExp(pattern, "i").test(text)) {
      return level;
    }
  }
  return null;
}
