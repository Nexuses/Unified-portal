export function normalizeRegistrationPhone(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function isValidRegistrationPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function validateWaitlistRegistrationFields(input: {
  companyName?: unknown;
  phone?: unknown;
}): string | null {
  const companyName = String(input.companyName ?? "").trim();
  if (!companyName) {
    return "Company name is required.";
  }
  const phone = normalizeRegistrationPhone(input.phone);
  if (phone && !isValidRegistrationPhone(phone)) {
    return "Enter a valid phone number.";
  }
  return null;
}
