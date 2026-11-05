export const PROJECT_ASSISTANT_PROVIDERS = [
  "hubspot",
  "attio",
  "brevo",
  "lemlist",
  "other",
] as const;

export type ProjectAssistantProvider =
  (typeof PROJECT_ASSISTANT_PROVIDERS)[number];

export type ProjectAssistantAuthType =
  | "bearer"
  | "api-key"
  | "query"
  | "authorization";

export type ProjectAssistantIntegrationPublic = {
  id: string;
  provider: ProjectAssistantProvider;
  name: string;
  baseUrl: string;
  authType: ProjectAssistantAuthType;
  keyHint: string;
  connectedAt: string;
};

export type ProjectAssistantMessagePublic = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  conversationId?: string;
};

export type ProjectAssistantConversationPublic = {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
};

export const PROJECT_ASSISTANT_CATALOG: Array<{
  provider: Exclude<ProjectAssistantProvider, "other">;
  title: string;
  blurb: string;
  defaultBaseUrl: string;
  authType: ProjectAssistantAuthType;
  placeholder: string;
}> = [
  {
    provider: "hubspot",
    title: "HubSpot",
    blurb: "CRM contacts, companies, deals — transfer and sync with a private app token.",
    defaultBaseUrl: "https://api.hubapi.com",
    authType: "bearer",
    placeholder: "pat-na1-…",
  },
  {
    provider: "attio",
    title: "Attio",
    blurb: "Lists, people, companies, and pipeline stages.",
    defaultBaseUrl: "https://api.attio.com",
    authType: "bearer",
    placeholder: "Attio access token",
  },
  {
    provider: "brevo",
    title: "Brevo",
    blurb: "Campaigns, contacts, and engagement via API key.",
    defaultBaseUrl: "https://api.brevo.com",
    authType: "api-key",
    placeholder: "xkeysib-…",
  },
  {
    provider: "lemlist",
    title: "Lemlist",
    blurb: "Outreach campaigns, leads, and activity.",
    defaultBaseUrl: "https://api.lemlist.com",
    authType: "api-key",
    placeholder: "Lemlist API key",
  },
];
