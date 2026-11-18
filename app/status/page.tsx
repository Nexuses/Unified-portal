import { NEXUSES_LOGO_URL } from "@/lib/nexuses-logo";
import { getPlatformStatusPage } from "@/lib/platform-status";
import { StatusBoard, StatusMark } from "./StatusBoard";
import { StatusRefresh } from "./StatusRefresh";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const status = await getPlatformStatusPage();

  return (
    <main className="nxs-status">
      <StatusRefresh />
      <header className="nxs-status-top">
        <img src={NEXUSES_LOGO_URL} alt="Nexuses" className="nxs-status-logo" />
        <span>Status</span>
      </header>

      <section className={`nxs-status-banner ${status.overall}`}>
        <div className="nxs-status-banner-top">
          <StatusMark state={status.overall} large />
          <h1>{status.headline}</h1>
        </div>
        <p>{status.summary}</p>
      </section>

      <StatusBoard groups={status.groups} days={status.days} rangeLabel={status.rangeLabel} />

      <section className="nxs-status-section">
        <div className="nxs-status-section-head">
          <h2>Past incidents</h2>
        </div>
        {status.incidents.length ? (
          <div className="nxs-status-incidents">
            {status.incidents.map((incident) => (
              <article key={`${incident.title}-${incident.startedAt}`}>
                <header>
                  <h3>{incident.title}</h3>
                  <span>{incident.resolvedAt ? `Resolved ${incident.resolvedAt}` : "Ongoing"}</span>
                </header>
                <p>Started {incident.startedAt}</p>
                <ul>
                  {incident.updates.map((update) => (
                    <li key={`${update.at}-${update.body}`}>
                      <time>{update.at}</time>
                      <span>{update.body}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className="nxs-status-empty">No incidents reported.</p>
        )}
      </section>

      <footer className="nxs-status-foot">
        {status.updatedAt ? `Updated ${status.updatedAt} IST.` : "Checking the APIs now."} This page refreshes every
        minute. A down API is posted to Slack after it fails twice, and Slack is updated again when it is fixed and live.
      </footer>
    </main>
  );
}
