function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phoneFieldKnownQuery(field: "personal_phone" | "company_phone") {
  return {
    [field]: { $regex: "\\S" },
  };
}

function phoneFieldUnknownQuery(field: "personal_phone" | "company_phone") {
  return {
    $or: [
      { [field]: { $exists: false } },
      { [field]: null },
      { [field]: "" },
      { [field]: { $regex: "^\\s*$" } },
    ],
  };
}

/** Match "5551234" against formatted values like "(555) 123-4567". */
function buildPhoneContainsRegex(query: string): string {
  const trimmed = query.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length > 0) {
    return digits.split("").map((digit) => escapeRegex(digit)).join("\\D*");
  }
  return escapeRegex(trimmed);
}

export function buildPhoneFilterQuery(
  field: "personal_phone" | "company_phone",
  values: string[] | undefined
): Record<string, unknown> {
  if (!values || values.length === 0) return {};

  const queryEntry = values.find((entry) => entry.startsWith("q:"));
  if (queryEntry || values.includes("contains")) {
    const query = queryEntry ? queryEntry.slice(2).trim() : "";
    if (!query) return {};
    return {
      [field]: { $regex: buildPhoneContainsRegex(query), $options: "i" },
    };
  }

  if (values.includes("is_unknown")) {
    return phoneFieldUnknownQuery(field);
  }

  if (values.includes("is_known")) {
    return phoneFieldKnownQuery(field);
  }

  return {};
}
