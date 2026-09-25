export type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

/** Ensure header labels are unique for mapping UI keys (empty / duplicate columns). */
export function uniquifyCsvHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((raw, index) => {
    const base = raw.trim() || `Column ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

export function parseCsv(text: string): ParsedCsv {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = uniquifyCsvHeaders(parseCsvLine(lines[0]));
  const rows = lines.slice(1).map(parseCsvLine);

  return { headers, rows };
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_ALIASES: Record<string, string[]> = {
  firstName: [
    "firstname",
    "first",
    "fname",
    "givenname",
    "fullname",
  ],
  lastName: ["lastname", "last", "lname", "surname", "familyname"],
  email: ["email", "emailaddress", "mail", "e-mail"],
  companyName: [
    "companyname",
    "company",
    "organization",
    "organisation",
    "org",
  ],
  position: ["position", "title", "jobtitle", "role", "job"],
  industry: ["industry", "sector", "vertical"],
  website: ["website", "url", "companywebsite", "site", "web"],
  companySourceUrl: [
    "companysourceurl",
    "companysource",
    "companylinkedin",
    "companylink",
  ],
  personalLinkedIn: [
    "personallinkedin",
    "linkedin",
    "linkedinurl",
    "profilelinkedin",
    "linkedinprofile",
  ],
  contactSourceUrl: [
    "contactsourceurl",
    "contactsource",
    "sourceurl",
    "profileurl",
  ],
  personLocation: [
    "personlocation",
    "location",
    "city",
    "state",
    "region",
    "country",
  ],
  phoneNumber: [
    "phonenumber",
    "phone",
    "mobile",
    "mobilenumber",
    "cellphone",
    "cell",
    "tel",
    "telephone",
  ],
};

/** label text from DEFAULT_LIST_ATTRIBUTES, normalized */
const LABEL_TO_FIELD: Record<string, string> = {
  firstname: "firstName",
  lastname: "lastName",
  companyname: "companyName",
  position: "position",
  email: "email",
  phonenumber: "phoneNumber",
  industry: "industry",
  website: "website",
  companysourceurl: "companySourceUrl",
  personallinkedin: "personalLinkedIn",
  contactsourceurl: "contactSourceUrl",
  personlocation: "personLocation",
};

export function guessHeaderMapping(headers: string[]) {
  const mapping: Record<string, string> = {};
  const usedHeaders = new Set<string>();
  const usedFields = new Set<string>();
  const normalizedHeaders = headers.map((header) => ({
    original: header,
    normalized: normalizeHeader(header),
  }));

  // Exact label / key match first (e.g. "First Name", "Company Source URL")
  for (const header of normalizedHeaders) {
    const fromLabel = LABEL_TO_FIELD[header.normalized];
    const fromKey = Object.keys(HEADER_ALIASES).find(
      (key) => normalizeHeader(key) === header.normalized,
    );
    const field = fromLabel ?? fromKey;
    if (!field || usedFields.has(field) || usedHeaders.has(header.original)) {
      continue;
    }
    mapping[field] = header.original;
    usedFields.add(field);
    usedHeaders.add(header.original);
  }

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (usedFields.has(field)) {
      continue;
    }
    const match = normalizedHeaders.find(
      (header) =>
        !usedHeaders.has(header.original) &&
        aliases.includes(header.normalized),
    );
    if (match) {
      mapping[field] = match.original;
      usedFields.add(field);
      usedHeaders.add(match.original);
    }
  }

  return mapping;
}

export function csvCell(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: string[][],
) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  const blob = new Blob([`\uFEFF${lines.join("\n")}\n`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const CORE_FIELDS = new Set([
  "firstName",
  "lastName",
  "email",
  "companyName",
]);

export function mapRowsToContacts(
  headers: string[],
  rows: string[][],
  mapping: Record<string, string>,
) {
  const indexMap = Object.fromEntries(
    Object.entries(mapping)
      .filter(([, header]) => Boolean(header))
      .map(([field, header]) => [field, headers.indexOf(header)]),
  );

  return rows
    .map((row) => {
      const get = (field: string) => {
        const index = indexMap[field];
        if (index === undefined || index < 0) {
          return "";
        }
        return row[index] ?? "";
      };

      const attributes: Record<string, string> = {};
      for (const field of Object.keys(mapping)) {
        if (CORE_FIELDS.has(field)) {
          continue;
        }
        const value = get(field).trim();
        if (value) {
          attributes[field] = value;
        }
      }

      return {
        firstName: get("firstName"),
        lastName: get("lastName"),
        email: get("email"),
        companyName: get("companyName"),
        attributes,
      };
    })
    .filter((row) => row.email.trim());
}
