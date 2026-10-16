import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ListDoc } from "@/lib/crm";
import { listProjectDripCampaigns } from "@/lib/drip-campaigns-server";
import { getAnalyticsDashboard } from "@/lib/analytics-server";
import { listProjectContacts, listProjectListContacts } from "@/lib/crm-contacts-server";
import { listProjectCompanies } from "@/lib/crm-companies-server";
import { getProjectSenders } from "@/lib/smtp-senders-server";
import { listProjectInboxThreads } from "@/lib/master-inbox-server";
import { getUnsubscribeListEntries } from "@/lib/unsubscribe-server";
import { getProjectKanbanBoard, listProjectKanbanBoards } from "@/lib/analytics-kanban-server";
import { portalKanbanRoute, stageIdForPerson } from "@/lib/analytics-kanban";
import { listProjectAutomations } from "@/lib/automations-server";
import { getKnowledgeDoc, listKnowledgeDocs } from "@/lib/knowledge-base-server";
import {
  listCampaignSendRecipients,
  type CampaignRecipientFilter,
  type CampaignSendRecipient,
} from "@/lib/campaign-blasts-server";
import { PORTAL_ROUTES, portalCampaignRoute } from "@/lib/portal-nav";
import type { Contact } from "@/lib/crm";
import type { AssistantCard, AssistantPeopleSearchCard } from "@/lib/assistant";
import { createPitchResearchJob, normalizeCompanyInputs } from "@/lib/pitch-research-server";
import { PITCH_RESEARCH_MAX_COMPANIES, type AssistantPitchResearchCard } from "@/lib/pitch-research";
import { searchWeb } from "@/lib/web-search-server";
import {
  AGENT_EMPLOYEE_RANGES,
  AGENT_LOOKUP_FIELDS,
  AGENT_MANAGEMENT_LEVELS,
  lookupFilterValuesForAgent,
  searchRecordsForAgent,
  type AgentSearchInput,
} from "@/lib/people/ai-search-records";

type DripCampaign = Awaited<ReturnType<typeof listProjectDripCampaigns>>[number];

export type AssistantToolContext = { projectId: ObjectId; projectName: string; userName: string };

export type AssistantToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** Read-only lookups the assistant can run against the signed-in project. */
export const ASSISTANT_TOOLS: AssistantToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_project_overview",
      description:
        "Counts for the whole project: contacts, lists, campaigns by type and status, senders, suppression list, inbox replies, kanban boards.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_campaigns",
      description:
        "Campaigns with lifetime stats (recipients, delivered, opens, clicks, replies, bounces, unsubscribes). Newest first.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["drip", "oneone", "personalise", "any"] },
          status: {
            type: "string",
            enum: ["draft", "scheduled", "sending", "paused", "sent", "any"],
          },
          query: { type: "string", description: "Part of the campaign name" },
          limit: { type: "number", description: "Max rows, default 15, max 50" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_campaign",
      description: "Full details of one campaign found by name (partial match) or id.",
      parameters: {
        type: "object",
        properties: { name_or_id: { type: "string" } },
        required: ["name_or_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_campaign_recipients",
      description:
        "People on one campaign: who was in the audience, delivered, opened, clicked, bounced, replied, or unsubscribed. Returns names, emails, company, and the time or link for that event. Use this whenever the user asks for the list of people behind a campaign stat.",
      parameters: {
        type: "object",
        properties: {
          name_or_id: {
            type: "string",
            description: "Campaign name, id, or link such as /portal/marketing/campaigns/60",
          },
          filter: {
            type: "string",
            enum: ["audience", "delivered", "opens", "clicks", "bounces", "replies", "unsubscribes"],
            description: "opens = opened the email. clicks = clicked a link. These are different people.",
          },
          limit: { type: "number", description: "Default 40, max 80" },
        },
        required: ["name_or_id", "filter"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_list_contacts",
      description: "People saved on a CRM contact list, found by list name or id.",
      parameters: {
        type: "object",
        properties: {
          name_or_id: { type: "string" },
          query: { type: "string", description: "Optional name, email or company filter inside the list" },
          limit: { type: "number", description: "Default 40, max 80" },
        },
        required: ["name_or_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_companies",
      description: "CRM companies in this project, with contact counts. Optional name search.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", description: "Default 20, max 40" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_knowledge",
      description: "Knowledge base documents for this project: title, file name, and a short preview.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Part of the document title" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_knowledge",
      description:
        "Read one knowledge base document by title or id. Use it when the user asks what a document says.",
      parameters: {
        type: "object",
        properties: { name_or_id: { type: "string" } },
        required: ["name_or_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_automations",
      description: "Automations in this project: name, status, and how each step waits and who it targets.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_suppression",
      description: "Suppression list: unsubscribed emails and blocked domains.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "Default 40, max 80" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_kanban",
      description:
        "Kanban boards that sort campaign contacts into stages. Without a name, lists the boards. With a name, returns stage counts and, when a stage is given, the people in that stage.",
      parameters: {
        type: "object",
        properties: {
          name_or_id: { type: "string" },
          stage: { type: "string", description: "Stage name, e.g. Engage or Cold" },
          limit: { type: "number", description: "People to return for the stage. Default 40, max 80" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_edm_templates",
      description: "Saved EDM email templates: name, subject, and where they can be used. Not the HTML.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_analytics",
      description:
        "Email results for a date range: totals, open/click/unsubscribe rates, split by Drip, 1-1 and Personalise, and per-campaign rows.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_contacts",
      description:
        "Find CRM contacts by name, email or company. Does not know who opened or clicked a campaign; use list_campaign_recipients for that.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", description: "Default 20, max 50" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_contact_lists",
      description: "Contact lists with their contact counts.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Part of the list name" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_senders",
      description: "Sending inboxes: email, provider, daily limit, SPF/DKIM/DMARC status.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_inbox_replies",
      description: "Recent replies to campaigns from the master inbox, newest first.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Default 10, max 30" },
          unread_only: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_people",
      description:
        "Search the Enrich people database (prospect data, not the project's CRM contacts) with structured filters. Returns the match count and a few sample people. The chat shows the result as a card with an Open in Enrich button that applies these filters. Use it whenever the user asks to find, get, pull or build a list of people/leads/contacts by role, company, industry, location, size or technology.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: 'Short description of the search, e.g. "CTOs at SaaS companies in Saudi Arabia"',
          },
          keywordSearch: { type: "string", description: "Free-text search across name, title, company and email. Rarely needed." },
          personName: { type: "string" },
          jobTitles: {
            type: "array",
            items: { type: "string" },
            description: 'Job titles as people write them, e.g. ["CTO", "Chief Technology Officer"]. Similar titles are matched automatically.',
          },
          excludeJobTitles: { type: "array", items: { type: "string" } },
          managementLevels: {
            type: "array",
            items: { type: "string", enum: [...AGENT_MANAGEMENT_LEVELS] },
          },
          departments: { type: "array", items: { type: "string" } },
          locations: {
            type: "array",
            items: { type: "string" },
            description: "Countries, regions or cities, e.g. Saudi Arabia, Dubai.",
          },
          excludeLocations: { type: "array", items: { type: "string" } },
          locationScope: {
            type: "string",
            enum: ["contact", "account_hq"],
            description: "contact = where the person is (default); account_hq = company headquarters.",
          },
          industries: {
            type: "array",
            items: { type: "string" },
            description: 'Industries, e.g. "Construction", "Banking", "SaaS".',
          },
          excludeIndustries: { type: "array", items: { type: "string" } },
          keywords: { type: "array", items: { type: "string" } },
          technologies: {
            type: "array",
            items: { type: "string" },
            description: "Only when the user asks for companies using a product, e.g. Salesforce, AWS.",
          },
          excludeTechnologies: { type: "array", items: { type: "string" } },
          companyNames: {
            type: "array",
            items: { type: "string" },
            description: "Only specific named companies (e.g. Aramco). Never generic words like 'construction companies'.",
          },
          excludeCompanyNames: { type: "boolean", description: "true to exclude companyNames instead of including them" },
          employeeRanges: {
            type: "array",
            items: { type: "string", enum: [...AGENT_EMPLOYEE_RANGES] },
          },
          minEmployees: { type: "number" },
          maxEmployees: { type: "number" },
          minRevenue: { type: "string", description: 'e.g. "10M"' },
          maxRevenue: { type: "string" },
          verifiedEmailsOnly: {
            type: "boolean",
            description: "Only when the user explicitly asks for verified emails.",
          },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the live public web. Use it for anything outside the portal's own data: a company's website, what a company does, recent news, a person's role, industry facts, competitors, events. Returns an answer with source links.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: 'A clear, specific question, e.g. "What is the official website of Smiforce?"',
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_pitch_research",
      description: `Start custom pitch research for companies the user named in the chat (up to ${PITCH_RESEARCH_MAX_COMPANIES}). Grok researches each company on the web, finds the right decision makers, writes a tailored pitch per person using the project's Knowledge Base, and checks people against the Data Portal. Runs in the background; the chat shows a live card with progress, pitches, validation and an Excel export.`,
      parameters: {
        type: "object",
        properties: {
          companies: {
            type: "array",
            items: { type: "string" },
            description: "Company names exactly as the user gave them.",
          },
          focus: {
            type: "string",
            description:
              "What to pitch and to whom, from the user's request, e.g. \"our cloud security offer to CISOs and CTOs\". Empty if not given.",
          },
        },
        required: ["companies"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_filter_values",
      description:
        "Look up the exact values that exist in the Enrich people database for a filter (job titles, industries, technologies, locations). Use it when unsure how a value is spelled or a search returned 0.",
      parameters: {
        type: "object",
        properties: {
          field: { type: "string", enum: [...AGENT_LOOKUP_FIELDS] },
          query: { type: "string" },
          limit: { type: "number", description: "Default 20, max 50" },
        },
        required: ["field", "query"],
        additionalProperties: false,
      },
    },
  },
];

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : undefined;
}

function optionalNumber(value: unknown) {
  const number = Number(value);
  return value === undefined || value === null || value === "" || !Number.isFinite(number)
    ? undefined
    : number;
}

function optionalString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

async function searchPeople(args: Record<string, unknown>) {
  const input: AgentSearchInput = {
    view: "people",
    summary: optionalString(args.summary) ?? "People search",
    keywordSearch: optionalString(args.keywordSearch),
    personName: optionalString(args.personName),
    jobTitles: stringList(args.jobTitles),
    excludeJobTitles: stringList(args.excludeJobTitles),
    managementLevels: stringList(args.managementLevels),
    departments: stringList(args.departments),
    locations: stringList(args.locations),
    excludeLocations: stringList(args.excludeLocations),
    locationScope: args.locationScope === "account_hq" ? "account_hq" : "contact",
    industries: stringList(args.industries),
    excludeIndustries: stringList(args.excludeIndustries),
    keywords: stringList(args.keywords),
    technologies: stringList(args.technologies),
    excludeTechnologies: stringList(args.excludeTechnologies),
    companyNames: stringList(args.companyNames),
    excludeCompanyNames: args.excludeCompanyNames === true,
    employeeRanges: stringList(args.employeeRanges),
    minEmployees: optionalNumber(args.minEmployees),
    maxEmployees: optionalNumber(args.maxEmployees),
    minRevenue: optionalString(args.minRevenue),
    maxRevenue: optionalString(args.maxRevenue),
    verifiedEmailsOnly: args.verifiedEmailsOnly === true,
  };
  const result = await searchRecordsForAgent(input);
  const card: AssistantPeopleSearchCard = {
    kind: "people-search",
    total: result.total,
    summary: result.summary,
    filters: result.filters,
  };
  return {
    card,
    output: {
      total: result.total,
      summary: result.summary,
      filters: result.chips,
      sample: result.sample,
      shownToUser:
        "A result card with these filters, the count, sample people and an Open in Enrich button is shown under your reply.",
    },
  };
}

async function startPitchResearch(context: AssistantToolContext, args: Record<string, unknown>) {
  const names = stringList(args.companies) ?? [];
  const { companies, skipped } = normalizeCompanyInputs(names.map((name) => ({ name })));
  if (companies.length === 0) {
    return { output: { error: "Give at least one company name." } };
  }
  const job = await createPitchResearchJob({
    projectId: context.projectId.toString(),
    projectName: context.projectName,
    createdBy: context.userName,
    companies,
    focus: optionalString(args.focus) ?? "",
    sourceName: "Chat",
  });
  const card: AssistantPitchResearchCard = {
    kind: "pitch-research",
    jobId: job.id,
    total: job.total,
    sourceName: "Chat",
  };
  return {
    card,
    output: {
      started: job.total,
      skipped,
      shownToUser:
        "A live card under your reply shows progress, research, people, pitches, Data Portal checks and an Excel export. Reply in one or two plain sentences: how many companies are being researched and that results fill in on the card.",
    },
  };
}

async function lookupFilterValues(args: Record<string, unknown>) {
  const field = AGENT_LOOKUP_FIELDS.find((item) => item === args.field);
  if (!field) {
    return { error: `field must be one of ${AGENT_LOOKUP_FIELDS.join(", ")}` };
  }
  const values = await lookupFilterValuesForAgent({
    view: "people",
    field,
    query: String(args.query ?? ""),
    limit: clampLimit(args.limit, 20, 50),
  });
  return { field, values };
}

function clampLimit(value: unknown, fallback: number, max: number) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback;
}

function rate(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "0%";
}

function campaignType(campaign: DripCampaign) {
  if (campaign.tags?.includes("personalise")) {
    return "Personalise";
  }
  return campaign.kind === "oneone" ? "1-1" : "Drip";
}

function campaignRow(campaign: DripCampaign) {
  const delivered = campaign.delivered ?? campaign.recipients;
  return {
    id: campaign.id,
    name: campaign.name,
    type: campaignType(campaign),
    status: campaign.status,
    sentAt: campaign.sentAt,
    scheduledAt: campaign.scheduledAt,
    recipients: campaign.recipients,
    delivered,
    opens: campaign.opens,
    clicks: campaign.clicks,
    replies: campaign.replies,
    bounces: campaign.bounces,
    unsubscribed: campaign.unsubscribed,
    openRate: rate(campaign.opens, delivered),
    clickRate: rate(campaign.clicks, delivered),
    link: portalCampaignRoute(campaign.id, campaign.kind, campaign.tags),
  };
}

async function allCampaigns(projectId: ObjectId) {
  const [drip, oneone] = await Promise.all([
    listProjectDripCampaigns(projectId, "drip"),
    listProjectDripCampaigns(projectId, "oneone"),
  ]);
  return [...drip, ...oneone].sort((a, b) =>
    (b.sentAt || b.scheduledAt || "").localeCompare(a.sentAt || a.scheduledAt || ""),
  );
}

async function projectOverview(projectId: ObjectId) {
  const db = await getDb();
  const [campaigns, contacts, lists, senders, suppression, threads, boards] = await Promise.all([
    allCampaigns(projectId),
    db.collection("contacts").countDocuments({ projectId }),
    db.collection("lists").countDocuments({ projectId }),
    getProjectSenders(projectId),
    getUnsubscribeListEntries(projectId, { page: 1, pageSize: 1 }),
    listProjectInboxThreads(projectId).catch(() => []),
    listProjectKanbanBoards(projectId),
  ]);
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const campaign of campaigns) {
    byStatus[campaign.status] = (byStatus[campaign.status] ?? 0) + 1;
    const type = campaignType(campaign);
    byType[type] = (byType[type] ?? 0) + 1;
  }
  return {
    contacts,
    lists,
    campaigns: { total: campaigns.length, byType, byStatus },
    senders: senders.length,
    suppression: { emails: suppression.emailTotal, domains: suppression.domainTotal },
    inboxReplies: {
      threads: threads.length,
      unread: threads.filter((thread) => thread.unreadCount > 0).length,
    },
    kanbanBoards: boards.length,
  };
}

async function listCampaigns(projectId: ObjectId, args: Record<string, unknown>) {
  const kind = String(args.kind ?? "any");
  const status = String(args.status ?? "any");
  const query = String(args.query ?? "").trim().toLowerCase();
  const limit = clampLimit(args.limit, 15, 50);
  const rows = (await allCampaigns(projectId)).filter((campaign) => {
    const type = campaignType(campaign);
    if (kind === "drip" && type !== "Drip") return false;
    if (kind === "oneone" && type !== "1-1") return false;
    if (kind === "personalise" && type !== "Personalise") return false;
    if (status !== "any" && campaign.status !== status) return false;
    return !query || campaign.name.toLowerCase().includes(query);
  });
  return { total: rows.length, campaigns: rows.slice(0, limit).map(campaignRow) };
}

async function getCampaign(projectId: ObjectId, args: Record<string, unknown>) {
  const needle = String(args.name_or_id ?? "").trim().toLowerCase();
  if (!needle) {
    return { error: "Give a campaign name or id" };
  }
  const campaigns = await allCampaigns(projectId);
  const matches = campaigns.filter(
    (campaign) =>
      campaign.id.toLowerCase() === needle || campaign.name.toLowerCase().includes(needle),
  );
  if (matches.length === 0) {
    return { error: `No campaign matches "${needle}"` };
  }
  const exact = matches.find((campaign) => campaign.name.toLowerCase() === needle);
  const campaign = exact ?? matches[0];
  return {
    ...campaignRow(campaign),
    subject: campaign.subject,
    previewText: campaign.previewText,
    sender: campaign.senderEmail
      ? `${campaign.senderName ?? ""} <${campaign.senderEmail}>`.trim()
      : undefined,
    list: campaign.listName,
    tags: campaign.tags,
    otherMatches: exact ? [] : matches.slice(1, 6).map((item) => item.name),
  };
}

async function getAnalytics(projectId: ObjectId, args: Record<string, unknown>) {
  const from = String(args.from ?? "");
  const to = String(args.to ?? "");
  const dashboard = await getAnalyticsDashboard(projectId, from, to);
  return {
    from: dashboard.from,
    to: dashboard.to,
    totals: dashboard.totals,
    rates: dashboard.rates,
    byKind: dashboard.byKind,
    campaigns: dashboard.campaigns.slice(0, 25).map((row) => ({
      name: row.name,
      type: row.personalise ? "Personalise" : row.kind === "oneone" ? "1-1" : "Drip",
      sentAt: row.sentAt,
      delivered: row.delivered,
      opens: row.opens,
      clicks: row.clicks,
      unsubscribed: row.unsubscribed,
    })),
    link: PORTAL_ROUTES.analytics,
  };
}

function contactSummary(contact: Contact) {
  const attributes = contact.attributes ?? {};
  const title =
    attributes.Title || attributes.title || attributes.JobTitle || attributes["Job Title"] || "";
  const phone = attributes.Phone || attributes.phone || attributes.Mobile || "";
  return {
    name: contact.fullName,
    email: contact.email,
    company: contact.companyName || undefined,
    title: title || undefined,
    phone: phone || undefined,
    subscribed: contact.subscribed,
    link: `${PORTAL_ROUTES.contacts}/${contact.id}`,
  };
}

function campaignNeedle(value: string) {
  const fromLink = value.match(/campaigns\/([^/?#\s]+)/i)?.[1];
  return (fromLink ?? value).trim();
}

async function searchContacts(projectId: ObjectId, args: Record<string, unknown>) {
  const result = await listProjectContacts(projectId, {
    q: String(args.query ?? ""),
    pageSize: clampLimit(args.limit, 20, 50),
  });
  return {
    total: result.total,
    contacts: result.items.map(contactSummary),
  };
}

const RECIPIENT_FILTERS: CampaignRecipientFilter[] = [
  "audience",
  "delivered",
  "opens",
  "clicks",
  "bounces",
  "replies",
  "unsubscribes",
];

function recipientRow(person: CampaignSendRecipient, filter: CampaignRecipientFilter) {
  return {
    name: person.fullName,
    email: person.email,
    company: person.companyName || undefined,
    sentAt: person.sentAt,
    openedAt: filter === "opens" || filter === "clicks" ? person.openedAt : undefined,
    clickedAt: filter === "clicks" ? person.clickedAt : undefined,
    clickedUrl: filter === "clicks" ? person.clickedUrl || undefined : undefined,
    repliedAt: filter === "replies" ? person.repliedAt : undefined,
    unsubscribedAt: filter === "unsubscribes" ? person.unsubscribedAt : undefined,
    error: filter === "bounces" ? person.error || undefined : undefined,
    link: person.contactId ? `${PORTAL_ROUTES.contacts}/${person.contactId}` : undefined,
  };
}

async function listCampaignRecipients(projectId: ObjectId, args: Record<string, unknown>) {
  const filter = RECIPIENT_FILTERS.find((item) => item === args.filter);
  if (!filter) {
    return { error: `filter must be one of ${RECIPIENT_FILTERS.join(", ")}` };
  }
  const needle = campaignNeedle(String(args.name_or_id ?? "")).toLowerCase();
  if (!needle) {
    return { error: "Give a campaign name or id" };
  }
  const campaigns = await allCampaigns(projectId);
  const matches = campaigns.filter(
    (campaign) =>
      campaign.id.toLowerCase() === needle || campaign.name.toLowerCase().includes(needle),
  );
  if (matches.length === 0) {
    return { error: `No campaign matches "${needle}"` };
  }
  const exact = matches.find((campaign) => campaign.name.toLowerCase() === needle || campaign.id.toLowerCase() === needle);
  const campaign = exact ?? matches[0];
  const kind = campaign.kind === "oneone" ? "oneone" : "drip";
  const people = await listCampaignSendRecipients(projectId, campaign.id, filter, kind, {
    uniqueContacts: true,
  });
  const limit = clampLimit(args.limit, 40, 80);
  return {
    campaign: campaign.name,
    id: campaign.id,
    filter,
    total: people.length,
    truncated: people.length > limit,
    people: people.slice(0, limit).map((person) => recipientRow(person, filter)),
    otherMatches: exact ? [] : matches.slice(1, 6).map((item) => item.name),
    link: portalCampaignRoute(campaign.id, campaign.kind, campaign.tags),
  };
}

async function findList(projectId: ObjectId, needle: string) {
  const db = await getDb();
  const text = needle.trim();
  const displayId = Number(text.replace(/^#/, ""));
  if (ObjectId.isValid(text) && text.length === 24) {
    const byId = await db.collection<ListDoc>("lists").findOne({ projectId, _id: new ObjectId(text) });
    if (byId) return byId;
  }
  if (Number.isInteger(displayId) && displayId > 0) {
    const byDisplay = await db.collection<ListDoc>("lists").findOne({ projectId, displayId });
    if (byDisplay) return byDisplay;
  }
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = await db
    .collection<ListDoc>("lists")
    .find({ projectId, name: { $regex: escaped, $options: "i" } })
    .sort({ createdAt: -1 })
    .limit(6)
    .toArray();
  const exact = named.find((list) => list.name.toLowerCase() === text.toLowerCase());
  return { chosen: exact ?? named[0], others: named.filter((list) => list !== (exact ?? named[0])) };
}

async function listListContacts(projectId: ObjectId, args: Record<string, unknown>) {
  const needle = String(args.name_or_id ?? "").trim();
  if (!needle) {
    return { error: "Give a list name or id" };
  }
  const found = await findList(projectId, needle);
  const list = found && "name" in found ? found : found?.chosen;
  if (!list) {
    return { error: `No list matches "${needle}"` };
  }
  const others = found && "others" in found ? found.others : [];
  const limit = clampLimit(args.limit, 40, 80);
  const result = await listProjectListContacts(projectId, list._id, {
    q: optionalString(args.query),
    pageSize: limit,
  });
  return {
    list: list.name,
    id: list.displayId,
    total: result.total,
    truncated: result.total > result.items.length,
    contacts: result.items.map(contactSummary),
    otherMatches: others.map((item) => item.name),
    link: `${PORTAL_ROUTES.lists}/${list._id.toString()}`,
  };
}

async function searchCompanies(projectId: ObjectId, userName: string, args: Record<string, unknown>) {
  const limit = clampLimit(args.limit, 20, 40);
  const result = await listProjectCompanies(projectId, userName, {
    q: optionalString(args.query) ?? "",
    pageSize: limit,
  });
  return {
    total: result.total,
    truncated: result.total > result.items.length,
    companies: result.items.map((company) => ({
      name: company.name,
      domain: company.domain || undefined,
      contacts: company.contactCount,
      people: company.contacts.slice(0, 8).map((contact) => ({
        name: contact.fullName,
        email: contact.email,
      })),
      link: `${PORTAL_ROUTES.companies}/${company.id}`,
    })),
    link: PORTAL_ROUTES.companies,
  };
}

async function listKnowledge(projectId: ObjectId, args: Record<string, unknown>) {
  const query = String(args.query ?? "").trim().toLowerCase();
  const docs = await listKnowledgeDocs(projectId.toString());
  const rows = query
    ? docs.filter((doc) => doc.title.toLowerCase().includes(query) || doc.fileName.toLowerCase().includes(query))
    : docs;
  return {
    total: rows.length,
    documents: rows.slice(0, 30).map((doc) => ({
      id: doc.id,
      title: doc.title,
      fileName: doc.fileName,
      preview: doc.preview.slice(0, 280),
      createdAt: doc.createdAt,
    })),
  };
}

async function readKnowledge(projectId: ObjectId, args: Record<string, unknown>) {
  const needle = String(args.name_or_id ?? "").trim();
  if (!needle) {
    return { error: "Give a document title or id" };
  }
  const docs = await listKnowledgeDocs(projectId.toString());
  const exact = docs.find(
    (doc) => doc.id === needle || doc.title.toLowerCase() === needle.toLowerCase(),
  );
  const partial = docs.filter(
    (doc) =>
      doc.title.toLowerCase().includes(needle.toLowerCase()) ||
      doc.fileName.toLowerCase().includes(needle.toLowerCase()),
  );
  const chosen = exact ?? partial[0];
  if (!chosen) {
    return { error: `No knowledge document matches "${needle}"` };
  }
  const doc = await getKnowledgeDoc(projectId.toString(), chosen.id);
  if (!doc) {
    return { error: "That document could not be read" };
  }
  const text = doc.markdown.slice(0, 8000);
  return {
    title: doc.title,
    fileName: doc.fileName,
    truncated: doc.markdown.length > text.length || doc.truncated,
    text,
    otherMatches: exact ? [] : partial.slice(1, 5).map((item) => item.title),
  };
}

async function listAutomations(projectId: ObjectId) {
  const automations = await listProjectAutomations(projectId, { nonEmptyOnly: true });
  return {
    total: automations.length,
    automations: automations.slice(0, 30).map((automation) => ({
      name: automation.name,
      kind: automation.kind,
      status: automation.status,
      steps: automation.steps.map((step, index) => ({
        step: index + 1,
        waitDays: step.waitDays,
        waitHours: step.waitHours,
        who: step.engagement,
        pastCampaign: step.pastCampaignName,
      })),
      updatedAt: automation.updatedAt,
    })),
    link: PORTAL_ROUTES.automation,
  };
}

async function listSuppression(projectId: ObjectId, args: Record<string, unknown>) {
  const limit = clampLimit(args.limit, 40, 80);
  const page = await getUnsubscribeListEntries(projectId, { page: 1, pageSize: limit });
  return {
    emails: page.emailTotal,
    domains: page.domainTotal,
    truncated: page.emailTotal + page.domainTotal > page.entries.length + page.domains.length,
    unsubscribed: page.entries.map((entry) => ({
      name: entry.fullName,
      email: entry.email,
      addedAt: entry.addedAt,
    })),
    blockedDomains: page.domains.map((entry) => ({
      domain: entry.domain,
      addedAt: entry.addedAt,
    })),
    link: PORTAL_ROUTES.unsub,
  };
}

async function getKanban(projectId: ObjectId, args: Record<string, unknown>) {
  const boards = await listProjectKanbanBoards(projectId);
  const needle = optionalString(args.name_or_id)?.toLowerCase();
  if (!needle) {
    return {
      boards: boards.map((board) => ({
        id: board.id,
        name: board.name,
        campaigns: board.campaigns.map((campaign) => campaign.name),
        link: portalKanbanRoute(board.id),
      })),
    };
  }
  const matches = boards.filter(
    (board) => board.id.toLowerCase() === needle || board.name.toLowerCase().includes(needle),
  );
  const exact = matches.find((board) => board.name.toLowerCase() === needle || board.id === needle);
  const board = exact ?? matches[0];
  if (!board) {
    return { error: `No kanban board matches "${needle}"` };
  }
  const full = await getProjectKanbanBoard(projectId, board.id);
  if (!full) {
    return { error: "That board could not be loaded" };
  }
  const grouped = new Map<string, typeof full.people>();
  for (const person of full.people) {
    const stageId = stageIdForPerson(person, full.placements, full.stages);
    if (!stageId) continue;
    const bucket = grouped.get(stageId) ?? [];
    bucket.push(person);
    grouped.set(stageId, bucket);
  }
  const stages = full.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    count: grouped.get(stage.id)?.length ?? 0,
  }));
  const stageNeedle = optionalString(args.stage)?.toLowerCase();
  const stage = stageNeedle
    ? full.stages.find(
        (item) => item.id.toLowerCase() === stageNeedle || item.name.toLowerCase().includes(stageNeedle),
      )
    : undefined;
  const limit = clampLimit(args.limit, 40, 80);
  const people = stage ? (grouped.get(stage.id) ?? []) : [];
  return {
    name: full.name,
    link: portalKanbanRoute(full.id),
    stages,
    ...(stage
      ? {
          stage: stage.name,
          total: people.length,
          truncated: people.length > limit,
          people: people.slice(0, limit).map((person) => ({
            name: person.fullName,
            email: person.email,
            company: person.companyName || undefined,
            opened: person.opened,
            clicked: person.clicked,
            replied: person.replied === true,
          })),
        }
      : {}),
    otherMatches: exact ? [] : matches.slice(1, 5).map((item) => item.name),
  };
}

async function listEdmTemplates(projectId: ObjectId, args: Record<string, unknown>) {
  const query = String(args.query ?? "").trim().toLowerCase();
  const db = await getDb();
  const docs = await db
    .collection<{ name: string; subject: string; destinations?: string[]; updatedAt: Date }>(
      "edm_templates",
    )
    .find({ projectId: projectId.toString() }, { projection: { html: 0 } })
    .sort({ updatedAt: -1 })
    .limit(40)
    .toArray();
  const rows = query
    ? docs.filter(
        (doc) => doc.name.toLowerCase().includes(query) || doc.subject.toLowerCase().includes(query),
      )
    : docs;
  return {
    total: rows.length,
    templates: rows.map((doc) => ({
      name: doc.name,
      subject: doc.subject,
      usedFor: doc.destinations ?? [],
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : undefined,
    })),
    link: PORTAL_ROUTES.edm,
  };
}

async function listContactLists(projectId: ObjectId, args: Record<string, unknown>) {
  const query = String(args.query ?? "").trim();
  const db = await getDb();
  const filter: Record<string, unknown> = { projectId };
  if (query) {
    filter.name = { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  }
  const lists = await db
    .collection<ListDoc>("lists")
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(40)
    .toArray();
  return {
    lists: lists.map((list) => ({
      id: list.displayId,
      name: list.name,
      contacts: list.contactCount,
      createdAt: list.createdAt.toISOString(),
      link: `${PORTAL_ROUTES.lists}/${list._id.toString()}`,
    })),
  };
}

async function listSenders(projectId: ObjectId) {
  const senders = await getProjectSenders(projectId);
  return {
    senders: senders.map((sender) => ({
      email: sender.fromEmail,
      provider: sender.providerName,
      dailyLimit: sender.dailyLimit,
      spf: sender.verification?.spfOk,
      dkim: sender.verification?.dkimOk,
      dmarc: sender.verification?.dmarcOk,
      trackingDomain: sender.trackingDomain,
    })),
    link: PORTAL_ROUTES.smtp,
  };
}

async function listInboxReplies(projectId: ObjectId, args: Record<string, unknown>) {
  const threads = await listProjectInboxThreads(projectId);
  const rows = args.unread_only ? threads.filter((thread) => thread.unreadCount > 0) : threads;
  return {
    total: rows.length,
    replies: rows.slice(0, clampLimit(args.limit, 10, 30)).map((thread) => ({
      from: thread.fromName ? `${thread.fromName} <${thread.fromEmail}>` : thread.fromEmail,
      subject: thread.subject,
      preview: thread.preview.slice(0, 160),
      campaign: thread.campaignName,
      inbox: thread.senderEmail,
      unread: thread.unreadCount > 0,
      at: thread.latestAt,
    })),
    link: PORTAL_ROUTES.inbox,
  };
}

async function runLookup(
  context: AssistantToolContext,
  name: string,
  args: Record<string, unknown>,
) {
  const projectId = context.projectId;
  switch (name) {
    case "get_project_overview":
      return projectOverview(projectId);
    case "list_campaigns":
      return listCampaigns(projectId, args);
    case "get_campaign":
      return getCampaign(projectId, args);
    case "list_campaign_recipients":
      return listCampaignRecipients(projectId, args);
    case "get_analytics":
      return getAnalytics(projectId, args);
    case "search_contacts":
      return searchContacts(projectId, args);
    case "list_contact_lists":
      return listContactLists(projectId, args);
    case "list_list_contacts":
      return listListContacts(projectId, args);
    case "search_companies":
      return searchCompanies(projectId, context.userName, args);
    case "list_knowledge":
      return listKnowledge(projectId, args);
    case "read_knowledge":
      return readKnowledge(projectId, args);
    case "list_automations":
      return listAutomations(projectId);
    case "list_suppression":
      return listSuppression(projectId, args);
    case "get_kanban":
      return getKanban(projectId, args);
    case "list_edm_templates":
      return listEdmTemplates(projectId, args);
    case "list_senders":
      return listSenders(projectId);
    case "list_inbox_replies":
      return listInboxReplies(projectId, args);
    case "lookup_filter_values":
      return lookupFilterValues(args);
    case "web_search": {
      const query = optionalString(args.query);
      return query ? searchWeb(query) : { error: "Give a search query" };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

/** Runs a tool; `card` is set when the result should also render in the chat. */
export async function runAssistantTool(
  context: AssistantToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<{ output: unknown; card?: AssistantCard }> {
  if (name === "search_people") {
    return searchPeople(args);
  }
  if (name === "start_pitch_research") {
    return startPitchResearch(context, args);
  }
  return { output: await runLookup(context, name, args) };
}
