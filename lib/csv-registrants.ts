export type CsvRegistrantRow = {
  name: string;
  email: string;
  companyName: string;
};

export type CsvColumnMapping = {
  nameColumn: number;
  emailColumn: number;
  companyNameColumn: number | null;
};

export type ParsedCsvFile = {
  headers: string[];
  rows: string[][];
  hasHeaderRow: boolean;
};

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: string) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function columnIndex(headers: string[], candidates: string[]) {
  const normalized = headers.map((h) => normalizeHeader(h));
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx >= 0) {
      return idx;
    }
  }
  return -1;
}

function looksLikeHeader(cells: string[]) {
  const normalized = cells.map((h) => normalizeHeader(h));
  return (
    normalized.some((cell) =>
      ["name", "fullname", "attendee", "email", "emailaddress", "mail", "companyname", "company", "organization", "org"].includes(
        cell
      )
    ) || cells.every((cell) => !cell.includes("@"))
  );
}

export function parseCsvFile(text: string): ParsedCsvFile {
  const normalizedText = String(text ?? "").replace(/^\uFEFF/, "");
  const lines = normalizedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { headers: [], rows: [], hasHeaderRow: false };
  }

  const firstCells = splitCsvLine(lines[0]);
  const hasHeaderRow = looksLikeHeader(firstCells);
  const maxColumns = Math.max(
    firstCells.length,
    ...lines.slice(1).map((line) => splitCsvLine(line).length)
  );
  const headers = hasHeaderRow
    ? firstCells
    : Array.from({ length: maxColumns }, (_, index) => `Column ${index + 1}`);
  const dataLines = hasHeaderRow ? lines.slice(1) : lines;
  const rows = dataLines.map((line) => splitCsvLine(line));

  return { headers, rows, hasHeaderRow };
}

export function guessCsvColumnMapping(headers: string[]): CsvColumnMapping {
  const nameIdx = columnIndex(headers, ["name", "fullname", "attendee"]);
  const emailIdx = columnIndex(headers, ["email", "emailaddress", "mail"]);
  const companyIdx = columnIndex(headers, ["companyname", "company", "organization", "org"]);

  return {
    nameColumn: nameIdx >= 0 ? nameIdx : 0,
    emailColumn: emailIdx >= 0 ? emailIdx : Math.min(1, Math.max(0, headers.length - 1)),
    companyNameColumn: companyIdx >= 0 ? companyIdx : headers.length > 2 ? 2 : null,
  };
}

export function mapCsvToRegistrants(
  rows: string[][],
  mapping: CsvColumnMapping
): CsvRegistrantRow[] {
  return rows
    .map((cells) => ({
      name: String(cells[mapping.nameColumn] ?? "").trim(),
      email: String(cells[mapping.emailColumn] ?? "").trim(),
      companyName:
        mapping.companyNameColumn != null && mapping.companyNameColumn >= 0
          ? String(cells[mapping.companyNameColumn] ?? "").trim()
          : "",
    }))
    .filter((row) => row.name && row.email);
}

/** Parses CSV with headers: name, email, company name (or companyname). */
export function parseRegistrantCsv(text: string): CsvRegistrantRow[] {
  const parsed = parseCsvFile(text);
  if (parsed.rows.length === 0) {
    return [];
  }
  const mapping = guessCsvColumnMapping(parsed.headers);
  return mapCsvToRegistrants(parsed.rows, mapping);
}

export type CsvExportRow = CsvRegistrantRow & {
  status?: string;
  inviteSentAt?: string;
};

function escapeCsvCell(value: string) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildSubmissionsExportCsv(
  rows: CsvExportRow[],
  options?: { includeStatus?: boolean; includeInviteSentAt?: boolean }
) {
  const includeStatus = options?.includeStatus ?? false;
  const includeInviteSentAt = options?.includeInviteSentAt ?? false;
  const headers = ["name", "email", "company name"];
  if (includeStatus) {
    headers.push("status");
  }
  if (includeInviteSentAt) {
    headers.push("invite sent at");
  }

  const lines = [headers.join(",")];
  for (const row of rows) {
    const cells = [
      escapeCsvCell(row.name),
      escapeCsvCell(row.email),
      escapeCsvCell(row.companyName),
    ];
    if (includeStatus) {
      cells.push(escapeCsvCell(row.status ?? ""));
    }
    if (includeInviteSentAt) {
      cells.push(escapeCsvCell(row.inviteSentAt ?? ""));
    }
    lines.push(cells.join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function downloadCsvFile(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
