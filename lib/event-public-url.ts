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
