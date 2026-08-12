"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const LOGO_URL =
  "https://cdn-nexlink.s3.us-east-2.amazonaws.com/Nexuses-full-logo-dark_8d412ea3-bf11-4fc6-af9c-bee7e51ef494.png";

type PortalUser = {
  id: string;
  fullName: string;
  email: string;
  projectId: string;
  projectName: string;
};

export default function PortalPage() {
  const router = useRouter();
  const [user, setUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSession() {
      try {
        const response = await fetch("/api/auth/me");
        if (!response.ok) {
          router.replace("/login");
          return;
        }
        const data = await response.json();
        setUser(data);
      } catch {
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    }

    void loadSession();
  }, [router]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="portal-page">
        <p className="portal-loading">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="portal-page">
      <header className="portal-header">
        <Image
          src={LOGO_URL}
          alt="Nexuses"
          width={160}
          height={40}
          className="portal-logo"
          priority
          unoptimized
        />
        <button type="button" className="portal-logout-btn" onClick={handleLogout}>
          Logout
        </button>
      </header>

      <main className="portal-card">
        <p className="portal-eyebrow">User Portal</p>
        <h1 className="portal-title">Welcome, {user.fullName}</h1>
        <p className="portal-subtitle">
          You are signed in with your user account from the login page.
        </p>

        <div className="portal-details">
          <div>
            <span>Email</span>
            <strong>{user.email}</strong>
          </div>
          <div>
            <span>Project</span>
            <strong>{user.projectName}</strong>
          </div>
        </div>
      </main>
    </div>
  );
}
