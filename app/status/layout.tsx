import type { Metadata } from "next";
import "./status.css";

export const metadata: Metadata = {
  title: "Status",
  description: "Live status of every Nexgos Platform API.",
};

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
