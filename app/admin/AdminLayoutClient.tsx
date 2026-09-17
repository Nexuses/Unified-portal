"use client";

import { usePathname } from "next/navigation";
import AdminShell from "../components/AdminShell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (pathname === "/admin") {
    return children;
  }

  return <AdminShell>{children}</AdminShell>;
}
