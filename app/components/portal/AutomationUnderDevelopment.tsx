"use client";

/** Placeholder shown while Automation is rebuilt. Keeps the route usable. */
export default function AutomationUnderDevelopment() {
  return (
    <div className="auto-under-dev">
      <div className="auto-under-dev-card">
        <p className="auto-under-dev-kicker">Marketing</p>
        <h1>Automation</h1>
        <p className="auto-under-dev-status">Under development</p>
        <p className="auto-under-dev-copy">
          We are rebuilding Automation with a better flow. Existing automations
          and their campaigns are paused until the new version is ready.
        </p>
      </div>
    </div>
  );
}
