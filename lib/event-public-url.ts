import { PUBLIC_APP_ORIGIN } from "@/lib/campaign-tracking";

/** Public registration page for an event campaign. */
export function eventPublicPath(publicId: string) {
  return `/e/${encodeURIComponent(publicId)}`;
}

export function eventPublicOrigin() {
  return PUBLIC_APP_ORIGIN.replace(/\/$/, "");
}

export function eventPublicUrl(publicId: string) {
  return `${eventPublicOrigin()}${eventPublicPath(publicId)}`;
}

function hostIsLocal(host: string) {
  const bare = host.trim().toLowerCase();
  const name = bare.startsWith("[")
    ? bare.slice(1, bare.indexOf("]"))
    : bare.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "0.0.0.0" || name === "::1";
}

/**
 * Origin for redirects after public email links. Behind the production proxy Next
 * often sees http://localhost:3000 — never send guests there.
 */
export function resolvePublicOrigin(request: {
  nextUrl: { origin: string };
  headers: { get(name: string): string | null };
}) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  const host = request.headers.get("host")?.trim() ?? "";
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const publicHost = [forwardedHost, host].find((value) => value && !hostIsLocal(value));
  if (publicHost) {
    const proto = forwardedProto === "http" ? "http" : "https";
    return `${proto}://${publicHost}`;
  }

  const fromEnv =
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SERVER_URL?.trim();
  if (fromEnv) {
    try {
      const url = new URL(fromEnv);
      if (!hostIsLocal(url.host)) return url.origin;
    } catch {
      // Ignore a malformed env URL and keep looking.
    }
  }

  try {
    const requestOrigin = new URL(request.nextUrl.origin);
    if (!hostIsLocal(requestOrigin.host)) return requestOrigin.origin;
  } catch {
    // Fall through to the public site origin.
  }

  if (process.env.NODE_ENV === "production") {
    return eventPublicOrigin();
  }
  return request.nextUrl.origin;
}
