"use client";

import { useEffect, useState } from "react";
import { formatHeaderClock } from "@/lib/public-event-time";
import { useViewerTimeZone } from "@/lib/use-viewer-time-zone";

export function PublicHeaderClock() {
  const { viewerTimeZone, isReady } = useViewerTimeZone();

  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    if (!isReady || !viewerTimeZone) {
      return;
    }
    const tz = viewerTimeZone;
    function tick() {
      setCurrentTime(formatHeaderClock(new Date(), tz));
    }
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [isReady, viewerTimeZone]);

  return (
    <p className="min-w-[9.5rem] tabular-nums text-[15px] leading-none font-medium text-[#a8abad]">
      {isReady && viewerTimeZone ? currentTime : "\u00A0"}
    </p>
  );
}
