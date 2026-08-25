const STORAGE_KEY = "portal_saved_test_emails_v1";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function loadSavedTestEmails(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map(normalizeEmail)
      .filter(isValidEmail);
  } catch {
    return [];
  }
}

export function saveSavedTestEmails(emails: string[]) {
  if (typeof window === "undefined") {
    return [];
  }

  const unique = Array.from(new Set(emails.map(normalizeEmail).filter(isValidEmail)));
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(unique));
  return unique;
}

export function addSavedTestEmail(email: string) {
  if (!isValidEmail(email)) {
    return loadSavedTestEmails();
  }
  return saveSavedTestEmails([...loadSavedTestEmails(), email]);
}

export function removeSavedTestEmail(email: string) {
  const target = normalizeEmail(email);
  return saveSavedTestEmails(loadSavedTestEmails().filter((item) => item !== target));
}
