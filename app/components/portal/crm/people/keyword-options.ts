export const KEYWORD_SUGGESTIONS = [
  "Business Consulting & Services",
  "IT Services & IT Consulting",
  "Software Development",
  "Advertising Services",
  "Medical Practices",
  "Project Management",
  "Community Engagement",
  "Technology, Information & Internet",
  "Hospitals & Health Care",
  "Wellness & Fitness Services",
  "Quality Assurance",
  "Risk Management",
  "Non-Profit Organizations",
  "Digital Marketing",
  "Customer Satisfaction",
  "Digital Transformation",
  "Customer Service",
  "Marketing Services",
  "Customer Support",
  "Machinery Manufacturing",
] as const;

export function getKeywordSuggestions(): string[] {
  return [...KEYWORD_SUGGESTIONS];
}
