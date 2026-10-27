# Parked CRM contact UIs

## Live

Contact detail uses the **tabs** UI (`../PortalContactDetailPage.tsx`) with a **Lead Report** button that opens `../PortalContactLeadReportView.tsx` (`?view=lead-report`).

## Parked snapshots

- `PortalContactDetailPage.tabs.tsx` — snapshot of the tabs UI
- `PortalContactDetailPage.lead-report.tsx` — snapshot of the lead-report shell

Related (still used by live lead report):

- `../LeadReportOverview.tsx`
- `../../../../lib/apollo.ts`, `../../../../lib/lead-status.ts`
- `../../../../api/crm/contacts/[id]/apollo-enrich/`
- profile fields on contact API / `lib/crm.ts` / `lib/crm-contacts-server.ts`
- lead-report styles in `app/portal/portal.css` (`.lr-*`)
