import Image from "next/image";

const NEXUSES_LOGO_URL =
  "https://cdn-nexlink.s3.us-east-2.amazonaws.com/Nexuses-full-logo-dark_8d412ea3-bf11-4fc6-af9c-bee7e51ef494.png";

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
