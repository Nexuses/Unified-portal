import type { ContactProfile } from "@/lib/crm";

const APOLLO_MATCH_URL = "https://api.apollo.io/api/v1/people/match";

type ApolloOrg = {
  id?: string;
  name?: string;
  primary_domain?: string;
  website_url?: string;
  linkedin_url?: string;
  industry?: string;
  estimated_num_employees?: number | string;
  short_description?: string;
  seo_description?: string;
  raw_address?: string;
  city?: string;
  state?: string;
  country?: string;
};

type ApolloPerson = {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  headline?: string;
  linkedin_url?: string;
  email?: string;
  city?: string;
  state?: string;
  country?: string;
  organization?: ApolloOrg | null;
  employment_history?: Array<{
    title?: string;
    organization_name?: string;
    current?: boolean;
  }>;
};

export type ApolloMatchResult = {
  person: ApolloPerson | null;
  raw: Record<string, unknown>;
};

function apolloApiKey() {
  const key = process.env.APOLLO_API_KEY?.trim();
  if (!key) {
    throw new Error("APOLLO_API_KEY is not configured.");
  }
  return key;
}

function joinLocation(...parts: Array<string | undefined | null>) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}

function employeeBand(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.round(value));
  }
  return "";
}

function websiteFromOrg(org?: ApolloOrg | null) {
  if (!org) return "";
  if (org.website_url?.trim()) return org.website_url.trim();
  if (org.primary_domain?.trim()) {
    const domain = org.primary_domain.trim().replace(/^https?:\/\//i, "");
    return `https://${domain}`;
  }
  return "";
}

/** Fill only empty profile slots from Apollo person data. */
export function profileFromApolloPerson(
  person: ApolloPerson,
  existing: ContactProfile = {},
): ContactProfile {
  const org = person.organization || undefined;
  const location =
    joinLocation(person.city, person.state, person.country) ||
    existing.location ||
    "";
  const companyLocation =
    joinLocation(org?.city, org?.state, org?.country) ||
    org?.raw_address ||
    existing.company?.location ||
    "";
  const about =
    person.headline?.trim() ||
    (person.title && org?.name
      ? `${person.title} at ${org.name}`
      : person.title || "") ||
    existing.about ||
    "";

  const nextCompany = {
    industry: existing.company?.industry || org?.industry || "",
    employees:
      existing.company?.employees || employeeBand(org?.estimated_num_employees),
    location: existing.company?.location || companyLocation,
    website: existing.company?.website || websiteFromOrg(org),
    linkedinUrl: existing.company?.linkedinUrl || org?.linkedin_url || "",
    description:
      existing.company?.description ||
      org?.short_description ||
      org?.seo_description ||
      "",
  };

  return {
    ...existing,
    title: existing.title || person.title || "",
    linkedinUrl: existing.linkedinUrl || person.linkedin_url || "",
    location: existing.location || location,
    about: existing.about || about,
    source: existing.source || "Apollo",
    company: nextCompany,
    apollo: {
      personId: person.id || existing.apollo?.personId,
      enrichedAt: new Date().toISOString(),
      raw: existing.apollo?.raw,
    },
  };
}

export async function matchPersonByEmail(
  email: string,
): Promise<ApolloMatchResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Contact email is required for Apollo enrich.");
  }

  const url = new URL(APOLLO_MATCH_URL);
  url.searchParams.set("email", trimmed);
  url.searchParams.set("reveal_personal_emails", "false");
  url.searchParams.set("reveal_phone_number", "false");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      accept: "application/json",
      "x-api-key": apolloApiKey(),
    },
    body: "{}",
  });

  const raw = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    const message =
      typeof raw.error === "string"
        ? raw.error
        : typeof raw.message === "string"
          ? raw.message
          : `Apollo enrich failed (${response.status})`;
    throw new Error(message);
  }

  const person =
    raw.person && typeof raw.person === "object"
      ? (raw.person as ApolloPerson)
      : null;

  return { person, raw };
}
