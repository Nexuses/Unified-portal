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

export function parseCsv(text: string): ParsedCsv {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);

  return { headers, rows };
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_ALIASES: Record<string, string[]> = {
  firstName: ["firstname", "first", "fname", "givenname"],
  lastName: ["lastname", "last", "lname", "surname", "familyname"],
  email: ["email", "emailaddress", "mail"],
  companyName: ["companyname", "company", "organization", "organisation", "org"],
};

export function guessHeaderMapping(headers: string[]) {
  const mapping: Record<string, string> = {};
  const normalizedHeaders = headers.map((header) => ({
    original: header,
    normalized: normalizeHeader(header),
  }));

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const match = normalizedHeaders.find((header) =>
      aliases.includes(header.normalized),
    );
    if (match) {
      mapping[field] = match.original;
    }
  }

  return mapping;
}

export function mapRowsToContacts(
  headers: string[],
  rows: string[][],
  mapping: Record<string, string>,
) {
  const indexMap = Object.fromEntries(
    Object.entries(mapping).map(([field, header]) => [
      field,
      headers.indexOf(header),
    ]),
  );

  return rows
    .map((row) => ({
      firstName: row[indexMap.firstName] ?? "",
      lastName: row[indexMap.lastName] ?? "",
      email: row[indexMap.email] ?? "",
      companyName: row[indexMap.companyName] ?? "",
    }))
    .filter((row) => row.email.trim());
}
