"use client";

import {
  IconBell,
  IconChevronDown,
  IconHelp,
  IconSettings,
} from "./PortalIcons";

type PortalTopbarProps = {
  fullName: string;
  pageTitle: string;
  onLogout: () => void;
};

function getInitials(fullName: string) {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 1)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default function PortalTopbar({
  fullName,
  pageTitle,
  onLogout,
}: PortalTopbarProps) {
  const firstName = fullName.split(" ")[0] ?? fullName;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 id="pageTitle">{pageTitle}</h1>
      </div>
      <div className="topbar-right">
        <button type="button" className="top-icon" aria-label="Help">
          <IconHelp />
        </button>
        <button type="button" className="top-icon" aria-label="Settings">
          <IconSettings />
        </button>
        <button type="button" className="top-icon" aria-label="Notifications">
          <IconBell />
        </button>
        <button type="button" className="org-pill" onClick={onLogout}>
          <div className="avatar">{getInitials(fullName)}</div>
          {firstName}
          <IconChevronDown />
        </button>
      </div>
    </header>
  );
}
