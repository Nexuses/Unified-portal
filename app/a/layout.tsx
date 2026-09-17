import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../portal/portal.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Shared analytics",
  description: "Shared Nexuses analytics report.",
};

export default function PublicAnalyticsLayout({
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
