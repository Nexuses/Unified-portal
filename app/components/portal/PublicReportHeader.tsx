import Image from "next/image";
import { NEXUSES_LOGO_URL } from "@/lib/nexuses-logo";

export function PublicReportHeader({
  clientName,
  clientLogoUrl,
  title,
  description,
}: {
  clientName?: string;
  clientLogoUrl?: string;
  title?: string;
  description?: string;
}) {
  const name = clientName?.trim() || "Client";
  const logo = clientLogoUrl?.trim() || "";

  return (
    <header className="public-report-header">
      <div className="public-report-header-card">
        <div className="public-report-header-brands">
          <Image
            src={NEXUSES_LOGO_URL}
            alt="Nexuses"
            width={128}
            height={28}
            className="public-report-logo"
            style={{ width: "auto", height: 28 }}
            priority
            unoptimized
          />
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="public-report-client-logo" src={logo} alt={`${name} logo`} />
          ) : (
            <span className="public-report-client-fallback" aria-label={`${name} logo`}>
              {name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        {title ? (
          <div className="public-report-header-copy">
            <h1>{title}</h1>
            {description ? <p>{description}</p> : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
