export const DEFAULT_PUBLIC_HEADER_LOGO =
  "https://cdn-nexlink.s3.us-east-2.amazonaws.com/Nexuses-full-logo-dark_8d412ea3-bf11-4fc6-af9c-bee7e51ef494.png";

export function resolvePublicHeaderLogo(url?: string | null) {
  const trimmed = String(url ?? "").trim();
  return trimmed || DEFAULT_PUBLIC_HEADER_LOGO;
}
