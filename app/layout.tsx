import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://unified.nexuses.xyz";
const SITE_NAME = "Nexuses Unified Portal";
const SITE_DESCRIPTION =
  "Nexuses Unified Portal for drip and 1-1 campaigns, CRM, automations, SMTP senders, and analytics.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "Nexuses" }],
  creator: "Nexuses",
  publisher: "Nexuses",
  keywords: [
    "Nexuses",
    "Unified Portal",
    "email campaigns",
    "drip campaigns",
    "CRM",
    "marketing automation",
    "analytics",
  ],
  category: "business",
  icons: {
    icon: [
      {
        url: "https://cdn-nexlink.s3.us-east-2.amazonaws.com/Group_15_b5d5ad17-292a-47a6-a4e1-636f541568ae.png",
        type: "image/png",
      },
    ],
    shortcut:
      "https://cdn-nexlink.s3.us-east-2.amazonaws.com/Group_15_b5d5ad17-292a-47a6-a4e1-636f541568ae.png",
    apple:
      "https://cdn-nexlink.s3.us-east-2.amazonaws.com/Group_15_b5d5ad17-292a-47a6-a4e1-636f541568ae.png",
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
