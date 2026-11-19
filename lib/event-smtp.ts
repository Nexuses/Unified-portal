/** Client-safe SMTP provider presets and helpers (no Node built-ins). */

export type SmtpProviderId =
  | "gmail"
  | "outlook"
  | "aws_ses"
  | "cloudflare"
  | "resend"
  | "custom";

export type EventSmtpConfig = {
  provider: SmtpProviderId;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  /** Cloudflare Account ID (provider = cloudflare). */
  accountId?: string;
};

export type SmtpProviderPreset = {
  id: SmtpProviderId;
  label: string;
  description: string;
  host: string;
  port: number;
  secure: boolean;
  userHint: string;
  passHint: string;
  defaultUser?: string;
};

export const SMTP_PROVIDER_PRESETS: SmtpProviderPreset[] = [
  {
    id: "gmail",
    label: "Gmail",
    description: "SMTP host, user, password, port, and From email.",
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    userHint: "your@gmail.com",
    passHint: "App password",
  },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    description: "SMTP host, user, password, port, and From email.",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    userHint: "you@company.com",
    passHint: "Password or app password",
  },
  {
    id: "aws_ses",
    label: "AWS SES",
    description: "SES SMTP host, user, password, port, and From email.",
    host: "email-smtp.us-east-1.amazonaws.com",
    port: 587,
    secure: false,
    userHint: "SMTP username",
    passHint: "SMTP password",
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    description: "Account ID, Email API token, and From email.",
    host: "api.cloudflare.com",
    port: 443,
    secure: true,
    userHint: "Account ID",
    passHint: "Email API token",
  },
  {
    id: "resend",
    label: "Resend",
    description: "From email and Resend API key only.",
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    userHint: "resend",
    passHint: "re_xxxxxxxx",
    defaultUser: "resend",
  },
  {
    id: "custom",
    label: "Custom SMTP",
    description: "Any other SMTP server.",
    host: "",
    port: 587,
    secure: false,
    userHint: "SMTP username",
    passHint: "SMTP password",
  },
];

export function getSmtpProviderPreset(provider: SmtpProviderId) {
  return SMTP_PROVIDER_PRESETS.find((item) => item.id === provider) ?? SMTP_PROVIDER_PRESETS.at(-1)!;
}

export function smtpProviderLabel(provider: SmtpProviderId | undefined) {
  if (!provider) {
    return "Custom SMTP";
  }
  return getSmtpProviderPreset(provider).label;
}

export function emptySmtpConfigForProvider(provider: SmtpProviderId): EventSmtpConfig {
  const preset = getSmtpProviderPreset(provider);
  return {
    provider,
    host: preset.host,
    port: preset.port,
    secure: preset.secure,
    user: preset.defaultUser ?? "",
    pass: "",
    accountId: "",
  };
}

export function normalizeSmtpProviderId(value: unknown): SmtpProviderId {
  const id = String(value ?? "").trim();
  if (SMTP_PROVIDER_PRESETS.some((item) => item.id === id)) {
    return id as SmtpProviderId;
  }
  return "custom";
}

export function normalizeEventSmtpConfig(value: unknown): EventSmtpConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const provider = normalizeSmtpProviderId(raw.provider);
  const pass = String(raw.pass ?? "");
  const port = Number(raw.port);

  if (provider === "cloudflare") {
    const accountId = String(raw.accountId ?? raw.user ?? "").trim();
    if (!accountId || !pass.trim()) {
      return undefined;
    }
    return {
      provider,
      host: "api.cloudflare.com",
      port: 443,
      secure: true,
      user: "",
      pass: pass.trim(),
      accountId,
    };
  }

  if (provider === "resend") {
    if (!pass.trim()) {
      return undefined;
    }
    const preset = getSmtpProviderPreset("resend");
    return {
      provider,
      host: preset.host,
      port: preset.port,
      secure: preset.secure,
      user: "resend",
      pass: pass.trim(),
    };
  }

  const host = String(raw.host ?? "").trim();
  const user = String(raw.user ?? "").trim();
  if (!host || !user || !pass.trim()) {
    return undefined;
  }

  return {
    provider,
    host,
    port: Number.isFinite(port) && port > 0 ? Math.floor(port) : 587,
    secure: raw.secure === true || Number(raw.port) === 465,
    user,
    pass: pass.trim(),
  };
}
