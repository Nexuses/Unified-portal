/** Hidden honeypot link. Scanners open it; people almost never do. */
export function hiddenClickTrapHtml(href: string) {
  const safe = String(href ?? "").trim().replace(/"/g, "%22");
  if (!safe) return "";
  return `<div style="max-height:0;overflow:hidden;opacity:0;mso-hide:all;" aria-hidden="true"><a href="${safe}" tabindex="-1" style="font-size:0;line-height:0;color:transparent;text-decoration:none;">&#8203;</a></div>`;
}

/** True when this destination is the bot honeypot trap link. */
export function isClickTrapUrl(url: string) {
  const raw = String(url ?? "").trim();
  if (!raw) {
    return false;
  }
  if (/nxs-click-trap/i.test(raw)) {
    return true;
  }
  try {
    const parsed = new URL(raw);
    return /\/nxs-click-trap\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}
