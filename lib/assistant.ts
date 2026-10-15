import type { AiSearchFilters } from "@/lib/people/ai-search";
import type { AssistantPitchResearchCard } from "@/lib/pitch-research";

/** Line the assistant ends a reply with when the user asked for a CSV download. */
export const CSV_MARKER = "[[download-csv]]";

/** Line the assistant ends a reply with when the user wants to upload a file to S3. */
export const UPLOAD_MARKER = "[[upload-file]]";

/** People-database search shown as a result card under the assistant reply. */
export type AssistantPeopleSearchCard = {
  kind: "people-search";
  total: number;
  summary: string;
  filters: AiSearchFilters;
};

/** Result cards shown under an assistant reply. */
export type AssistantCard = AssistantPeopleSearchCard | AssistantPitchResearchCard;
