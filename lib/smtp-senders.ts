import type { ObjectId } from "mongodb";
import type { SenderAuthVerification } from "@/lib/mxtoolbox";
import type { TrackingDomainVerification } from "@/lib/campaign-tracking";

export type SmtpProviderId =
  | "aws_ses"
  | "gmail"
  | "outlook"
  | "sendgrid"
  | "cloudflare"
  | "resend";

export type SmtpFieldType = "text" | "email" | "password" | "number";

export type SmtpProviderField = {
  key: keyof SenderCredentials;
  label: string;
  type: SmtpFieldType;
  placeholder?: string;
  required?: boolean;
};

export type SmtpProviderDefinition = {
  id: SmtpProviderId;
  name: string;
  description: string;
  logoUrl?: string;
  iconClass: string;
  iconLabel: string;
  fields: SmtpProviderField[];
  defaults?: Partial<SenderCredentials>;
};

export type SenderCredentials = {
  smtpHost?: string;
  smtpUser?: string;
  smtpPassword?: string;
  smtpPort?: number;
  apiKey?: string;
  cloudflareAccountId?: string;
  cloudflareEmailApiToken?: string;
  fromEmail?: string;
  trackingDomain?: string;
};

export type SenderDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  provider: SmtpProviderId;
  fromEmail: string;
  smtpHost?: string;
  smtpUser?: string;
  smtpPassword?: string;
  smtpPort?: number;
  apiKey?: string;
  cloudflareAccountId?: string;
  cloudflareEmailApiToken?: string;
  verification?: SenderAuthVerification;
  createdBy: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  trackingDomain?: string;
  pendingTrackingDomain?: string;
  trackingVerification?: TrackingDomainVerification;
};

export type SmtpSender = {
  id: string;
  provider: SmtpProviderId;
  providerName: string;
  fromEmail: string;
  smtpHost?: string;
  smtpUser?: string;
  smtpPassword?: string;
  smtpPort?: number;
  apiKey?: string;
  cloudflareAccountId?: string;
  cloudflareEmailApiToken?: string;
  verification?: SenderAuthVerification;
  createdAt: string;
  updatedAt: string;
  trackingDomain?: string;
  pendingTrackingDomain?: string;
  trackingVerification?: TrackingDomainVerification;
};

const SMTP_FIELDS: SmtpProviderField[] = [
  {
    key: "smtpHost",
    label: "SMTP host",
    type: "text",
    placeholder: "smtp.example.com",
    required: true,
  },
  {
    key: "smtpUser",
    label: "SMTP user",
    type: "text",
    placeholder: "username",
    required: true,
  },
  {
    key: "smtpPassword",
    label: "SMTP password",
    type: "password",
    placeholder: "••••••••",
    required: true,
  },
  {
    key: "smtpPort",
    label: "SMTP port",
    type: "number",
    placeholder: "587",
    required: true,
  },
  {
    key: "fromEmail",
    label: "From email",
    type: "email",
    placeholder: "you@company.com",
    required: true,
  },
];

export const SMTP_PROVIDER_LOGOS = {
  aws_ses:
    "https://nexuseslink2024.s3.us-east-2.amazonaws.com/66681500627b2db0acfeb833_AWS_1786699619465_yh85.png",
  gmail:
    "https://nexuseslink2024.s3.us-east-2.amazonaws.com/Gmail-logo-design-on-transparent-background-PNG_1786699619465_csio.png",
  outlook:
    "https://nexuseslink2024.s3.us-east-2.amazonaws.com/images__5__1786699619465_xhir.jpeg",
  sendgrid:
    "https://nexuseslink2024.s3.us-east-2.amazonaws.com/sendgrid-1-logo_1786699892036_wvw5.png",
  cloudflare:
    "https://nexuseslink2024.s3.us-east-2.amazonaws.com/Cloudflare_Logo_1786699892036_98vx.png",
  resend:
    "https://nexuseslink2024.s3.us-east-2.amazonaws.com/resend-icon-black_1786699892036_sqdf.svg",
} as const;

export const SMTP_PROVIDERS: SmtpProviderDefinition[] = [
  {
    id: "aws_ses",
    name: "AWS SES",
    description: "Send through Amazon Simple Email Service SMTP.",
    logoUrl: SMTP_PROVIDER_LOGOS.aws_ses,
    iconClass: "aws",
    iconLabel: "AWS",
    fields: SMTP_FIELDS,
    defaults: { smtpPort: 587 },
  },
  {
    id: "gmail",
    name: "Gmail SMTP",
    description: "Use a Gmail or Google Workspace SMTP relay.",
    logoUrl: SMTP_PROVIDER_LOGOS.gmail,
    iconClass: "gmail",
    iconLabel: "G",
    fields: SMTP_FIELDS,
    defaults: { smtpHost: "smtp.gmail.com", smtpPort: 587 },
  },
  {
    id: "outlook",
    name: "Outlook SMTP",
    description: "Send using Microsoft Outlook or Office 365 SMTP.",
    logoUrl: SMTP_PROVIDER_LOGOS.outlook,
    iconClass: "outlook",
    iconLabel: "O",
    fields: SMTP_FIELDS,
    defaults: { smtpHost: "smtp-mail.outlook.com", smtpPort: 587 },
  },
  {
    id: "sendgrid",
    name: "SendGrid",
    description: "Send email with a SendGrid API key.",
    logoUrl: SMTP_PROVIDER_LOGOS.sendgrid,
    iconClass: "sendgrid",
    iconLabel: "SG",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        type: "password",
        placeholder: "SG.xxxxx",
        required: true,
      },
      {
        key: "fromEmail",
        label: "From email",
        type: "email",
        placeholder: "you@company.com",
        required: true,
      },
    ],
  },
  {
    id: "cloudflare",
    name: "Cloudflare Email",
    description: "Send with Cloudflare Email Routing API credentials.",
    logoUrl: SMTP_PROVIDER_LOGOS.cloudflare,
    iconClass: "cloudflare",
    iconLabel: "CF",
    fields: [
      {
        key: "cloudflareAccountId",
        label: "Cloudflare account ID",
        type: "text",
        placeholder: "Account ID",
        required: true,
      },
      {
        key: "cloudflareEmailApiToken",
        label: "Cloudflare email API token",
        type: "password",
        placeholder: "API token",
        required: true,
      },
      {
        key: "fromEmail",
        label: "From email",
        type: "email",
        placeholder: "you@company.com",
        required: true,
      },
    ],
  },
  {
    id: "resend",
    name: "Resend",
    description: "Send email with a Resend API key.",
    logoUrl: SMTP_PROVIDER_LOGOS.resend,
    iconClass: "resend",
    iconLabel: "Re",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        type: "password",
        placeholder: "re_xxxxx",
        required: true,
      },
      {
        key: "fromEmail",
        label: "From email",
        type: "email",
        placeholder: "you@company.com",
        required: true,
      },
    ],
  },
];

export function getSmtpProvider(id: SmtpProviderId) {
  return SMTP_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

function maskSecret(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  if (value.length <= 4) {
    return "••••";
  }
  return `••••${value.slice(-4)}`;
}

export function mapSender(doc: SenderDoc): SmtpSender {
  const provider = getSmtpProvider(doc.provider);

  return {
    id: doc._id.toString(),
    provider: doc.provider,
    providerName: provider?.name ?? doc.provider,
    fromEmail: doc.fromEmail,
    smtpHost: doc.smtpHost,
    smtpUser: doc.smtpUser,
    smtpPassword: maskSecret(doc.smtpPassword),
    smtpPort: doc.smtpPort,
    apiKey: maskSecret(doc.apiKey),
    cloudflareAccountId: doc.cloudflareAccountId,
    cloudflareEmailApiToken: maskSecret(doc.cloudflareEmailApiToken),
    verification: doc.verification,
    trackingDomain: doc.trackingDomain,
    pendingTrackingDomain: doc.pendingTrackingDomain,
    trackingVerification: doc.trackingVerification,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function parseSenderInput(
  providerId: SmtpProviderId,
  body: Record<string, unknown>,
  options?: { mode?: "create" | "update" },
): { data: Omit<SenderDoc, "_id" | "projectId" | "createdBy" | "createdAt" | "updatedAt">; error?: string } {
  const mode = options?.mode ?? "create";
  const provider = getSmtpProvider(providerId);
  if (!provider) {
    return { data: { provider: providerId, fromEmail: "" }, error: "Unknown provider" };
  }

  const values: SenderCredentials = {};

  for (const field of provider.fields) {
    const raw = body[field.key];
    if (field.type === "number") {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return {
          data: { provider: providerId, fromEmail: "" },
          error: `${field.label} is required`,
        };
      }
      values[field.key] = parsed as never;
      continue;
    }

    const value = String(raw ?? "").trim();
    const isSecretField = field.type === "password";
    const required = field.required && !(mode === "update" && isSecretField);

    if (required && !value) {
      return {
        data: { provider: providerId, fromEmail: "" },
        error: `${field.label} is required`,
      };
    }
    if (field.type === "email" && value && !isValidEmail(value)) {
      return {
        data: { provider: providerId, fromEmail: "" },
        error: "Enter a valid from email address",
      };
    }
    if (value) {
      values[field.key] = value as never;
    }
  }

  return {
    data: {
      provider: providerId,
      fromEmail: values.fromEmail ?? "",
      smtpHost: values.smtpHost,
      smtpUser: values.smtpUser,
      smtpPassword: values.smtpPassword,
      smtpPort: values.smtpPort,
      apiKey: values.apiKey,
      cloudflareAccountId: values.cloudflareAccountId,
      cloudflareEmailApiToken: values.cloudflareEmailApiToken,
    },
  };
}
