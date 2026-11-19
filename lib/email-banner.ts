import {
  canPreviewImage,
  isDataImageUrl,
  isHttpImageUrl,
  isLegacyEmbeddedImage,
} from "@/lib/image-field";

export function isEmailBannerUsable(value: string | null | undefined): boolean {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || isLegacyEmbeddedImage(trimmed)) {
    return false;
  }
  return isHttpImageUrl(trimmed) || isDataImageUrl(trimmed);
}

export function resolveEmailBannerUrl(
  event: {
    emailBannerUrl?: string | null;
    eventBanner?: string | null;
    emailIncludeEventBanner?: boolean | null;
  },
  options?: { override?: string | null; useEventBanner?: boolean }
): string {
  const override = String(options?.override ?? "").trim();
  if (isEmailBannerUsable(override)) {
    return override;
  }

  const useEventBanner =
    typeof options?.useEventBanner === "boolean"
      ? options.useEventBanner
      : event.emailIncludeEventBanner !== false;

  if (!useEventBanner) {
    return "";
  }

  const candidates = [
    String(event.emailBannerUrl ?? "").trim(),
    String(event.eventBanner ?? "").trim(),
  ];

  for (const candidate of candidates) {
    if (isEmailBannerUsable(candidate)) {
      return candidate;
    }
  }

  return "";
}

export function resolveComposerEmailBanner(input: {
  eventBanner?: string | null;
  useEventBanner?: boolean;
}): string {
  if (!input.useEventBanner) {
    return "";
  }

  const eventBanner = String(input.eventBanner ?? "").trim();
  if (isEmailBannerUsable(eventBanner)) {
    return eventBanner;
  }

  return "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildHeadingBarHtml(heading: string, compact = false) {
  const safeHeading = escapeHtml(heading);
  const padding = compact ? "12px 16px" : "18px 20px";
  const fontSize = compact ? "18px" : "22px";
  return [
    `<div style="padding:${padding};background:linear-gradient(90deg,#05a6e3,#5b8e7b,#b17713);color:#fff;">`,
    `<div style="font-size:${fontSize};font-weight:700;line-height:1.3;">${safeHeading}</div>`,
    `</div>`,
  ].join("");
}

/** Full email card: banner left, body right when a banner is set. */
export function buildEmailCardHtml(options: {
  heading: string;
  bannerUrl: string;
  bodyHtml: string;
}) {
  const { heading, bannerUrl, bodyHtml } = options;
  const hasBanner = isEmailBannerUsable(bannerUrl);
  const fontFamily =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  if (hasBanner) {
    return [
      `<div style="background:#f5f5f5;padding:24px;font-family:${fontFamily};color:#161616;">`,
      `<div style="max-width:920px;margin:0 auto;">`,
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%;">`,
      `<tr>`,
      `<td width="280" align="left" valign="top" style="width:280px;max-width:280px;vertical-align:top;padding:0;">`,
      `<img src="${escapeHtml(bannerUrl)}" alt="" width="280" style="display:block;width:280px;max-width:280px;height:auto;border:0;border-radius:18px;outline:none;text-decoration:none;" />`,
      `</td>`,
      `<td align="left" valign="top" style="vertical-align:top;padding-left:16px;">`,
      `<div style="background:#ffffff;border:1px solid rgba(0,0,0,0.08);border-radius:18px;overflow:hidden;">`,
      buildHeadingBarHtml(heading, true),
      `<div style="padding:18px 16px;">`,
      bodyHtml,
      `</div>`,
      `</div>`,
      `</td>`,
      `</tr>`,
      `</table>`,
      `</div>`,
      `</div>`,
    ].join("");
  }

  return [
    `<div style="background:#f5f5f5;padding:24px;font-family:${fontFamily};color:#161616;">`,
    `<div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid rgba(0,0,0,0.08);border-radius:18px;overflow:hidden;">`,
    buildHeadingBarHtml(heading, false),
    `<div style="padding:22px 20px;">`,
    bodyHtml,
    `</div>`,
    `</div>`,
    `</div>`,
  ].join("");
}

/** @deprecated Use buildEmailCardHtml — kept for any legacy callers */
export function buildEmailHeaderHtml(heading: string, bannerUrl: string) {
  return buildHeadingBarHtml(heading, isEmailBannerUsable(bannerUrl));
}
