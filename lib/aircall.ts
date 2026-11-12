/** Shared Aircall types + phone helpers (client-safe). */

export type AircallCallDirection = "inbound" | "outbound";

export type AircallCallRow = {
  id: string;
  aircallCallId: number;
  direction: AircallCallDirection | string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number;
  phone: string;
  phoneDigits: string;
  userName: string;
  numberName: string;
  missedCallReason: string | null;
  hasRecording: boolean;
  recordingProxyUrl: string | null;
  assetUrl: string | null;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  timelineLogged: boolean;
  syncedAt: string;
};

export function digitsOnlyPhone(value: string | undefined | null) {
  return String(value ?? "").replace(/\D+/g, "");
}

/**
 * Best-effort E.164 for Aircall dial.
 * Keeps +… as-is; 10-digit local numbers default to +91 (India).
 */
export function toE164Phone(value: string | undefined | null) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const digits = digitsOnlyPhone(raw);
  if (!digits) {
    return "";
  }
  if (raw.startsWith("+")) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return `+91${digits.slice(1)}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

/** Compare phones by last 10 digits (handles +91 / country codes). */
export function phoneMatchKey(value: string | undefined | null) {
  const digits = digitsOnlyPhone(value);
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

export function phonesLikelyMatch(a: string | undefined | null, b: string | undefined | null) {
  const left = phoneMatchKey(a);
  const right = phoneMatchKey(b);
  if (!left || !right) {
    return false;
  }
  return left === right;
}

export function formatCallDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins <= 0) {
    return `${secs}s`;
  }
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

export function formatCallWhen(iso: string | null | undefined) {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
