export type CompanySuggestion = {
  id: string;
  name: string;
  domain: string;
};

export const COMPANY_SUGGESTIONS: CompanySuggestion[] = [
  { id: "google", name: "Google", domain: "google.com" },
  { id: "amazon", name: "Amazon", domain: "amazon.com" },
  { id: "linkedin", name: "LinkedIn", domain: "linkedin.com" },
  { id: "microsoft", name: "Microsoft", domain: "microsoft.com" },
  { id: "ted", name: "TED Conferences", domain: "ted.com" },
  { id: "deloitte", name: "Deloitte", domain: "deloitte.com" },
  { id: "unilever", name: "Unilever", domain: "unilever.com" },
  { id: "ibm", name: "IBM", domain: "ibm.com" },
  { id: "tcs", name: "Tata Consultancy Services", domain: "tcs.com" },
  { id: "apple", name: "Apple", domain: "apple.com" },
];

export type CompanyOptionItem = {
  name: string;
  domain?: string;
  suggestionId?: string;
};

export function companyDomainByName(name: string): string | undefined {
  const match = COMPANY_SUGGESTIONS.find(
    (company) => company.name.toLowerCase() === name.trim().toLowerCase()
  );
  return match?.domain;
}

export function mergeCompanyOptions(dataOptions: string[]): CompanyOptionItem[] {
  const seen = new Set<string>();
  const merged: CompanyOptionItem[] = [];

  for (const company of COMPANY_SUGGESTIONS) {
    seen.add(company.name.toLowerCase());
    merged.push({
      name: company.name,
      domain: company.domain,
      suggestionId: company.id,
    });
  }

  for (const name of dataOptions) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ name: trimmed });
  }

  return merged;
}
