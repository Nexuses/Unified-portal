const TECHNOLOGY_TOKEN_SPLIT = /[,;|\n\r]+/;

export function splitTechnologies(value: string): string[] {
  return value
    .split(TECHNOLOGY_TOKEN_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function formatTechnologiesDisplay(value: string): string {
  return splitTechnologies(value).join(", ");
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildTechnologyMatchRegex(technology: string): string {
  const token = escapeRegex(technology.trim());
  return `(?:^|[,;|\\n\\r]\\s*)${token}(?:\\s*[,;|\\n\\r]|$)`;
}

export function buildTechnologyFacets(
  rows: Array<{ _id: string; count?: number }>
): { options: string[]; counts: Record<string, number> } {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    if (!row._id) continue;
    const weight = Number(row.count ?? 1);
    for (const technology of splitTechnologies(row._id)) {
      counts[technology] = (counts[technology] ?? 0) + weight;
    }
  }

  const options = Object.keys(counts).sort((a, b) => a.localeCompare(b));
  return { options, counts };
}
