"use client";

import { useEffect, useState } from "react";
import PortalDashboard from "@/app/components/portal/PortalDashboard";

export default function PortalHomePage() {
  const [firstName, setFirstName] = useState("there");

  useEffect(() => {
    async function loadUser() {
      try {
        const response = await fetch("/api/auth/me");
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        setFirstName(data.fullName?.split(" ")[0] ?? data.fullName ?? "there");
      } catch {
        // Keep default greeting.
      }
    }

    void loadUser();
  }, []);

  return <PortalDashboard firstName={firstName} />;
}
