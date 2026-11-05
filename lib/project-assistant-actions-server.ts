import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ListDoc } from "@/lib/crm";
import { createList } from "@/lib/crm-import";
import {
  createEmptySequence,
  isOneOneCampaign,
  mergeBlastReport,
  sequencesReady,
  type CampaignKind,
  type CampaignSequence,
  type DripCampaign,
} from "@/lib/drip-campaigns";
import {
  createProjectDripCampaign,
  getProjectDripCampaign,
  listProjectDripCampaigns,
  updateProjectDripCampaign,
} from "@/lib/drip-campaigns-server";
import { launchCampaignBlast } from "@/lib/campaign-blasts-server";
import { PORTAL_ROUTES, portalCampaignRoute } from "@/lib/portal-nav";
import {
  createProjectSender,
  getProjectSender,
  getProjectSenders,
} from "@/lib/smtp-senders-server";
import {
  parseSenderInput,
  SMTP_PROVIDERS,
  type SmtpProviderId,
} from "@/lib/smtp-senders";
import {
  normalizePresentFormArgs,
  type AgentForm,
} from "@/lib/project-assistant-form";

export type ProjectActionContext = {
  projectId: ObjectId;
  userId: ObjectId | null;
};

function asKind(value: unknown): CampaignKind {
  return value === "oneone" ? "oneone" : "drip";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Accepts HTML or plain text; plain text becomes simple email paragraphs. */
export function toEmailHtml(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return trimmed;
  return trimmed
    .split(/\n{2,}/)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

function campaignSummary(campaign: DripCampaign) {
  return {
    id: campaign.id,
    name: campaign.name,
    kind: campaign.kind === "oneone" ? "1-1" : "Drip",
    status: campaign.status,
    subject: campaign.subject,
    senderEmail: campaign.senderEmail,
    listName: campaign.listName,
    hasDesign: Boolean(campaign.hasDesign && campaign.designHtml?.trim()),
    windowStart: campaign.windowStart,
    windowEnd: campaign.windowEnd,
    link: portalCampaignRoute(campaign.id, campaign.kind, campaign.tags),
  };
}

async function findCampaign(
  projectId: ObjectId,
  nameOrId: string,
  kindHint?: CampaignKind,
): Promise<DripCampaign | null> {
  const needle = nameOrId.trim().toLowerCase();
  if (!needle) return null;

  if (kindHint) {
    const exact = await getProjectDripCampaign(projectId, nameOrId.trim(), kindHint);
    if (exact) return exact;
  } else {
    const byId =
      (await getProjectDripCampaign(projectId, nameOrId.trim(), "drip")) ||
      (await getProjectDripCampaign(projectId, nameOrId.trim(), "oneone"));
    if (byId) return byId;
  }

  const all = await listProjectDripCampaigns(projectId);
  const matches = all.filter(
    (campaign) =>
      campaign.id.toLowerCase() === needle ||
      campaign.name.toLowerCase() === needle ||
      campaign.name.toLowerCase().includes(needle),
  );
  if (matches.length === 0) return null;
  const hit =
    matches.find((c) => c.id.toLowerCase() === needle) ||
    matches.find((c) => c.name.toLowerCase() === needle) ||
    matches[0];
  const kind = hit.kind === "oneone" ? "oneone" : "drip";
  return (await getProjectDripCampaign(projectId, hit.id, kind)) ?? null;
}

async function resolveList(projectId: ObjectId, nameOrId: string) {
  const needle = nameOrId.trim();
  if (!needle) return null;
  const db = await getDb();

  if (ObjectId.isValid(needle)) {
    const byId = await db.collection<ListDoc>("lists").findOne({
      projectId,
      _id: new ObjectId(needle),
    });
    if (byId) return byId;
  }

  const asDisplay = Number(needle);
  if (Number.isFinite(asDisplay) && String(asDisplay) === needle) {
    const byDisplay = await db.collection<ListDoc>("lists").findOne({
      projectId,
      displayId: asDisplay,
    });
    if (byDisplay) return byDisplay;
  }

  const lists = await db
    .collection<ListDoc>("lists")
    .find({
      projectId,
      name: { $regex: needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" },
    })
    .limit(10)
    .toArray();
  if (lists.length === 0) return null;
  const exact = lists.find(
    (list: ListDoc) => list.name.toLowerCase() === needle.toLowerCase(),
  );
  return exact ?? lists[0];
}

async function resolveSender(projectId: ObjectId, emailOrId: string) {
  const needle = emailOrId.trim().toLowerCase();
  if (!needle) return null;
  if (ObjectId.isValid(emailOrId.trim())) {
    const byId = await getProjectSender(projectId, new ObjectId(emailOrId.trim()));
    if (byId) return byId;
  }
  const senders = await getProjectSenders(projectId);
  return (
    senders.find((s) => s.id.toLowerCase() === needle) ||
    senders.find((s) => s.fromEmail.toLowerCase() === needle) ||
    senders.find((s) => s.fromEmail.toLowerCase().includes(needle)) ||
    null
  );
}

function setupChecklist(campaign: DripCampaign) {
  const oneOne = isOneOneCampaign(campaign);
  const missing: string[] = [];
  const ready: string[] = [];

  if (campaign.senderId && campaign.senderEmail) {
    ready.push(`Sender: ${campaign.senderEmail}`);
  } else {
    missing.push("sender (from email / sender id)");
  }

  if (campaign.listId || (campaign.individualContacts?.length ?? 0) > 0) {
    ready.push(
      campaign.listName
        ? `Audience list: ${campaign.listName}`
        : "Audience: individual contacts",
    );
  } else {
    missing.push("audience list (or individual contacts)");
  }

  if (oneOne) {
    const sequences = campaign.sequences?.length
      ? campaign.sequences
      : [createEmptySequence(0)];
    const first = sequences[0];
    if (first?.subject?.trim()) {
      ready.push(`Sequence 1 subject: ${first.subject.trim()}`);
    } else {
      missing.push("subject on the first sequence");
    }
    sequences.forEach((seq, index) => {
      if (seq.hasDesign && seq.designHtml?.trim()) {
        ready.push(`Sequence ${index + 1} design saved`);
      } else {
        missing.push(`email design for sequence ${index + 1}`);
      }
    });
    if (campaign.windowStart?.trim() && campaign.windowEnd?.trim()) {
      ready.push(`Send window: ${campaign.windowStart}–${campaign.windowEnd}`);
    } else {
      missing.push("send window (windowStart / windowEnd, e.g. 09:00–18:00)");
    }
  } else {
    if (campaign.subject?.trim()) {
      ready.push(`Subject: ${campaign.subject.trim()}`);
    } else {
      missing.push("subject line");
    }
    if (campaign.hasDesign && campaign.designHtml?.trim()) {
      ready.push("Email design saved");
    } else {
      missing.push("email body / design HTML");
    }
  }

  const canLaunch = missing.length === 0 && (oneOne ? sequencesReady(campaign) : true);
  return {
    campaign: campaignSummary(campaign),
    ready,
    missing,
    canLaunch,
    tip: canLaunch
      ? "Ready to launch. Call launch_campaign with mode=now or mode=later + scheduledFor."
      : "Ask the user for each missing item, then call update_campaign_setup. Do not invent credentials or copy.",
  };
}

function appOrigin() {
  return (
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000"
  );
}

export const PROJECT_ACTION_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "create_campaign",
      description:
        "Create a new draft campaign in this project (Drip or 1-1). After creating, gather subject, body, sender, and list, then call update_campaign_setup.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Campaign name" },
          kind: {
            type: "string",
            enum: ["drip", "oneone"],
            description: "drip = one blast email; oneone = sequenced 1-1 outreach",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_campaign_setup_checklist",
      description:
        "Show what is still needed before a campaign can launch (sender, list, subject, design, window). Call this when helping set up or before launch.",
      parameters: {
        type: "object",
        properties: {
          name_or_id: { type: "string", description: "Campaign name or id" },
          kind: { type: "string", enum: ["drip", "oneone"] },
        },
        required: ["name_or_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_campaign_setup",
      description:
        "Update campaign setup fields: subject, email body/HTML, sender, list, timezone, send window, reply-to, sequences (1-1). Resolves sender and list by email/name/id.",
      parameters: {
        type: "object",
        properties: {
          name_or_id: { type: "string" },
          kind: { type: "string", enum: ["drip", "oneone"] },
          subject: { type: "string" },
          preview_text: { type: "string" },
          body_html_or_text: {
            type: "string",
            description: "Email HTML or plain text (plain text is wrapped as HTML)",
          },
          sender_email_or_id: {
            type: "string",
            description: "Existing sender from email or id",
          },
          sender_display_name: {
            type: "string",
            description: "From name shown to recipients",
          },
          list_name_or_id: {
            type: "string",
            description: "Contact list name, display id, or Mongo id",
          },
          timezone: { type: "string", description: "e.g. Asia/Kolkata" },
          window_start: { type: "string", description: "HH:mm, e.g. 09:00" },
          window_end: { type: "string", description: "HH:mm, e.g. 18:00" },
          reply_to_email: { type: "string" },
          email_gap_minutes: { type: "number" },
          sequence_index: {
            type: "number",
            description: "1-1 only: which sequence to update (0-based). Default 0.",
          },
          sequence_delay_days: {
            type: "number",
            description: "1-1 only: delay days for this sequence (0 for first)",
          },
          add_sequence: {
            type: "boolean",
            description: "1-1 only: append a new empty follow-up sequence",
          },
        },
        required: ["name_or_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "launch_campaign",
      description:
        "Launch a campaign now or schedule it. Use get_campaign_setup_checklist first. Confirm with the user before launching.",
      parameters: {
        type: "object",
        properties: {
          name_or_id: { type: "string" },
          kind: { type: "string", enum: ["drip", "oneone"] },
          mode: { type: "string", enum: ["now", "later"] },
          scheduled_for: {
            type: "string",
            description: "ISO datetime when mode=later",
          },
        },
        required: ["name_or_id", "mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_sender_providers",
      description:
        "List SMTP/API providers and the credential fields needed to add a sender. Prefer request_sender_form to collect credentials in chat.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "present_input_form",
      description:
        "Show an inline form in the chat so the user can fill required fields (credentials, campaign subject/body, schedule time, etc.). Always use this instead of asking them to type secrets or long values in free text. Keep your reply short; the form appears under it.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          submit_label: { type: "string" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                label: { type: "string" },
                type: {
                  type: "string",
                  enum: [
                    "text",
                    "email",
                    "password",
                    "number",
                    "textarea",
                    "select",
                    "checkbox",
                  ],
                },
                placeholder: { type: "string" },
                required: { type: "boolean" },
                help: { type: "string" },
                defaultValue: {},
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      value: { type: "string" },
                      label: { type: "string" },
                    },
                    required: ["value", "label"],
                  },
                },
              },
              required: ["key", "label", "type"],
            },
          },
          hidden: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Values included on submit but not shown as inputs",
          },
        },
        required: ["title", "fields"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "request_sender_form",
      description:
        "Show the correct inline credential form for adding a sender for a given provider and from email. Use this whenever the user wants to add a sender and credentials are missing.",
      parameters: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            enum: ["aws_ses", "gmail", "outlook", "sendgrid", "cloudflare", "resend"],
          },
          from_email: { type: "string" },
        },
        required: ["provider", "from_email"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_sender",
      description:
        "Add a sending inbox/SMTP sender after the user submitted credentials via request_sender_form / present_input_form. Never invent API keys or passwords.",
      parameters: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            enum: ["aws_ses", "gmail", "outlook", "sendgrid", "cloudflare", "resend"],
          },
          from_email: { type: "string" },
          smtp_host: { type: "string" },
          smtp_user: { type: "string" },
          smtp_password: { type: "string" },
          smtp_port: { type: "number" },
          api_key: { type: "string" },
          cloudflare_account_id: { type: "string" },
          cloudflare_email_api_token: { type: "string" },
          no_inbox: {
            type: "boolean",
            description: "Skip SPF/DKIM/DMARC when outbound-only",
          },
          daily_limit: {
            type: "number",
            description: "Gmail only: max sends per UTC day",
          },
        },
        required: ["provider", "from_email"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_contact_list",
      description:
        "Create an empty contact list. Contacts still need to be imported in CRM or via connected tools; this only creates the list shell so a campaign can reference it.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
];

async function createCampaignAction(
  ctx: ProjectActionContext,
  args: Record<string, unknown>,
) {
  const name = String(args.name || "").trim();
  if (!name) return { error: "Campaign name is required" };
  const kind = asKind(args.kind);
  const campaign = await createProjectDripCampaign(
    ctx.projectId,
    ctx.userId,
    name,
    kind,
    { autoNumber: true },
  );
  return {
    created: campaignSummary(campaign),
    next: setupChecklist(campaign),
  };
}

async function checklistAction(
  ctx: ProjectActionContext,
  args: Record<string, unknown>,
) {
  const nameOrId = String(args.name_or_id || "").trim();
  if (!nameOrId) return { error: "Give a campaign name or id" };
  const kind = args.kind ? asKind(args.kind) : undefined;
  const campaign = await findCampaign(ctx.projectId, nameOrId, kind);
  if (!campaign) return { error: `No campaign matches "${nameOrId}"` };
  return setupChecklist(campaign);
}

async function updateCampaignAction(
  ctx: ProjectActionContext,
  args: Record<string, unknown>,
) {
  const nameOrId = String(args.name_or_id || "").trim();
  if (!nameOrId) return { error: "Give a campaign name or id" };
  const kindHint = args.kind ? asKind(args.kind) : undefined;
  const existing = await findCampaign(ctx.projectId, nameOrId, kindHint);
  if (!existing) return { error: `No campaign matches "${nameOrId}"` };
  if (existing.status === "sent" || existing.status === "sending") {
    return {
      error: `Campaign "${existing.name}" is already ${existing.status}. Create a new draft instead.`,
    };
  }

  const patch: Partial<DripCampaign> = {};
  const oneOne = isOneOneCampaign(existing);

  if (typeof args.subject === "string") {
    const subject = args.subject.trim();
    if (oneOne) {
      // Applied onto sequences below.
    } else {
      patch.subject = subject;
    }
  }
  if (typeof args.preview_text === "string") {
    patch.previewText = args.preview_text.trim();
  }
  if (typeof args.timezone === "string" && args.timezone.trim()) {
    patch.timezone = args.timezone.trim();
    patch.timezoneEnabled = true;
  }
  if (typeof args.window_start === "string" && args.window_start.trim()) {
    patch.windowStart = args.window_start.trim();
  }
  if (typeof args.window_end === "string" && args.window_end.trim()) {
    patch.windowEnd = args.window_end.trim();
  }
  if (typeof args.reply_to_email === "string") {
    const reply = args.reply_to_email.trim();
    patch.replyToEmail = reply;
    patch.replyToEnabled = Boolean(reply);
  }
  if (typeof args.email_gap_minutes === "number" && Number.isFinite(args.email_gap_minutes)) {
    patch.emailGapMinutes = Math.max(0, Math.round(args.email_gap_minutes));
  }
  if (typeof args.sender_display_name === "string") {
    patch.senderName = args.sender_display_name.trim();
  }

  if (typeof args.sender_email_or_id === "string" && args.sender_email_or_id.trim()) {
    const sender = await resolveSender(ctx.projectId, args.sender_email_or_id);
    if (!sender) {
      return {
        error: `No sender matches "${args.sender_email_or_id}". Use list_senders or add_sender first.`,
      };
    }
    patch.senderId = sender.id;
    patch.senderEmail = sender.fromEmail;
    if (!patch.senderName) {
      patch.senderName = existing.senderName || sender.fromEmail.split("@")[0] || "";
    }
  }

  if (typeof args.list_name_or_id === "string" && args.list_name_or_id.trim()) {
    const list = await resolveList(ctx.projectId, args.list_name_or_id);
    if (!list) {
      return {
        error: `No contact list matches "${args.list_name_or_id}". Use list_contact_lists or create_contact_list.`,
      };
    }
    patch.listId = list._id.toString();
    patch.listName = list.name;
    patch.listDisplayId = list.displayId;
    patch.recipientMode = "list";
  }

  const bodyRaw =
    typeof args.body_html_or_text === "string" ? args.body_html_or_text : "";
  const bodyHtml = bodyRaw ? toEmailHtml(bodyRaw) : "";

  if (oneOne) {
    const sequences: CampaignSequence[] = [
      ...(existing.sequences?.length
        ? existing.sequences.map((s) => ({ ...s }))
        : [createEmptySequence(0)]),
    ];
    if (args.add_sequence === true) {
      sequences.push(createEmptySequence(sequences.length));
    }
    const index = Math.max(
      0,
      Math.min(
        sequences.length - 1,
        typeof args.sequence_index === "number" ? Math.round(args.sequence_index) : 0,
      ),
    );
    const target = { ...sequences[index] };
    if (typeof args.subject === "string") {
      target.subject = args.subject.trim();
    }
    if (typeof args.preview_text === "string" && index === 0) {
      target.previewText = args.preview_text.trim();
    }
    if (bodyHtml) {
      target.designHtml = bodyHtml;
      target.hasDesign = true;
    }
    if (typeof args.sequence_delay_days === "number" && Number.isFinite(args.sequence_delay_days)) {
      target.delayDays = Math.max(0, Math.round(args.sequence_delay_days));
    }
    sequences[index] = target;
    patch.sequences = sequences;
    // Keep top-level mirrors for sequence 0.
    if (index === 0) {
      if (target.subject !== undefined) patch.subject = target.subject;
      if (target.designHtml) {
        patch.designHtml = target.designHtml;
        patch.hasDesign = true;
      }
    }
  } else if (bodyHtml) {
    patch.designHtml = bodyHtml;
    patch.hasDesign = true;
  }

  const updated = await updateProjectDripCampaign(
    ctx.projectId,
    existing.id,
    patch,
    existing.kind === "oneone" ? "oneone" : "drip",
  );
  if (!updated) return { error: "Failed to update campaign" };
  return {
    updated: campaignSummary(updated),
    checklist: setupChecklist(updated),
  };
}

async function launchCampaignAction(
  ctx: ProjectActionContext,
  args: Record<string, unknown>,
) {
  const nameOrId = String(args.name_or_id || "").trim();
  if (!nameOrId) return { error: "Give a campaign name or id" };
  const mode = args.mode === "later" ? "later" : args.mode === "now" ? "now" : null;
  if (!mode) return { error: "mode must be now or later" };
  const kindHint = args.kind ? asKind(args.kind) : undefined;
  const campaign = await findCampaign(ctx.projectId, nameOrId, kindHint);
  if (!campaign) return { error: `No campaign matches "${nameOrId}"` };

  const checklist = setupChecklist(campaign);
  if (!checklist.canLaunch) {
    return {
      error: "Campaign is not ready to launch",
      checklist,
    };
  }

  const report = await launchCampaignBlast({
    projectId: ctx.projectId,
    campaign,
    mode,
    scheduledFor:
      mode === "later" ? String(args.scheduled_for || "").trim() || undefined : undefined,
    origin: appOrigin(),
  });
  const launched = mergeBlastReport(campaign, report);
  const updated = await updateProjectDripCampaign(
    ctx.projectId,
    campaign.id,
    launched,
    campaign.kind === "oneone" ? "oneone" : "drip",
  );
  return {
    launched: true,
    mode,
    status: report.status,
    recipients: report.recipients,
    scheduledFor: report.scheduledFor,
    campaign: campaignSummary(updated ?? launched),
  };
}

function listSenderProvidersAction() {
  return {
    providers: SMTP_PROVIDERS.map((provider) => ({
      id: provider.id,
      name: provider.name,
      description: provider.description,
      fields: provider.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: Boolean(field.required),
        placeholder: field.placeholder,
      })),
      defaults: provider.defaults ?? {},
    })),
    tip: "Call request_sender_form to show inline inputs, then add_sender after the user submits.",
  };
}

function buildSenderForm(providerId: SmtpProviderId, fromEmail: string): AgentForm | null {
  const provider = SMTP_PROVIDERS.find((item) => item.id === providerId);
  if (!provider) return null;
  const fields: AgentForm["fields"] = provider.fields
    .filter((field) => field.key !== "fromEmail")
    .map((field) => ({
      key:
        field.key === "smtpHost"
          ? "smtp_host"
          : field.key === "smtpUser"
            ? "smtp_user"
            : field.key === "smtpPassword"
              ? "smtp_password"
              : field.key === "smtpPort"
                ? "smtp_port"
                : field.key === "apiKey"
                  ? "api_key"
                  : field.key === "cloudflareAccountId"
                    ? "cloudflare_account_id"
                    : field.key === "cloudflareEmailApiToken"
                      ? "cloudflare_email_api_token"
                      : String(field.key),
      label: field.label,
      type: field.type,
      placeholder: field.placeholder,
      required: Boolean(field.required),
      defaultValue:
        field.key === "smtpHost"
          ? provider.defaults?.smtpHost
          : field.key === "smtpPort"
            ? provider.defaults?.smtpPort ?? 587
            : undefined,
      help:
        field.key === "smtpHost" && providerId === "aws_ses"
          ? "Region endpoint, e.g. email-smtp.us-east-1.amazonaws.com"
          : field.key === "smtpUser" && providerId === "aws_ses"
            ? "SES SMTP username (not your IAM console password)"
            : undefined,
    }));
  fields.push({
    key: "no_inbox",
    label: "Outbound only (skip inbox auth checks)",
    type: "checkbox",
    required: false,
    help: "Turn on if this address will not receive replies and you want to skip SPF/DKIM/DMARC checks.",
    defaultValue: false,
  });
  if (providerId === "gmail") {
    fields.push({
      key: "daily_limit",
      label: "Daily send limit",
      type: "number",
      required: false,
      defaultValue: 80,
      help: "Max emails this Gmail sender may send per UTC day.",
    });
  }
  return {
    id: `sender-${providerId}-${Date.now().toString(36)}`,
    title: `Add ${provider.name} sender`,
    description: `Enter credentials for ${fromEmail.trim()}.`,
    submitLabel: "Add sender",
    fields,
    hidden: {
      provider: providerId,
      from_email: fromEmail.trim(),
      intent: "add_sender",
    },
  };
}

function presentFormAction(args: Record<string, unknown>) {
  const form = normalizePresentFormArgs(args);
  if (!form) {
    return { error: "title and at least one field are required" };
  }
  return {
    presented: true,
    form,
    instruction:
      "Write a short professional note above the form. Do not re-list the fields in bullet points — the UI shows inputs.",
  };
}

function requestSenderFormAction(args: Record<string, unknown>) {
  const provider = String(args.provider || "").trim() as SmtpProviderId;
  const fromEmail = String(args.from_email || "").trim();
  if (!fromEmail) return { error: "from_email is required" };
  const form = buildSenderForm(provider, fromEmail);
  if (!form) {
    return { error: `Unknown provider "${provider}"` };
  }
  return {
    presented: true,
    form,
    instruction:
      "Confirm the from address and provider in one short sentence. The credential form appears under your reply — do not list SMTP fields as bullets.",
  };
}

async function addSenderAction(
  ctx: ProjectActionContext,
  args: Record<string, unknown>,
) {
  const provider = String(args.provider || "").trim() as SmtpProviderId;
  if (!SMTP_PROVIDERS.some((item) => item.id === provider)) {
    return {
      error: `Unknown provider "${provider}". Call list_sender_providers.`,
    };
  }
  const body: Record<string, unknown> = {
    fromEmail: String(args.from_email || "").trim(),
    smtpHost: args.smtp_host,
    smtpUser: args.smtp_user,
    smtpPassword: args.smtp_password,
    smtpPort: args.smtp_port,
    apiKey: args.api_key,
    cloudflareAccountId: args.cloudflare_account_id,
    cloudflareEmailApiToken: args.cloudflare_email_api_token,
    noInbox: Boolean(args.no_inbox),
    dailyLimit: args.daily_limit,
  };
  const parsed = parseSenderInput(provider, body, { mode: "create" });
  if (parsed.error) {
    return { error: parsed.error, needed: listSenderProvidersAction().providers.find((p) => p.id === provider) };
  }
  const sender = await createProjectSender(ctx.projectId, ctx.userId, parsed.data);
  return {
    created: {
      id: sender.id,
      email: sender.fromEmail,
      provider: sender.providerName,
      spf: sender.verification?.spfOk,
      dkim: sender.verification?.dkimOk,
      dmarc: sender.verification?.dmarcOk,
      link: PORTAL_ROUTES.smtp,
    },
    tip: "You can now set this sender on a campaign with update_campaign_setup (sender_email_or_id).",
  };
}

async function createListAction(
  ctx: ProjectActionContext,
  args: Record<string, unknown>,
) {
  const name = String(args.name || "").trim();
  if (!name) return { error: "List name is required" };
  const list = await createList(ctx.projectId, name, ctx.userId);
  return {
    created: {
      id: list._id.toString(),
      displayId: list.displayId,
      name: list.name,
      contacts: list.contactCount,
      link: `${PORTAL_ROUTES.lists}/${list._id.toString()}`,
    },
    tip: "List is empty until contacts are imported. Attach it to a campaign with update_campaign_setup list_name_or_id.",
  };
}

export async function runProjectActionTool(
  ctx: ProjectActionContext,
  name: string,
  args: Record<string, unknown>,
): Promise<{ handled: true; output: unknown } | { handled: false }> {
  switch (name) {
    case "create_campaign":
      return { handled: true, output: await createCampaignAction(ctx, args) };
    case "get_campaign_setup_checklist":
      return { handled: true, output: await checklistAction(ctx, args) };
    case "update_campaign_setup":
      return { handled: true, output: await updateCampaignAction(ctx, args) };
    case "launch_campaign":
      return { handled: true, output: await launchCampaignAction(ctx, args) };
    case "list_sender_providers":
      return { handled: true, output: listSenderProvidersAction() };
    case "present_input_form":
      return { handled: true, output: presentFormAction(args) };
    case "request_sender_form":
      return { handled: true, output: requestSenderFormAction(args) };
    case "add_sender":
      return { handled: true, output: await addSenderAction(ctx, args) };
    case "create_contact_list":
      return { handled: true, output: await createListAction(ctx, args) };
    default:
      return { handled: false };
  }
}

/** Pull the latest presented form from a tool output payload. */
export function extractPresentedForm(output: unknown): AgentForm | null {
  if (!output || typeof output !== "object") return null;
  const row = output as { presented?: unknown; form?: unknown };
  if (!row.presented || !row.form || typeof row.form !== "object") return null;
  const form = row.form as AgentForm;
  if (!form.title || !Array.isArray(form.fields) || form.fields.length === 0) {
    return null;
  }
  return form;
}
