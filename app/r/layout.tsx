import Image from "next/image";
import { Inter } from "next/font/google";
import "../portal/portal.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const NEXUSES_LOGO_URL =
  "https://cdn-nexlink.s3.us-east-2.amazonaws.com/Nexuses-full-logo-dark_8d412ea3-bf11-4fc6-af9c-bee7e51ef494.png";

export default function PublicReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`portal-route public-report-route ${inter.className}`}>
      <header className="public-report-header">
        <Image
          src={NEXUSES_LOGO_URL}
          alt="Nexuses"
          width={128}
          height={28}
          className="public-report-logo"
          priority
          unoptimized
        />
      </header>
      {children}
    </div>
  );
}

