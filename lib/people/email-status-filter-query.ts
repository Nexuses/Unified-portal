import {
  EMAIL_STATUS_OPTIONS,
  getEmailStatusMatchPatterns,
} from "@/app/components/portal/crm/people/email-status-options";

export function buildEmailStatusFilterQuery(values: string[]) {
  const queries = getEmailStatusMatchPatterns(values).map((pattern) => ({
    email_status: { $regex: pattern, $options: "i" },
  }));

  if (queries.length === 0) return {};
  return queries.length === 1 ? queries[0] : { $or: queries };
}

export { EMAIL_STATUS_OPTIONS };
