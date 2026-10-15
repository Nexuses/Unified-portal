import type { PeopleLookalikeReference } from "@/lib/people/data-browser/types";

export type PeopleLookalikeSuggestion = {
  id: string;
  name: string;
  title: string;
  company: string;
  firstName: string;
  lastName: string;
  linkedInUrl?: string;
  industry?: string;
  logoId?: string;
  avatarLabel: string;
  avatarClassName: string;
};

export const PEOPLE_LOOKALIKE_SUGGESTIONS: PeopleLookalikeSuggestion[] = [
  {
    id: "mike-braham",
    logoId: "mike-braham",
    name: "Mike Braham",
    firstName: "Mike",
    lastName: "Braham",
    title: "Chief Growth Officer and Board of Directors",
    company: "Intelligram",
    avatarLabel: "MB",
    avatarClassName: "bg-emerald-100 text-emerald-700",
  },
  {
    id: "bill-gates",
    logoId: "bill-gates",
    name: "Bill Gates",
    firstName: "Bill",
    lastName: "Gates",
    title: "Founder",
    company: "Breakthrough Energy",
    avatarLabel: "BG",
    avatarClassName: "bg-lime-400 text-slate-900",
  },
  {
    id: "bobby-purnama",
    logoId: "bobby-purnama",
    name: "Bobby Purnama",
    firstName: "Bobby",
    lastName: "Purnama",
    title: "General Purchase & Customs",
    company: "Hyundai",
    avatarLabel: "H",
    avatarClassName: "bg-blue-700 text-white",
  },
  {
    id: "christian-luedders",
    logoId: "christian-luedders",
    name: "Christian Luedders",
    firstName: "Christian",
    lastName: "Luedders",
    title: "Product Designer",
    company: "NovaTaste",
    avatarLabel: "NT",
    avatarClassName: "bg-orange-100 text-orange-700",
  },
  {
    id: "yunming-shao",
    logoId: "yunming-shao",
    name: "Yunming Shao",
    firstName: "Yunming",
    lastName: "Shao",
    title: "Managing Director",
    company: "CHINA",
    avatarLabel: "CN",
    avatarClassName: "bg-red-700 text-white",
  },
  {
    id: "larry-fink",
    logoId: "larry-fink",
    name: "Larry Fink",
    firstName: "Larry",
    lastName: "Fink",
    title: "Chairman and CEO",
    company: "BlackRock",
    avatarLabel: "BR",
    avatarClassName: "bg-slate-900 text-white",
  },
  {
    id: "crawford-how",
    logoId: "crawford-how",
    name: "Crawford How",
    firstName: "Crawford",
    lastName: "How",
    title: "Sales Representative",
    company: "Vantage",
    avatarLabel: "V",
    avatarClassName: "bg-rose-900 text-white",
  },
  {
    id: "satya-nadella",
    logoId: "satya-nadella",
    name: "Satya Nadella",
    firstName: "Satya",
    lastName: "Nadella",
    title: "Chairman and CEO",
    company: "Microsoft",
    avatarLabel: "MS",
    avatarClassName: "bg-white text-slate-800 ring-1 ring-slate-200",
  },
  {
    id: "jeff-weiner",
    logoId: "jeff-weiner",
    name: "Jeff Weiner",
    firstName: "Jeff",
    lastName: "Weiner",
    title: "Founding Partner",
    company: "Next Play",
    avatarLabel: "NP",
    avatarClassName: "bg-blue-900 text-white",
  },
  {
    id: "susanna-su",
    logoId: "susanna-su",
    name: "Susanna Su",
    firstName: "Susanna",
    lastName: "Su",
    title: "Sales Representative",
    company: "MORSTAR",
    avatarLabel: "MS",
    avatarClassName: "bg-white text-blue-800 ring-1 ring-slate-200",
  },
];

export type PeopleSuggestionRecord = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  title: string;
  company: string;
  linkedInUrl: string;
  industry: string;
};

export function recordToSuggestion(record: PeopleSuggestionRecord): PeopleLookalikeSuggestion {
  const companyInitial = record.company.trim().charAt(0).toUpperCase() || "?";
  return {
    id: record.id,
    name: record.name,
    firstName: record.firstName,
    lastName: record.lastName,
    title: record.title,
    company: record.company,
    linkedInUrl: record.linkedInUrl,
    industry: record.industry,
    avatarLabel: companyInitial,
    avatarClassName: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
  };
}

export function mergePeopleSuggestions(
  records: PeopleSuggestionRecord[]
): PeopleLookalikeSuggestion[] {
  const fromData = records.map(recordToSuggestion);
  const seen = new Set(
    fromData.map((person) => person.name.trim().toLowerCase())
  );

  const extras = PEOPLE_LOOKALIKE_SUGGESTIONS.filter(
    (person) => !seen.has(person.name.trim().toLowerCase())
  );

  return [...fromData, ...extras];
}

export function formatPeopleLookalikeQuery(suggestion: PeopleLookalikeSuggestion) {
  return suggestion.company
    ? `${suggestion.name} ${suggestion.company}`
    : suggestion.name;
}

export function suggestionToReference(
  suggestion: PeopleLookalikeSuggestion
): PeopleLookalikeReference {
  return {
    firstName: suggestion.firstName,
    lastName: suggestion.lastName,
    company: suggestion.company,
    title: suggestion.title,
    industry: suggestion.industry,
    linkedInUrl: suggestion.linkedInUrl,
  };
}
