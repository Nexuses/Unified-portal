export const EMAIL_VARIABLE_TAGS = {
  FIRSTNAME: "{{ contact.FIRSTNAME }}",
  LASTNAME: "{{ contact.LASTNAME }}",
  EMAIL: "{{ contact.EMAIL }}",
  COMPANY: "{{ contact.COMPANY }}",
  UNSUBSCRIBE: "{{ unsubscribe }}",
} as const;

type EmailVariableName = keyof typeof EMAIL_VARIABLE_TAGS;

function compactToken(value: string) {
  return value
    .split("|")[0]
    .replace(/['"]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function classifyMergeToken(inner: string): EmailVariableName | null {
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
    key === "givenname"
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

export function normalizeEmailMergeTags(html: string) {
  if (!html) {
    return html;
  }

  // Only rewrite explicit merge-tag formats. Do not touch bare `{foo}` or `%foo%`
  // — those appear in CSS and break HTML when rewritten.
  let next = html;
  next = replaceKnownTags(next, /\{\{\{\s*([^}]+?)\s*\}\}\}/g);
  next = replaceKnownTags(next, /\{\{\s*([^}]+?)\s*\}\}/g);
  next = replaceKnownTags(next, /\*\|([^|*]+)\|\*/g);
  next = replaceKnownTags(next, /%%([^%]+)%%/g);
  next = replaceKnownTags(next, /\[\[([^\]]+)\]\]/g);
  return next;
}
