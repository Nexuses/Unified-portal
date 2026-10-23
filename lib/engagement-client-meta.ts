export type EngagementDevice = "mobile" | "tablet" | "desktop" | "unknown";

export type EngagementClientMeta = {
  ip?: string;
  userAgent?: string;
  device?: EngagementDevice;
};

export function classifyDevice(userAgent: string): EngagementDevice {
  const ua = userAgent.trim();
  if (!ua) {
    return "unknown";
  }
  if (/iPad|Tablet|Android(?!.*Mobile)|Silk|Kindle|PlayBook/i.test(ua)) {
    return "tablet";
  }
  if (
    /Mobile|iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini|Windows Phone/i.test(
      ua,
    )
  ) {
    return "mobile";
  }
  return "desktop";
}

/** Best-effort client IP + device from request headers (proxy-aware). */
export function clientMetaFromHeaders(headers: Headers): EngagementClientMeta {
  const forwarded = headers.get("x-forwarded-for") || "";
  const ip = (
    forwarded.split(",")[0]?.trim() ||
    headers.get("cf-connecting-ip") ||
    headers.get("true-client-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-vercel-forwarded-for") ||
    ""
  )
    .trim()
    .slice(0, 64);

  const userAgent = (headers.get("user-agent") || "").trim().slice(0, 400);
  return {
    ...(ip ? { ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    device: classifyDevice(userAgent),
  };
}

export function formatEngagementDevice(device?: EngagementDevice | string) {
  if (!device || device === "unknown") {
    return "";
  }
  return device.charAt(0).toUpperCase() + device.slice(1);
}

export function isEngagementDevice(value: unknown): value is EngagementDevice {
  return (
    value === "mobile" ||
    value === "tablet" ||
    value === "desktop" ||
    value === "unknown"
  );
}

/** Prefer the device tied to the earliest engagement timestamp. */
export function preferEarlierDevice(
  currentAt: string | undefined,
  currentDevice: string | undefined,
  nextAt: string | undefined,
  nextDevice: string | undefined,
): { at?: string; device?: string } {
  if (!nextAt) {
    return { at: currentAt, device: currentDevice };
  }
  if (!currentAt || nextAt < currentAt) {
    return { at: nextAt, device: nextDevice };
  }
  if (nextAt === currentAt && !currentDevice && nextDevice) {
    return { at: currentAt, device: nextDevice };
  }
  return { at: currentAt, device: currentDevice };
}
