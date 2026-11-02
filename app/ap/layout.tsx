import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shared project performance",
  description: "Shared Nexuses all-projects performance report.",
};

export default function PublicAllProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="admin-public-shell">
      <div className="admin-public-inner">{children}</div>
    </div>
  );
}
