import { revalidatePath, revalidateTag } from "next/cache";
import { getEventById } from "@/lib/events";

export type RevalidateEventPagesOptions = {
  eventId?: string;
  publicId?: string;
};

/** Bust cached dashboard and public event pages after event or registration data changes. */
export function revalidateEventPages(options?: RevalidateEventPagesOptions) {
  revalidateTag("events", "max");
  revalidatePath("/portal/marketing/events");

  if (options?.eventId) {
    revalidatePath(`/portal/marketing/events/${options.eventId}`);
    revalidatePath(`/portal/marketing/events/${options.eventId}/edit`);
  }

  if (options?.publicId) {
    revalidatePath(`/e/${options.publicId}`);
  }
}

/** @deprecated Prefer {@link revalidateEventPages}. Kept for existing imports. */
export function revalidateDashboardPages(options?: RevalidateEventPagesOptions) {
  revalidateEventPages(options);
}

export async function revalidateEventPagesByEventId(eventId: string) {
  const event = await getEventById(eventId);
  revalidateEventPages({
    eventId,
    publicId: typeof event?.publicId === "string" ? event.publicId : undefined,
  });
}
