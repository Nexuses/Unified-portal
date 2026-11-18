import Link from "next/link";
import { CreateEventForm } from "@/components/create-event-form";

export default function CreateEventPage() {
  return (
    <>
      <div className="crm-page-head drip-page-head">
        <div>
          <h2>Create campaign</h2>
          <p>This stays on the project you are in. Saving opens the public form and its link.</p>
        </div>
        <div className="crm-actions">
          <Link href="/portal/marketing/events" className="btn-soft">
            Cancel
          </Link>
        </div>
      </div>
      <div className="event-workspace">
        <CreateEventForm />
      </div>
    </>
  );
}
