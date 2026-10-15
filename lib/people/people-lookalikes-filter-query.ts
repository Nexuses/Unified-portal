import type { PeopleLookalikeReference, PeopleLookalikesFilter } from "@/lib/people/data-browser/types";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function linkedInSlug(url: string) {
  const trimmed = url.trim().toLowerCase();
  const match = trimmed.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (match) return match[1];
  return trimmed.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function regexMatch(field: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return { [field]: { $regex: escapeRegex(trimmed), $options: "i" } };
}

function buildLookalikeReferenceQuery(reference: PeopleLookalikeReference) {
  const orFilters: Record<string, unknown>[] = [];

  const firstName = reference.firstName.trim();
  const lastName = reference.lastName.trim();
  const company = reference.company.trim();
  const title = reference.title.trim();
  const industry = reference.industry?.trim() ?? "";

  if (firstName && lastName) {
    orFilters.push({
      $and: [regexMatch("first_name", firstName), regexMatch("last_name", lastName)].filter(
        Boolean
      ),
    });
  }

  if (title) {
    const titleFilter = regexMatch("title", title);
    if (titleFilter) orFilters.push(titleFilter);
  }

  if (company) {
    const companyFilter = regexMatch("company_name", company);
    if (companyFilter) orFilters.push(companyFilter);
  }

  if (industry) {
    const industryFilter = regexMatch("industry", industry);
    if (industryFilter) orFilters.push(industryFilter);
  }

  if (orFilters.length === 0) return null;
  return { $or: orFilters };
}

function buildTextQuery(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  if (tokens.length >= 2) {
    const [firstToken, secondToken, ...rest] = tokens;
    const orFilters: Record<string, unknown>[] = [
      {
        $and: [
          { first_name: { $regex: escapeRegex(firstToken), $options: "i" } },
          { last_name: { $regex: escapeRegex(secondToken), $options: "i" } },
        ],
      },
    ];

    if (rest.length > 0) {
      const remainder = rest.join(" ");
      orFilters.push(
        { company_name: { $regex: escapeRegex(remainder), $options: "i" } },
        { title: { $regex: escapeRegex(remainder), $options: "i" } }
      );
    }

    return { $or: orFilters };
  }

  const token = tokens[0];
  return {
    $or: [
      { first_name: { $regex: escapeRegex(token), $options: "i" } },
      { last_name: { $regex: escapeRegex(token), $options: "i" } },
      { company_name: { $regex: escapeRegex(token), $options: "i" } },
      { title: { $regex: escapeRegex(token), $options: "i" } },
      {
        $expr: {
          $regexMatch: {
            input: { $concat: ["$first_name", " ", "$last_name"] },
            regex: escapeRegex(token),
            options: "i",
          },
        },
      },
    ],
  };
}

export function buildPeopleLookalikesFilterQuery(filter: PeopleLookalikesFilter) {
  const andFilters: Record<string, unknown>[] = [];

  if (filter.lookalikeOf) {
    const lookalikeQuery = buildLookalikeReferenceQuery(filter.lookalikeOf);
    if (lookalikeQuery) andFilters.push(lookalikeQuery);
  } else if (filter.query.trim()) {
    const textQuery = buildTextQuery(filter.query);
    if (textQuery) andFilters.push(textQuery);
  }

  const urls = filter.workUrls
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (urls.length > 0) {
    andFilters.push({
      $or: urls.map((url) => ({
        person_linkedin_url: {
          $regex: escapeRegex(linkedInSlug(url)),
          $options: "i",
        },
      })),
    });
  }

  if (andFilters.length === 0) return {};
  return { $and: andFilters };
}
