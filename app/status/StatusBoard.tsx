"use client";

import { useState } from "react";

type StatusLevel = "operational" | "degraded" | "down";
type Bar = StatusLevel | "none";

type StatusComponent = {
  id: string;
  name: string;
  path: string;
  state: StatusLevel;
  uptime: string;
  detail: string;
  bars: Bar[];
};

type StatusGroup = {
  name: string;
  components: StatusComponent[];
};

export function StatusMark({
  state,
  large = false,
}: {
  state: "operational" | "degraded" | "down" | "partial" | "major";
  large?: boolean;
}) {
  const ok = state === "operational";
  return (
    <span className={`nxs-status-check ${state}${large ? " lg" : ""}`} aria-hidden="true">
      {ok ? (
        <svg viewBox="0 0 16 16">
          <path d="M3.4 8.2 6.5 11.3 12.7 4.7" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16">
          <path d="M8 3.5v5.8" />
          <circle cx="8" cy="12.2" r="0.95" />
        </svg>
      )}
    </span>
  );
}

const STATE_LABEL: Record<StatusLevel, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
};

function groupState(components: StatusComponent[]): StatusLevel {
  if (components.some((component) => component.state === "down")) return "down";
  if (components.some((component) => component.state === "degraded")) return "degraded";
  return "operational";
}

function dayTitle(day: string, bar: Bar) {
  const label = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  if (bar === "none") return `${label}: No data yet`;
  if (bar === "operational") return `${label}: No incidents`;
  return `${label}: ${STATE_LABEL[bar]}`;
}

export function StatusBoard({
  groups,
  days,
  rangeLabel,
}: {
  groups: StatusGroup[];
  days: string[];
  rangeLabel: string;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <section className="nxs-status-board">
      <header className="nxs-status-board-head">
        <h2>System status</h2>
        <p>{rangeLabel}</p>
      </header>
      {groups.map((group) => {
        const expanded = open[group.name] === true;
        const state = groupState(group.components);
        const count = group.components.length;
        return (
          <article key={group.name} className={`nxs-status-cat ${expanded ? "open" : ""}`}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen((current) => ({ ...current, [group.name]: !expanded }))}
            >
              <StatusMark state={state} />
              <strong>{group.name}</strong>
              <span className="nxs-status-count">
                {count} component{count === 1 ? "" : "s"}
              </span>
              <span className="nxs-status-chevron" aria-hidden="true" />
            </button>
            {expanded ? (
              <ul>
                {group.components.map((component) => (
                  <li key={component.id}>
                    <div className="nxs-status-component">
                      <StatusMark state={component.state} />
                      <div className="nxs-status-name">
                        <strong>{component.name}</strong>
                        <span>{component.path}</span>
                      </div>
                      <div className="nxs-status-uptime">{component.uptime}</div>
                      <div className={`nxs-status-state ${component.state}`}>{STATE_LABEL[component.state]}</div>
                    </div>
                    <div className="nxs-status-bars" aria-hidden="true">
                      {component.bars.map((bar, index) => (
                        <i key={days[index]} className={bar} title={dayTitle(days[index] || "", bar)} />
                      ))}
                    </div>
                    {component.detail === "Operational" ? null : (
                      <p className="nxs-status-detail">{component.detail}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
