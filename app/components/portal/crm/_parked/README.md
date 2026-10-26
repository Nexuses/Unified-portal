# Parked CRM contact UIs

## Live

Contact detail uses the **Lead Report** layout (`../PortalContactDetailPage.tsx` + `../LeadReportOverview.tsx`).

## Parked

- `PortalContactDetailPage.tabs.tsx` — previous Overview / History / Lists / Preferences tabs UI
- `PortalContactDetailPage.lead-report.tsx` — snapshot of the lead-report shell (same as live)

Related (still used by live lead report):

- `../LeadReportOverview.tsx`
- `../../../../lib/apollo.ts`, `../../../../lib/lead-status.ts`
- `../../../../api/crm/contacts/[id]/apollo-enrich/`
- profile fields on contact API / `lib/crm.ts` / `lib/crm-contacts-server.ts`
- lead-report styles in `app/portal/portal.css` (`.lr-*`)

To restore tabs UI: copy `PortalContactDetailPage.tabs.tsx` over `../PortalContactDetailPage.tsx`.
