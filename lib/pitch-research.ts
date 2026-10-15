export const PITCH_RESEARCH_MAX_COMPANIES = 25;
export const PITCH_RESEARCH_PEOPLE_PER_COMPANY = 5;

/** Line the assistant ends a reply with when the user should upload a company list. */
export const PITCH_RESEARCH_MARKER = "[[pitch-research-upload]]";

export const PITCH_RESEARCH_ACCEPT = ".csv,.xlsx,.txt";

export type PitchSource = { title: string; url: string };

export type PitchValidation = {
  /** Person found in the Data Portal at this company. */
  inDataPortal: boolean;
  /** Researched title agrees with the Data Portal title (null when not comparable). */
  titleMatches: boolean | null;
  /** Data Portal marks the email as verified/valid. */
  emailVerified: boolean;
  notes: string[];
};

export type PitchPerson = {
  name: string;
  title: string;
  email: string;
  emailStatus: string;
  linkedin: string;
  location: string;
  /** Where the person came from before research. */
  source: "data-portal" | "web";
  insights: string[];
  pitch: { subject: string; body: string; hook: string };
  validation: PitchValidation;
};

export type PitchCompanyResearch = {
  summary: string;
  website: string;
  industry: string;
  size: string;
  location: string;
  priorities: string[];
  news: Array<{ title: string; date: string; url: string }>;
  /** Data Portal facts used to check the research. */
  portal: { matchedName: string; domain: string; industry: string; employees: string; country: string; people: number };
  companyMatchesPortal: boolean;
};

export type PitchCompanyResult = {
  name: string;
  status: "pending" | "researching" | "done" | "failed";
  error?: string;
  research?: PitchCompanyResearch;
  people: PitchPerson[];
  sources: PitchSource[];
};

export type PitchResearchJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  focus: string;
  sourceName: string;
  total: number;
  completed: number;
  companies: PitchCompanyResult[];
  createdAt: string;
  updatedAt: string;
  error?: string;
};

export type AssistantPitchResearchCard = {
  kind: "pitch-research";
  jobId: string;
  total: number;
  sourceName: string;
};
