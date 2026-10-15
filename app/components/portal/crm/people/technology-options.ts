import { splitTechnologies } from "@/lib/people/technologies";

export type TechnologyOption = {
  name: string;
  category: string;
};

export const TECHNOLOGY_OPTIONS: TechnologyOption[] = [
  { name: "Mobile Friendly", category: "Other" },
  { name: "Google Tag Manager", category: "Tag Management" },
  { name: "WordPress.org", category: "CMS" },
  { name: "Google Font API", category: "Fonts" },
  { name: "Viewport Meta", category: "CSS and JavaScript Libraries" },
  { name: "reCAPTCHA", category: "Captcha" },
  { name: "Outlook", category: "Email Providers" },
  { name: "Apache", category: "Load Balancers" },
  { name: "Gmail", category: "Email Providers" },
  { name: "Google Apps", category: "Other" },
  { name: "Nginx", category: "Load Balancers" },
  { name: "Google Analytics", category: "Analytics and Tracking" },
  { name: "Bootstrap Framework", category: "CSS and JavaScript Libraries" },
  { name: "Microsoft Office 365", category: "Other" },
  { name: "Facebook Login (Connect)", category: "Social Login" },
  { name: "Facebook Widget", category: "Widgets" },
  { name: "Wordpress", category: "CMS" },
  { name: "Google Search Console", category: "Analytics and Tracking" },
  { name: "YouTube", category: "Online Video Platforms" },
  { name: "Cloudflare DNS", category: "Domain Name Services" },
];

const TECHNOLOGY_CATEGORY_BY_NAME = new Map(
  TECHNOLOGY_OPTIONS.map((option) => [option.name.toLowerCase(), option.category])
);

export function getTechnologySuggestions(): string[] {
  return TECHNOLOGY_OPTIONS.map((option) => option.name);
}

export function getTechnologyCategory(name: string): string | undefined {
  return TECHNOLOGY_CATEGORY_BY_NAME.get(name.trim().toLowerCase());
}

export function extractTechnologyOptions(facetValues: string[]): string[] {
  const options = new Set<string>();

  facetValues.forEach((value) => {
    splitTechnologies(value).forEach((technology) => {
      options.add(technology);
    });
  });

  return Array.from(options).sort((a, b) => a.localeCompare(b));
}

export function mergeTechnologyOptions(staticOptions: string[], facetValues: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  const addOption = (option: string) => {
    const key = option.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(option.trim());
  };

  extractTechnologyOptions(facetValues).forEach(addOption);
  staticOptions.forEach(addOption);

  return merged;
}
