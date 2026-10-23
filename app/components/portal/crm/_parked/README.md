# Parked Lead Report contact UI

The live contact page uses the previous CRM tabs UI again.

Kept for a later cutover (do not delete):

- `PortalContactDetailPage.lead-report.tsx` — slim lead-report contact shell
- `../LeadReportOverview.tsx` — lead report layout
- `../../../../lib/apollo.ts`, `../../../../lib/lead-status.ts`
- `../../../../api/crm/contacts/[id]/apollo-enrich/`
- profile fields on contact API / `lib/crm.ts` / `lib/crm-contacts-server.ts`
- lead-report styles in `app/portal/portal.css` (`.lr-*`)

To wire it back: replace `../PortalContactDetailPage.tsx` with the lead-report version (and keep its import of `LeadReportOverview`).
