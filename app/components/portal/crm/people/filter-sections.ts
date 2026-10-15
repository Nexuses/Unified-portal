import {
  Building,
  Building2,
  Cpu,
  DollarSign,
  IdCard,
  Mail,
  MapPin,
  Phone,
  PhoneCall,
  Tag,
  User,
  Users,
  UsersRound,
} from "lucide-react";
import type { FilterSection, FilterKey } from "@/lib/people/data-browser/types";

const PEOPLE_ONLY_FILTER_KEYS = new Set<FilterKey>([
  "name",
  "jobTitles",
  "peopleLookalikes",
  "emailStatus",
  "personalPhone",
]);

const HIDDEN_FILTER_KEYS = new Set<FilterKey>(["companyLookalikes"]);

export function getFilterSectionsForView(view: "people" | "companies"): FilterSection[] {
  return FILTER_SECTIONS.filter((section) => {
    if (HIDDEN_FILTER_KEYS.has(section.key)) return false;
    if (view === "companies" && PEOPLE_ONLY_FILTER_KEYS.has(section.key)) return false;
    return true;
  });
}

export const FILTER_SECTIONS: FilterSection[] = [
  { key: "name", label: "Name", icon: User, type: "search", placeholder: "Enter name..." },
  { key: "jobTitles", label: "Job Titles", icon: IdCard },
  { key: "peopleLookalikes", label: "People Lookalikes", icon: Users },
  { key: "company", label: "Company", icon: Building },
  { key: "companyLookalikes", label: "Company Lookalikes", icon: Building2 },
  { key: "location", label: "Location", icon: MapPin },
  { key: "employees", label: "# Employees", icon: UsersRound },
  { key: "industryKeywords", label: "Industry & Keywords", icon: Tag },
  { key: "emailStatus", label: "Email Status", icon: Mail },
  {
    key: "personalPhone",
    label: "Personal Phone",
    icon: Phone,
  },
  {
    key: "companyPhone",
    label: "Company Phone",
    icon: PhoneCall,
  },
  { key: "technologies", label: "Technologies", icon: Cpu },
  { key: "revenue", label: "Revenue", icon: DollarSign },
];
