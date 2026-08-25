type IconProps = {
  className?: string;
};

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2.25,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconHome({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <path d="M12 5.2 18.8 11v7.3c0 .9-.8 1.7-1.7 1.7H15v-3.8H9V20H6.9c-.9 0-1.7-.8-1.7-1.7V11L12 5.2z" />
    </svg>
  );
}

export function IconCrm({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M8 17.2c1.2-2.8 3.2-4.2 4-4.2s2.8 1.4 4 4.2" />
    </svg>
  );
}

export function IconMarketing({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <path d="M4 12.5 20.5 4.5 13.5 20.5 10.5 12.5 4 12.5z" />
      <path d="M20.5 4.5 10.5 12.5" />
    </svg>
  );
}

export function IconAnalytics({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9h9" />
    </svg>
  );
}

export function IconSmtp({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 8 9 6 9-6" />
    </svg>
  );
}

export function IconSuppression({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 8 8 8M16 8l-8 8" />
    </svg>
  );
}

export function IconHelp({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.2a2.6 2.6 0 1 1 4.2 2c-.8.6-1.7 1.1-1.7 2.3" />
      <circle cx="12" cy="17.2" r=".9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSettings({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function IconBell({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function IconChevronDown({ className }: IconProps) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconContact({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" />
      <path d="M17 8v6M14 11h6" />
    </svg>
  );
}

export function IconCustomize({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="3" width="7" height="7" rx="1.2" />
      <rect x="14" y="3" width="7" height="7" rx="1.2" />
      <rect x="3" y="14" width="7" height="7" rx="1.2" />
      <rect x="14" y="14" width="7" height="7" rx="1.2" />
    </svg>
  );
}

export function IconChevronLeft({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function IconChevronRight({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function IconSidebarToggle({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

export function getNavIcon(pageId: string) {
  switch (pageId) {
    case "dashboard":
      return IconHome;
    case "crm":
      return IconCrm;
    case "marketing":
      return IconMarketing;
    case "analytics":
      return IconAnalytics;
    case "smtp":
      return IconSmtp;
    case "unsub":
      return IconSuppression;
    default:
      return IconHome;
  }
}
