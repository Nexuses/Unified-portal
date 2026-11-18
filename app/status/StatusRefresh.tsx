"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function StatusRefresh() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
