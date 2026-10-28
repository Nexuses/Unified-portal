export const EMAIL_VARIABLE_TAGS = {
  FIRSTNAME: "{{ contact.FIRSTNAME }}",
  LASTNAME: "{{ contact.LASTNAME }}",
  FULLNAME: "{{ contact.FULLNAME }}",
  EMAIL: "{{ contact.EMAIL }}",
  COMPANY: "{{ contact.COMPANY }}",
  POSITION: "{{ contact.POSITION }}",
  LINKEDIN: "{{ contact.LINKEDIN }}",
  UNSUBSCRIBE: "{{ unsubscribe }}",
} as const;

export type EmailVariableName = keyof typeof EMAIL_VARIABLE_TAGS;

export type ContactMergeFields = {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  companyName?: string;
  position?: string;
  personalLinkedIn?: string;
};

/** Flatten CRM contact attrs/profile into merge fields (POSITION, LINKEDIN, …). */
export function contactMergeFieldsFromContact(contact: {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  companyName?: string;
  attributes?: Record<string, string | undefined> | null;
  profile?: { title?: string } | null;
}): ContactMergeFields {
  const position =
    String(contact.attributes?.position ?? "").trim() ||
    String(contact.profile?.title ?? "").trim();
  const personalLinkedIn = String(
    contact.attributes?.personalLinkedIn ?? "",
  ).trim();
  return {
    firstName: contact.firstName ?? "",
    lastName: contact.lastName ?? "",
    fullName: contact.fullName,
    email: contact.email ?? "",
    companyName: contact.companyName ?? "",
    ...(position ? { position } : {}),
    ...(personalLinkedIn ? { personalLinkedIn } : {}),
  };
}

function compactToken(value: string) {
  return value
    .split("|")[0]
    .replace(/['"]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Split "Ada Lovelace" → first / last for {{firstname}} when only a Name column exists. */
export function splitPersonName(raw: string): { firstName: string; lastName: string } {
  const cleaned = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return { firstName: "", lastName: "" };
  }
  const parts = cleaned.split(" ");
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function classifyMergeToken(inner: string): EmailVariableName | null {
  const compact = compactToken(inner);
  if (!compact) {
    return null;
  }

  if (
    compact.includes("unsubscribe") ||
    compact === "unsub" ||
    compact === "unsublink" ||
    compact === "unsuburl" ||
    compact === "listunsub" ||
    compact === "optout" ||
    compact === "optoutlink"
  ) {
    return "UNSUBSCRIBE";
  }

  const key = compact.replace(
    /^(contact|subscriber|recipient|user|customer|member|person)/,
    "",
  );

  if (
    key === "fname" ||
    key === "firstname" ||
    key === "first" ||
    key === "prenom" ||
    key === "givenname" ||
    // Greeting-style {{name}} usually means first name in outreach sheets.
    key === "name"
  ) {
    return "FIRSTNAME";
  }
  if (
    key === "lname" ||
    key === "lastname" ||
    key === "last" ||
    key === "surname" ||
    key === "familyname"
  ) {
    return "LASTNAME";
  }
  if (
    key === "fullname" ||
    key === "full" ||
    key === "displayname" ||
    key === "contactname" ||
    key === "personname"
  ) {
    return "FULLNAME";
  }
  if (key === "email" || key === "emailaddress" || key === "mail") {
    return "EMAIL";
  }
  if (
    key === "company" ||
    key === "companyname" ||
    key === "organisation" ||
    key === "organization" ||
    key === "org"
  ) {
    return "COMPANY";
  }
  if (
    key === "position" ||
    key === "title" ||
    key === "jobtitle" ||
    key === "role" ||
    key === "designation"
  ) {
    return "POSITION";
  }
  if (
    key === "linkedin" ||
    key === "linkedinurl" ||
    key === "personallinkedin" ||
    key === "li"
  ) {
    return "LINKEDIN";
  }

  return null;
}

export function isUnsubscribeMergeToken(inner: string) {
  return classifyMergeToken(inner) === "UNSUBSCRIBE";
}

export function replaceUnsubscribeVariables(html: string, replacement: string) {
  if (!html) {
    return html;
  }

  let next = html.replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/gi, (full, inner: string) =>
    isUnsubscribeMergeToken(inner) ? replacement : full,
  );
  next = next.replace(/\{\{\s*([^}]+?)\s*\}\}/gi, (full, inner: string) =>
    isUnsubscribeMergeToken(inner) ? replacement : full,
  );
  return next;
}

function replaceKnownTags(html: string, pattern: RegExp) {
  return html.replace(pattern, (full, inner: string) => {
    const name = classifyMergeToken(String(inner ?? ""));
    return name ? EMAIL_VARIABLE_TAGS[name] : full;
  });
}

/** Undo entity / fullwidth braces so {{name}} from sheets still matches. */
function decodeMergeBraces(html: string) {
  return html
    .replace(/&#0*123;/g, "{")
    .replace(/&#0*125;/g, "}")
    .replace(/&#x0*7b;/gi, "{")
    .replace(/&#x0*7d;/gi, "}")
    .replace(/&lbrace;/gi, "{")
    .replace(/&rbrace;/gi, "}")
    .replace(/\uFF5B/g, "{")
    .replace(/\uFF5D/g, "}")
    .replace(/\uFE5B/g, "{")
    .replace(/\uFE5C/g, "}");
}

export function normalizeEmailMergeTags(html: string) {
  if (!html) {
    return html;
  }

  // Only rewrite explicit merge-tag formats. Do not touch bare `{foo}` or `%foo%`
  // — those appear in CSS and break HTML when rewritten.
  let next = decodeMergeBraces(html);
  next = replaceKnownTags(next, /\{\{\{\s*([^}]+?)\s*\}\}\}/g);
  next = replaceKnownTags(next, /\{\{\s*([^}]+?)\s*\}\}/g);
  next = replaceKnownTags(next, /\*\|([^|*]+)\|\*/g);
  next = replaceKnownTags(next, /%%([^%]+)%%/g);
  next = replaceKnownTags(next, /\[\[([^\]]+)\]\]/g);
  return next;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Resolve merge values; firstName falls back to the first word of Name / fullName. */
export function contactMergeValues(
  contact: ContactMergeFields | null | undefined,
): Record<Exclude<EmailVariableName, "UNSUBSCRIBE">, string> {
  let firstName = String(contact?.firstName ?? "").trim();
  let lastName = String(contact?.lastName ?? "").trim();
  const fullNameRaw = String(contact?.fullName ?? "").trim();
  const combined = fullNameRaw || [firstName, lastName].filter(Boolean).join(" ");

  if (!firstName && combined) {
    const split = splitPersonName(combined);
    firstName = split.firstName;
    if (!lastName) lastName = split.lastName;
  } else if (firstName && !lastName && /\s/.test(firstName)) {
    const split = splitPersonName(firstName);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  const fullName = [firstName, lastName].filter(Boolean).join(" ") || combined;

  return {
    FIRSTNAME: firstName,
    LASTNAME: lastName,
    FULLNAME: fullName,
    EMAIL: String(contact?.email ?? "").trim(),
    COMPANY: String(contact?.companyName ?? "").trim(),
    POSITION: String(contact?.position ?? "").trim(),
    LINKEDIN: String(contact?.personalLinkedIn ?? "").trim(),
  };
}

/**
 * Replace {{firstname}}, {{name}}, {{ contact.FIRSTNAME }}, *|FNAME|*, etc. with contact data.
 * Unknown tags are left unchanged.
 */
export function applyContactVariables(
  text: string,
  contact: ContactMergeFields | null | undefined,
  forHtml = true,
) {
  if (!text) {
    return text;
  }
  const values = contactMergeValues(contact);
  const fill = (name: EmailVariableName) => {
    if (name === "UNSUBSCRIBE") {
      return null;
    }
    const value = values[name] ?? "";
    return forHtml ? escapeHtml(value) : value;
  };

  let next = normalizeEmailMergeTags(text);
  next = next.replace(/\{\{\s*contact\.([A-Za-z]+)\s*\}\}/g, (full, key: string) => {
    const name = key.toUpperCase() as EmailVariableName;
    return fill(name) ?? full;
  });
  // Safety net for any leftover {{name}} / {{ first name }} that normalize missed.
  next = next.replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/g, (full, inner: string) => {
    const name = classifyMergeToken(String(inner ?? ""));
    return name ? fill(name) ?? full : full;
  });
  next = next.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (full, inner: string) => {
    const name = classifyMergeToken(String(inner ?? ""));
    return name ? fill(name) ?? full : full;
  });
  return next;
}
