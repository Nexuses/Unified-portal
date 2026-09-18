"use client";

import { useState } from "react";
import {
  getSmtpProvider,
  type SmtpProviderDefinition,
  type SmtpProviderId,
} from "@/lib/smtp-senders";

export function SmtpProviderLogo({
  provider,
  size = "md",
}: {
  provider: Pick<SmtpProviderDefinition, "name" | "logoUrl" | "iconClass" | "iconLabel">;
  size?: "sm" | "md" | "lg" | "head" | "badge";
}) {
  const [failed, setFailed] = useState(false);

  if (provider.logoUrl && !failed) {
    return (
      <span className={`smtp-logo-wrap ${size}`}>
        <img
          src={provider.logoUrl}
          alt=""
          className="smtp-logo"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span className={`smtp-icon ${provider.iconClass} ${size}`} aria-hidden="true">
      {provider.iconLabel}
    </span>
  );
}

export function smtpProviderBadgeLabel(providerId: SmtpProviderId) {
  const provider = getSmtpProvider(providerId);
  if (!provider) {
    return providerId;
  }
  return provider.name.replace(/\s+SMTP$/i, "").replace(/\s+Email$/i, "");
}

export function SmtpProviderBadge({
  providerId,
  className = "",
  iconOnly = false,
}: {
  providerId?: SmtpProviderId | null;
  className?: string;
  iconOnly?: boolean;
}) {
  if (!providerId) {
    return null;
  }
  const provider = getSmtpProvider(providerId);
  if (!provider) {
    return null;
  }
  const label = smtpProviderBadgeLabel(providerId);

  if (iconOnly) {
    return (
      <span
        className={`smtp-provider-icon-only ${className}`.trim()}
        title={provider.name}
        aria-label={provider.name}
      >
        <SmtpProviderLogo provider={provider} size="badge" />
      </span>
    );
  }

  return (
    <span
      className={`smtp-provider-badge ${className}`.trim()}
      title={provider.name}
    >
      <SmtpProviderLogo provider={provider} size="badge" />
      <span>{label}</span>
    </span>
  );
}
