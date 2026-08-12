"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LOGO_URL =
  "https://cdn-nexlink.s3.us-east-2.amazonaws.com/Nexuses-full-logo-dark_8d412ea3-bf11-4fc6-af9c-bee7e51ef494.png";

const navItems = [
  { label: "Project & User", href: "/admin/dashboard" },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const activeTitle =
    navItems.find((item) => pathname.startsWith(item.href))?.label ??
    "Project & User";

  async function handleLogout() {
    await fetch("/api/auth/admin-logout", { method: "POST" });
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <Image
            src={LOGO_URL}
            alt="Nexuses"
            width={160}
            height={40}
            className="admin-sidebar-logo"
            priority
            unoptimized
          />
        </div>

        <nav className="admin-sidebar-nav">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`admin-nav-link${isActive ? " is-active" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button type="button" className="admin-logout-btn" onClick={handleLogout}>
          Logout
        </button>
      </aside>

      <div className="admin-main">
        <header className="admin-header">
          <div>
            <p className="admin-header-eyebrow">Admin Dashboard</p>
            <h1 className="admin-header-title">{activeTitle}</h1>
          </div>
          <p className="admin-header-meta">Manage projects and users</p>
        </header>

        <div className="admin-content">{children}</div>
      </div>
    </div>
  );
}
