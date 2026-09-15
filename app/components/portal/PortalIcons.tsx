type IconProps = {
  className?: string;
};

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconHome({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <path d="M4 10.8 12 4l8 6.8V19a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19V10.8z" />
      <path d="M10 20.5V14h4v6.5" />
    </svg>
  );
}

export function IconCrm({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="2.6" />
      <path d="M7.8 17.4c1-2 2.7-3.1 4.2-3.1s3.2 1.1 4.2 3.1" />
    </svg>
  );
}

export function IconMarketing({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <path d="M21.5 3.5 10.8 14.2" />
      <path d="M21.5 3.5 14.2 21l-3.4-7.4L3.5 10.2 21.5 3.5z" />
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
      <path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8.2A1.5 1.5 0 0 1 19 16.7H9.2L5 20.2V7A1.5 1.5 0 0 1 6.5 5.5" />
      <circle cx="8.8" cy="11" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="15.2" cy="11" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSuppression({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <path d="M4 9V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18V9" />
      <path d="M4 9h16V7.2A1.5 1.5 0 0 0 18.5 5.7h-5L11.7 4H5.5A1.5 1.5 0 0 0 4 5.5V9z" />
    </svg>
  );
}

export function IconIntegrations({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <path d="M16.8 7H9.5a3.5 3.5 0 0 0 0 7h.9" />
      <path d="M7.2 17h7.3a3.5 3.5 0 0 0 0-7h-.9" />
      <path d="m15.6 4.8 1.6 1.7-1.6 1.7M8.4 15.8 6.8 17.5l1.6 1.7" />
    </svg>
  );
}

export function IconAutomation({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <circle cx="6.5" cy="6.5" r="2.4" />
      <rect x="14.8" y="15.2" width="4.8" height="4.8" rx="1.1" />
      <path d="M8.7 7.8c2.4 1.1 4.2 3.4 4.6 6.4" />
      <path d="M13.2 16.2 11.2 13.4" />
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
      <path d="M12 3v2.2M12 18.8V21M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M3 12h2.2M18.8 12H21M5.2 18.8l1.6-1.6M17.2 6.8l1.6-1.6" />
    </svg>
  );
}

export function IconBell({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 6.5 2.5 6.5 2.5 8.5h-16c0-2 2.5-2 2.5-8.5" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function IconChevronDown({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconContact({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c0-3 2.6-5 5.5-5s5.5 2 5.5 5" />
      <path d="M17 8v6M14 11h6" />
    </svg>
  );
}

export function IconCustomize({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
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
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9 4.5v15" />
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
    case "automation":
    case "automation-history":
      return IconAutomation;
    case "analytics":
    case "analytics-kanban":
      return IconAnalytics;
    case "smtp":
      return IconSmtp;
    case "unsub":
      return IconSuppression;
    case "integrations":
      return IconIntegrations;
    default:
      return IconHome;
  }
}
