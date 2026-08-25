"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PortalAppShell, { type PortalUser } from "./PortalAppShell";

type PortalSessionProviderProps = {
  children: React.ReactNode;
};

export default function PortalSessionProvider({
  children,
}: PortalSessionProviderProps) {
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

  if (loading) {
    return <div className="portal-loading-screen">Loading your workspace...</div>;
  }

  if (!user) {
    return null;
  }

  return <PortalAppShell user={user}>{children}</PortalAppShell>;
}
