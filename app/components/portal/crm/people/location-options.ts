export const LOCATION_SUGGESTIONS = [
  "United States",
  "Americas",
  "North America",
  "EMEA",
  "Dallas/Fort Worth Area",
  "Greater Houston Area",
  "Europe",
  "European Union",
  "Germany",
  "Miami/Fort Lauderdale Area",
  "California, US",
  "India",
  "United Kingdom",
  "Greater Denver Area",
  "San Francisco Bay Area",
  "Greater Los Angeles Area",
  "Greater Philadelphia Area",
  "Russia",
  "Texas, US",
  "Greater New York City Area",
] as const;

export function getLocationSuggestions(): string[] {
  return [...LOCATION_SUGGESTIONS];
}

export function mergeLocationOptions(staticOptions: string[], dataOptions: string[]) {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const option of [...staticOptions, ...dataOptions]) {
    const trimmed = option.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }

  return merged;
}
