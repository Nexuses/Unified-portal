import { redirect } from "next/navigation";

export default function AutomationHistoryRoutePage() {
  redirect("/portal/marketing/automation?history=1");
}
