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
