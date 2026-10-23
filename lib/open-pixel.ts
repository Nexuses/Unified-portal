/** Shown when open is inferred from a click (tracking pixel never loaded). */
export const OPEN_PIXEL_BLOCKED_TAG = "Image pixel blocked";

type OpenClickHints = {
  openedAt?: Date | string | null;
  openCount?: number;
  openPixelBlocked?: boolean;
  clickedAt?: Date | string | null;
  clickCount?: number;
  clickBurstIgnored?: boolean;
};

export function sendHasPixelOpen(send: OpenClickHints) {
  if (send.openPixelBlocked) {
    return false;
  }
  return Boolean(send.openedAt) || (send.openCount ?? 0) > 0;
}

export function sendHasCountableClickHint(send: OpenClickHints) {
  if (send.clickBurstIgnored) {
    return false;
  }
  return Boolean(send.clickedAt) || (send.clickCount ?? 0) > 0;
}

/** Unique open for reporting: real pixel open OR click with blocked images. */
export function sendCountsAsOpen(send: OpenClickHints) {
  return sendHasPixelOpen(send) || send.openPixelBlocked === true || sendHasCountableClickHint(send);
}

/** True when open is only known because they clicked (pixel never fired). */
export function sendOpenPixelBlocked(send: OpenClickHints) {
  if (send.openPixelBlocked) {
    return true;
  }
  return sendHasCountableClickHint(send) && !sendHasPixelOpen(send);
}

export function openPixelBlockedLabel(send: OpenClickHints) {
  return sendOpenPixelBlocked(send) ? OPEN_PIXEL_BLOCKED_TAG : "";
}
