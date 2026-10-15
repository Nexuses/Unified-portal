// Curated alias groups: each inner array is one concept (short forms + full forms).
// These are the source of truth — auto-guessing acronyms is NOT used because titles like
// "Chief Experience Officer" would wrongly become CEO instead of CXO.

export const JOB_TITLE_ALIAS_GROUPS: string[][] = [
  ["CEO", "C.E.O.", "Chief Executive Officer"],
  ["CXO", "Chief Experience Officer"],
  ["CFO", "C.F.O.", "Chief Financial Officer", "Chief Finance Officer", "Group CFO", "Regional CFO", "Deputy CFO"],
  ["COO", "C.O.O.", "Chief Operating Officer", "Chief Operations Officer"],
  ["CTO", "C.T.O.", "Chief Technology Officer", "Chief Technical Officer", "Group CTO"],
  ["CIO", "C.I.O.", "Chief Information Officer"],
  [
    "CISO",
    "Chief Information Security Officer",
    "Chief Security Information Officer",
    "Chief Information Security Officer (CISO)",
  ],
  ["CRO", "Chief Risk Officer", "Chief Revenue Officer"],
  ["CMO", "Chief Marketing Officer"],
  // Ambiguous: keep all valid meanings; context/department narrows at query time
  ["CPO", "Chief Product Officer", "Chief People Officer", "Chief Procurement Officer"],
  [
    "CHRO",
    "Chief Human Resources Officer",
    "Chief Human Resource Officer",
    "Chief People Officer",
  ],
  ["CDO", "Chief Data Officer", "Chief Digital Officer"],
  ["cno", "chief nursing officer"],
  ["cco", "chief compliance officer", "chief commercial officer"],
  ["cbo", "chief business officer"],
  ["cao", "chief administrative officer", "chief accounting officer"],
  ["cvo", "chief vision officer"],
  ["cgo", "chief growth officer"],
  ["cso", "chief security officer", "chief sales officer", "chief strategy officer"],
  ["clo", "chief legal officer"],
  ["csco", "chief supply chain officer"],
  ["dpo", "data protection officer"],
  ["VP", "Vice President", "V.P.", "Vice-President"],
  ["SVP", "Senior Vice President", "Senior VP", "Sr VP", "Sr. VP"],
  ["EVP", "Executive Vice President", "Executive VP"],
  [
    "AVP",
    "Assistant Vice President",
    "Assistant VP",
    "Associate Vice President",
    "Associate VP",
  ],
  ["MD", "Managing Director"],
  ["GM", "General Manager"],
  ["PM", "Project Manager", "Product Manager", "Program Manager"],
  ["HR", "Human Resources", "Human Resource"],
  [
    "IT",
    "Information Technology",
    "Information Systems",
    "IT Infrastructure",
    "Enterprise Applications",
    "Technology Operations",
  ],
  ["IS", "Information Systems"],
  ["MIS", "Management Information Systems"],
  [
    "InfoSec",
    "Information Security",
    "Info Sec",
    "Information Sec",
    "Cyber",
    "Cybersecurity",
    "Cyber Security",
  ],
  ["grc", "governance risk compliance", "governance, risk and compliance", "governance risk & compliance"],
  ["secops", "security operations"],
  ["devops", "development operations"],
  ["sre", "site reliability engineer", "site reliability engineering"],
  ["qa", "quality assurance"],
  ["qc", "quality control"],
  ["ba", "business analyst"],
  ["bdr", "business development representative"],
  ["sdr", "sales development representative"],
  ["ae", "account executive"],
  ["am", "account manager"],
  ["csm", "customer success manager"],
  ["tam", "technical account manager"],
  ["tpm", "technical program manager"],
  ["em", "engineering manager"],
  ["sem", "senior engineering manager"],
  ["swe", "software engineer", "software engineering"],
  ["fe", "frontend engineer", "front end engineer", "front-end engineer"],
  ["be", "backend engineer", "back end engineer", "back-end engineer"],
  ["fs", "full stack engineer", "fullstack engineer", "full-stack engineer"],
  ["de", "data engineer"],
  ["ds", "data scientist"],
  ["da", "data analyst"],
  ["ml", "machine learning"],
  ["ai", "artificial intelligence"],
  ["ux", "user experience"],
  ["ui", "user interface"],
  ["pmo", "project management office"],
  ["fp&a", "financial planning and analysis", "financial planning & analysis"],
  ["ap", "accounts payable"],
  ["ar", "accounts receivable"],
  ["cpa", "certified public accountant"],
  ["cfa", "chartered financial analyst"],
  // Common Apollo-style title pairs (similar mode expands further via order variations)
  ["finance director", "director of finance", "director finance", "financial director"],
  ["it director", "director of it", "director information technology", "director of information technology", "information technology director"],
  ["head of finance", "finance head", "head – finance", "head finance"],
  ["head of it", "it head", "head of information technology"],
];

export const DEPARTMENT_ALIAS_GROUPS: string[][] = [
  ["hr", "human resources", "human resource"],
  ["it", "information technology", "it governance", "it audit"],
  ["grc", "governance risk compliance", "governance, risk and compliance", "governance risk & compliance"],
  ["secops", "security operations"],
  ["infosec", "information security"],
  ["devops", "development operations"],
  ["r&d", "research and development", "research & development"],
  ["fp&a", "financial planning and analysis"],
  ["pmo", "project management office"],
  ["qa", "quality assurance"],
  ["qc", "quality control"],
  ["csr", "corporate social responsibility"],
  ["pr", "public relations"],
  ["bd", "business development"],
  ["cs", "customer success", "customer support"],
  ["ops", "operations"],
  ["mktg", "marketing"],
  ["fin", "finance"],
  ["legal", "law"],
  ["procurement", "purchasing"],
];

export const INDUSTRY_ALIAS_GROUPS: string[][] = [
  ["it", "information technology", "information technology & services"],
  ["saas", "software as a service"],
  ["fintech", "financial technology"],
  ["healthtech", "health technology", "health tech"],
  ["edtech", "education technology", "education tech"],
  ["martech", "marketing technology"],
  ["proptech", "property technology"],
  ["insurtech", "insurance technology"],
  ["biotech", "biotechnology"],
  ["pharma", "pharmaceutical", "pharmaceuticals"],
  ["medtech", "medical technology"],
  ["hr", "human resources"],
  ["hospitality", "hotel", "hotels"],
  ["ecommerce", "e-commerce", "e commerce"],
  ["retail", "consumer retail"],
  ["b2b", "business to business"],
  ["b2c", "business to consumer"],
  ["ngo", "non profit", "non-profit", "nonprofit"],
  ["gov", "government", "public sector"],
  ["oil & gas", "oil and gas", "energy"],
  ["telecom", "telecommunications"],
  ["logistics", "supply chain"],
  ["real estate", "property"],
  ["construction", "building"],
  ["consulting", "management consulting"],
  ["accounting", "audit"],
  ["banking", "financial services"],
  ["insurance", "insurer"],
  ["healthcare", "health care", "hospital & health care"],
  ["education", "edtech"],
  ["manufacturing", "industrial"],
  ["automotive", "auto"],
  ["aerospace", "aviation"],
  ["defense", "defence", "military"],
  ["media", "entertainment"],
  ["advertising", "marketing & advertising"],
];

function normalizeAliasKey(value: string): string {
  return value.trim().toLowerCase().replace(/[.]+/g, "").replace(/\s+/g, " ");
}

export function aliasGroupsToRecord(groups: string[][]): Record<string, string[]> {
  const record: Record<string, string[]> = {};
  for (const group of groups) {
    const cleaned = group.map((entry) => entry.trim()).filter(Boolean);
    if (cleaned.length === 0) continue;
    record[normalizeAliasKey(cleaned[0])] = cleaned;
  }
  return record;
}

export const JOB_TITLE_STATIC_ALIASES = aliasGroupsToRecord(JOB_TITLE_ALIAS_GROUPS);
export const DEPARTMENT_STATIC_ALIASES = aliasGroupsToRecord(DEPARTMENT_ALIAS_GROUPS);
export const INDUSTRY_STATIC_ALIASES = aliasGroupsToRecord(INDUSTRY_ALIAS_GROUPS);

export function allKnownAliasKeys(
  ...records: Array<Record<string, string[]>>
): Set<string> {
  const keys = new Set<string>();
  for (const record of records) {
    for (const aliases of Object.values(record)) {
      for (const alias of aliases) {
        keys.add(normalizeAliasKey(alias));
      }
    }
  }
  return keys;
}
