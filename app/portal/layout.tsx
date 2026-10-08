import type { Metadata } from "next";
import localFont from "next/font/local";
import "./portal.css";

const inter = localFont({
  src: "../fonts/InterLatin.woff2",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Workspace",
  description:
    "Manage drip and 1-1 campaigns, CRM contacts, automations, SMTP senders, and analytics in Nexuses Unified Portal.",
};

export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return <div className={`portal-route ${inter.className}`}>{children}</div>;
}
