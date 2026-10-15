export const INDUSTRY_SUGGESTIONS = [
  "Information Technology & Services",
  "Construction",
  "Marketing & Advertising",
  "Real Estate",
  "Health, Wellness & Fitness",
  "Management Consulting",
  "Computer Software",
  "Internet",
  "Retail",
  "Financial Services",
  "Consumer Services",
  "Hospital & Health Care",
  "Automotive",
  "Restaurants",
  "Education Management",
  "Food & Beverages",
  "Design",
  "Hospitality",
  "Accounting",
  "Events Services",
] as const;

export function getIndustrySuggestions(): string[] {
  return [...INDUSTRY_SUGGESTIONS];
}

export function mergeIndustryOptions(staticOptions: string[], dataOptions: string[]) {
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
