import type { Metadata } from "next";
import localFont from "next/font/local";
import "../portal/portal.css";

const inter = localFont({
  src: "../fonts/InterLatin.woff2",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Event report",
  description: "Shared Nexgos Platform event campaign report.",
};

export default function PublicEventReportRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`portal-route public-report-route ${inter.className}`}>
      {children}
    </div>
  );
}
