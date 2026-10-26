import type { Metadata } from "next";
import localFont from "next/font/local";
import "../portal/portal.css";

const inter = localFont({
  src: "../fonts/InterLatin.woff2",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Shared lead report",
  description: "Shared Nexuses lead qualification report.",
};

export default function PublicLeadReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`portal-route public-report-route public-lead-page ${inter.className}`}
    >
      {children}
    </div>
  );
}
