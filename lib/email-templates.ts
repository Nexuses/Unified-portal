export type SavedEmailTemplate = {
  id: string;
  name: string;
  subject: string;
  html: string;
  sourceCampaignId: string;
  savedAt: string;
};

const STORAGE_KEY = "portal_email_templates_v1";

export function loadEmailTemplates(): SavedEmailTemplate[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ?? window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as SavedEmailTemplate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEmailTemplates(templates: SavedEmailTemplate[]) {
  if (typeof window === "undefined") {
    return;
  }
  const payload = JSON.stringify(templates);
  try {
    window.localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    // Quota or private mode — still try sessionStorage.
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, payload);
  } catch {
    // Ignore storage failures; campaign HTML is still saved separately.
  }
}

export function upsertEmailTemplate(template: SavedEmailTemplate) {
  const current = loadEmailTemplates();
  const next = [template, ...current.filter((item) => item.id !== template.id)];
  saveEmailTemplates(next);
  return next;
}

export function getEmailTemplate(id: string) {
  return loadEmailTemplates().find((item) => item.id === id) ?? null;
}
