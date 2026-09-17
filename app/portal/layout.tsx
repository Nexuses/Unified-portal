import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./portal.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Workspace",
  description:
    "Manage drip and 1-1 campaigns, CRM contacts, automations, SMTP senders, and analytics in Nexuses Unified Portal.",
};

export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return <div className={`portal-route ${inter.className}`}>{children}</div>;
}
