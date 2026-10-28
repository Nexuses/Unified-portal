/** Client + server helpers to tidy CRM import name / company / position. */

export type CleanableContact = {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string;
  position?: string;
};

const NAME_PREFIXES = new Set(
  [
    "ca",
    "mr",
    "mrs",
    "ms",
    "miss",
    "dr",
    "prof",
    "professor",
    "er",
    "eng",
    "adv",
    "advocate",
    "sir",
    "madam",
    "shri",
    "smt",
    "sri",
    "fr",
    "rev",
    "hon",
    "col",
    "capt",
    "lt",
    "gen",
  ].map((item) => item.toLowerCase()),
);

function collapseSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripTrailingPunctuation(value: string) {
  return value.replace(/^[,;|/·•\-\s]+|[,;|/·•\-\s]+$/g, "").trim();
}

/** Drop Arabic and other non-Latin letters; keep Latin, digits, common punctuation. */
export function preferEnglishCompanyName(raw: string) {
  const value = collapseSpaces(raw);
  if (!value) {
    return "";
  }
  const withoutOtherScripts = value
    .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g, " ")
    .replace(/[\u0400-\u04FF\u0500-\u052F]+/g, " ")
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF]+/g, " ")
    .replace(/[\u0900-\u097F]+/g, " ");
  const cleaned = collapseSpaces(withoutOtherScripts.replace(/[|／／]+/g, " "));
  if (cleaned) {
    return cleaned;
  }
  // If nothing Latin remained, keep original trimmed so we don't blank the field.
  return value;
}

/** Keep the first clear title (before comma / slash / pipe). */
export function primaryPositionTitle(raw: string) {
  const value = collapseSpaces(raw);
  if (!value) {
    return "";
  }
  const first = value.split(/[,;/|·•]|\band\b/i)[0] ?? value;
  return stripTrailingPunctuation(collapseSpaces(first));
}

function isSingleLetterToken(token: string) {
  const cleaned = token.replace(/\./g, "");
  return /^[A-Za-z]$/.test(cleaned);
}

/**
 * Split a full / messy person name into first + last.
 * - Strips titles like CA / Mr / Dr
 * - "CA Anubhav Singh" → Anubhav / Singh
 * - "N Tiwari" → Tiwari / "" (avoid "Hi N")
 */
export function cleanPersonName(firstNameRaw: string, lastNameRaw: string) {
  let first = collapseSpaces(firstNameRaw);
  let last = collapseSpaces(lastNameRaw);

  // If last is empty and first looks like a full name, split it.
  if (!last && first.includes(" ")) {
    const tokens = first.split(" ").filter(Boolean);
    while (tokens.length > 1 && NAME_PREFIXES.has(tokens[0].replace(/\./g, "").toLowerCase())) {
      tokens.shift();
    }
    if (tokens.length === 0) {
      return { firstName: "", lastName: "" };
    }
    if (tokens.length === 1) {
      return { firstName: tokens[0], lastName: "" };
    }
    // Single-letter first token → use remaining as greeting name.
    if (isSingleLetterToken(tokens[0]) && tokens.length >= 2) {
      return {
        firstName: tokens.slice(1).join(" "),
        lastName: "",
      };
    }
    return {
      firstName: tokens[0],
      lastName: tokens.slice(1).join(" "),
    };
  }

  // Strip prefixes from first name field.
  const firstTokens = first.split(" ").filter(Boolean);
  while (
    firstTokens.length > 0 &&
    NAME_PREFIXES.has(firstTokens[0].replace(/\./g, "").toLowerCase())
  ) {
    firstTokens.shift();
  }
  first = firstTokens.join(" ");

  if (isSingleLetterToken(first) && last) {
    return { firstName: last, lastName: "" };
  }

  // first still has multiple words and last empty was handled above;
  // if first has multiple words AND last exists, keep first token only as firstName.
  if (first.includes(" ") && last) {
    const tokens = first.split(" ").filter(Boolean);
    return {
      firstName: tokens[0] ?? "",
      lastName: collapseSpaces([tokens.slice(1).join(" "), last].filter(Boolean).join(" ")),
    };
  }

  return { firstName: first, lastName: last };
}

export function cleanContactFields(input: {
  firstName: string;
  lastName: string;
  companyName: string;
  position?: string;
}) {
  const names = cleanPersonName(input.firstName, input.lastName);
  return {
    firstName: names.firstName,
    lastName: names.lastName,
    companyName: preferEnglishCompanyName(input.companyName),
    position: primaryPositionTitle(input.position ?? ""),
  };
}

export function cleanableContactNeedsAi(contact: CleanableContact) {
  const cleaned = cleanContactFields(contact);
  const position = String(contact.position ?? "");
  const company = contact.companyName;
  const messyCompany =
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u4E00-\u9FFF\u0900-\u097F]/.test(
      company,
    );
  const messyPosition = /[,;/|]/.test(position) && position.length > 24;
  const nameChanged =
    cleaned.firstName !== collapseSpaces(contact.firstName) ||
    cleaned.lastName !== collapseSpaces(contact.lastName);
  return messyCompany || messyPosition || nameChanged;
}
