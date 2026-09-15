# Unified Portal API

**Give this file to another AI as the source of truth for the app’s HTTP API.**

| Environment | Base URL |
|-------------|----------|
| Production | `https://unified.nexuses.xyz` |
| Local | `http://localhost:3000` |

This is a Next.js App Router app. Portal data is scoped to the logged-in user’s **project**. Drip campaigns and 1-1 campaigns are separate (`kind`: `"drip"` vs `"oneone"`). Numeric IDs for each kind start at `1` independently — **always pass `?kind=`** on campaign id routes.

Error shape (most routes): `{ "error": "message" }`.

---

## Quick start for AI agents (API key)

1. Create a key in the portal **Integrations** UI, or via cookie session: `POST /api/integrations/keys` with `{ "name": "Bot" }`. Copy `rawKey` once (`up_live_…`).
2. Call portal APIs with:

```bash
curl -H "Authorization: Bearer up_live_…" \
  https://unified.nexuses.xyz/api/crm/contacts
```

3. Typical drip send flow:
   - `POST /api/campaigns` → `{ "name": "…", "kind": "drip" }`
   - `PATCH /api/campaigns/{id}?kind=drip` → sender, list/individuals, subject, `designHtml`
   - `POST /api/campaigns/launch` → `{ "campaign": {…full object…}, "mode": "now" }`
   - Poll `POST /api/campaigns/process-due` until sends finish (no server-side cron; sending only advances while this is called)

4. **Auto-detect new campaigns (Attio / CRM sync):**
   - Preferred: register a webhook (`POST /api/integrations/webhooks`) for `campaign.created`, `campaign.launched`, `send.opened`, `send.clicked`
   - Fallback poll: `GET /api/campaigns?updatedSince=ISO` (both kinds), then `GET /api/campaigns/{id}/recipients?filter=audience|opens|clicks&kind=`
   - Tracking links use `https://unified.nexuses.xyz` by default. Custom CNAMEs are only used after DNS **and** HTTPS checks pass (Cloudflare Error 1014 blocks many cross-account CNAMEs).

`GET /api/auth/me` is **cookie-only** — Bearer keys do **not** work there. Use CRM/campaigns/SMTP/automations/webhooks routes with the key instead.

---

## Auth model

| Auth | Used by | How it is set |
|------|---------|---------------|
| Cookie `portal_user_session` | Portal APIs via `requirePortalSession` | `POST /api/auth/login` |
| Cookie `portal_admin_session` | `GET /api/auth/admin-me` (+ `/admin/*` pages) | `POST /api/auth/admin-login` |
| Header `Authorization: Bearer up_live_…` | Same portal APIs as the user cookie (full **read + write** for that project) | `POST /api/integrations/keys` |

Cookies are httpOnly, `sameSite=lax`, 7-day lifetime (`secure` in production).

Portal-protected routes return **401** `{ "error": "Not authenticated" }` if neither a valid cookie nor a valid API key is present.

Public (no cookie / no key): tracking pixels, unsubscribe, public campaign reports (`/r/{token}`), public analytics reports (`/a/{token}`).

`/api/users` and `/api/projects` currently do **not** check a session in the route handler (admin UI only). Middleware does **not** protect `/api/*`.

There is **no** cron-secret auth. `process-due` requires a portal session or API key.

### API keys

- Managed under **Integrations** (`/portal/integrations`).
- Stored hashed in Mongo (`api_keys`). Raw key returned **once** on create.
- Scope is always full project access on routes that use `requirePortalSession`.
- Revoke: `DELETE /api/integrations/keys/{id}`.

---

## Core types

### CampaignKind
`"drip"` | `"oneone"`

- **drip** — one subject + one HTML design, sent once to the list/individuals.
- **oneone** — multiple **sequences**. Each contact gets sequence 1, then after `delayDays` (can be `0`) sequence 2, and so on. Sends only inside `windowStart`–`windowEnd` (HH:MM in campaign timezone). `emailGapMinutes` waits between consecutive emails.

### CampaignStatus
`"draft"` | `"scheduled"` | `"sending"` | `"sent"` | `"paused"`

### RecipientMode
`"list"` | `"individual"`

### CampaignSequence
```json
{
  "id": "seq-…",
  "delayDays": 0,
  "subject": "string",
  "previewText": "string",
  "hasDesign": true,
  "designHtml": "<html>…</html>",
  "designSourceCampaignId": "optional"
}
```

Sequence 1 always has `delayDays: 0`. Later sequences: `delayDays` is 0–365 (0 = same day, after the previous email, still honoring window + gap).

### CampaignSequenceProgress (1-1, after launch)
```json
{
  "current": 2,
  "total": 3,
  "sent": 4,
  "contacts": 5
}
```
`sent` / `contacts` = contacts sent on the **current** sequence.

### DripCampaign (used for both kinds)
```json
{
  "id": "1",
  "name": "string",
  "kind": "drip",
  "status": "draft",
  "scheduledAt": "string",
  "sentAt": "string",
  "tags": [],
  "recipients": 0,
  "opens": 0,
  "clicks": 0,
  "unsubscribed": 0,
  "conversions": 0,
  "delivered": 0,
  "senderId": "mongoObjectId",
  "senderName": "string",
  "senderEmail": "string",
  "listId": "mongoObjectId",
  "listName": "string",
  "recipientMode": "list",
  "individualContacts": [{ "id": "string", "email": "a@b.com", "fullName": "Name" }],
  "subject": "string",
  "previewText": "string",
  "hasDesign": true,
  "designHtml": "<html>…</html>",
  "designSourceCampaignId": "string",
  "replyToEnabled": false,
  "replyToEmail": "string",
  "attachmentEnabled": false,
  "attachmentName": "string",
  "timezoneEnabled": true,
  "timezone": "Asia/Kolkata",
  "utmEnabled": false,
  "utmSourceEnabled": true,
  "utmSource": "nexuses",
  "utmMediumEnabled": true,
  "utmMedium": "email",
  "utmCampaignEnabled": true,
  "utmCampaign": "[CAMPAIGN_NAME]",
  "listDisplayId": 1,
  "shareToken": "string",
  "sequences": [],
  "windowStart": "09:00",
  "windowEnd": "18:00",
  "emailGapMinutes": 5,
  "sequenceProgress": { "current": 1, "total": 2, "sent": 0, "contacts": 5 },
  "timeline": [{ "id": "string", "type": "draft|scheduled|sent", "title": "string", "description": "string", "at": "ISO" }],
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

On **create oneone**, server sets: one empty sequence, `windowStart: "09:00"`, `windowEnd: "18:00"`, `emailGapMinutes: 5`.

Campaign names are unique **per kind** inside a project.

Common tags: `"automation"`, `"automation-follow-up"` (campaigns created from Marketing Automation).

### CampaignReport (launch / stats / process-due)
```json
{
  "campaignId": "1",
  "kind": "oneone",
  "name": "string",
  "subject": "string",
  "senderName": "string",
  "senderEmail": "string",
  "replyTo": "string",
  "html": "<html>…</html>",
  "status": "scheduled|sending|sent",
  "timezone": "Asia/Kolkata",
  "scheduledFor": "ISO",
  "sentAt": "ISO",
  "recipients": 5,
  "delivered": 3,
  "opens": 1,
  "clicks": 0,
  "unsubscribed": 0,
  "conversions": 0,
  "listId": "string",
  "listName": "string",
  "listDisplayId": 1,
  "timeline": [],
  "sequenceProgress": { "current": 1, "total": 2, "sent": 3, "contacts": 5 }
}
```

### CampaignSendRecipient
```json
{
  "id": "sendId",
  "email": "a@b.com",
  "fullName": "Name",
  "companyName": "",
  "contactId": "optional",
  "status": "pending|sending|sent|failed",
  "sentAt": "ISO",
  "openedAt": "ISO",
  "clickedAt": "ISO",
  "clickedUrl": "https://…",
  "unsubscribedAt": "ISO",
  "sequenceIndex": 0,
  "sequenceNumber": 1
}
```

### PortalAutomation
```json
{
  "id": "mongoObjectId",
  "name": "Untitled automation",
  "kind": "drip",
  "status": "draft",
  "steps": [
    {
      "id": "step-…",
      "type": "email",
      "campaignId": "1",
      "campaignKind": "drip",
      "waitDays": 0,
      "waitHours": 1,
      "whoSource": "current",
      "pastCampaignId": "optional",
      "pastCampaignKind": "drip",
      "pastCampaignName": "optional",
      "engagement": "opens"
    }
  ],
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

`status`: `"draft"` | `"scheduled"` | `"running"` | `"completed"`  
`whoSource`: `"current"` | `"past"`  
On Email 1, `whoSource: "past"` links an already-sent campaign (`campaignId` + `pastCampaignId`). That blast is **not resent**; follow-ups wait, then go to its openers/clickers.  
`engagement`: `"opens"` | `"clicks"` | `"opens_or_clicks"`  
Follow-up waits: **days may be 0**; **hours minimum 1**.

### Email merge tags

HTML/subject supports:

- `{{ contact.FIRSTNAME }}`
- `{{ contact.LASTNAME }}`
- `{{ contact.EMAIL }}`
- `{{ contact.COMPANY }}`
- `{{ unsubscribe }}`

Aliases (`*|FNAME|*`, `{{first_name}}`, etc.) are normalized at send time. Unsubscribe placeholders are replaced with a real link; if none exist, an unsubscribe footer is appended automatically.

Max **10** individual contacts per campaign (`MAX_INDIVIDUAL_CONTACTS`). Plan email cap is 50_000 (`EMAIL_PLAN_LIMIT`).

---

## Typical campaign flow

1. `POST /api/campaigns` with `{ name, kind }` → draft.
2. `PATCH /api/campaigns/{id}?kind=` with sender, list or individuals, subject/design (or sequences for 1-1).
3. `POST /api/campaigns/launch` with `{ campaign, mode: "now"|"later", scheduledFor? }`.
4. Client polls `POST /api/campaigns/process-due` (about every 3s while the list/report page is open) to send remaining emails.
5. `GET /api/campaigns/stats` or `GET /api/campaigns/{id}?kind=` for live counts.
6. Optional: `POST /api/campaigns/{id}/share?kind=` for a public report URL `/r/{token}`.

**1-1 send rules**

- One send row per contact per sequence.
- Sequence 1 `availableAt` = now or `scheduledFor`. Later sequences stay locked until the previous send, then `sentAt + delayDays`.
- Outside daily window → skip until next poll.
- `emailGapMinutes > 0` → at most one email per poll.
- Sending continues only while process-due is called (UI poll or API client). If nobody calls it, sends pause.

Always pass `?kind=oneone` or `?kind=drip` on campaign id routes so drip #1 and 1-1 #1 are not mixed up.

---

## Auth

### POST `/api/auth/login`
Body: `{ "email": "string", "password": "string" }`  
200: `{ id, fullName, email, projectId, projectName }` + sets `portal_user_session`  
400 `Email and password are required` · 401 `Invalid email or password`

### POST `/api/auth/logout`
200 `{ "success": true }` — clears portal cookie.

### GET `/api/auth/me`
**Cookie only** (not Bearer). 200 same user object as login. 401 `Not authenticated`.

### POST `/api/auth/admin-login`
Body: `{ "email", "password" }`  
200 `{ id, email, fullName }` + sets `portal_admin_session`

### POST `/api/auth/admin-logout`
200 `{ "success": true }`

### GET `/api/auth/admin-me`
Admin session cookie. 200 `{ id, email, fullName }`

---

## Campaigns (portal session or Bearer)

### GET `/api/campaigns?kind=drip|oneone&updatedSince=2026-09-09T00:00:00.000Z`
`kind` optional. `updatedSince` optional ISO timestamp — only campaigns with `updatedAt >= updatedSince`.  
200: `DripCampaign[]` (includes `createdAt` / `updatedAt`; non-draft/paused merged with blast stats).  
400 if `updatedSince` is not a valid date.

### POST `/api/campaigns`
```json
{ "name": "Welcome", "kind": "drip", "autoNumber": true }
```
`kind` defaults to `"drip"`. Pass `"autoNumber": true` to automatically append/increment a numeric suffix if a campaign with the requested name already exists.  
201: `DripCampaign`  
400 name required · 409 name already exists for that kind (if `autoNumber` not set).

### GET `/api/campaigns/{id}?kind=drip|oneone`
200 `DripCampaign` · 404 `Campaign not found`

### PATCH `/api/campaigns/{id}?kind=drip|oneone`
Body: any subset of patchable keys.  
200 updated campaign.

Patchable keys: `name`, `status`, `scheduledAt`, `sentAt`, `tags`, `recipients`, `opens`, `clicks`, `unsubscribed`, `conversions`, `delivered`, `senderId`, `senderName`, `senderEmail`, `listId`, `listName`, `recipientMode`, `individualContacts`, `subject`, `previewText`, `hasDesign`, `designHtml`, `designSourceCampaignId`, `replyToEnabled`, `replyToEmail`, `attachmentEnabled`, `attachmentName`, `timezoneEnabled`, `timezone`, `utmEnabled`, `utmSourceEnabled`, `utmSource`, `utmMediumEnabled`, `utmMedium`, `utmCampaignEnabled`, `utmCampaign`, `listDisplayId`, `sequences`, `windowStart`, `windowEnd`, `emailGapMinutes`, `timeline`.

Pause/resume via `status`: only `scheduled`/`sending` → `paused`; resume needs a paused send. Errors like `Only running or scheduled campaigns can be paused` / `No paused send found to resume`.

### DELETE `/api/campaigns?kind=drip|oneone`
Body: `{ "ids": ["1", "2"] }`. Deletes those campaigns plus their blasts and sends.  
200 `{ "deleted": number }` · 400 `No campaigns selected`

### DELETE `/api/campaigns/{id}?kind=drip|oneone`
200 `{ "ok": true }` — also deletes blasts and sends.

### POST `/api/campaigns/{id}/duplicate?kind=drip|oneone`
Creates a new **draft** copy (name `Copy of …`), keeps sender/list/design/sequences, resets stats and launch state.  
201: `DripCampaign`

---

### POST `/api/campaigns/launch`
```json
{
  "campaign": { "id": "1", "name": "…", "kind": "oneone", "…full campaign object…" },
  "mode": "now",
  "scheduledFor": "2026-09-05T09:30:00.000Z"
}
```
`scheduledFor` required when `mode` is `"later"` (must be in the future).

200: `CampaignReport`

Deletes previous blasts/sends for that campaign+kind, then creates new ones.

400 examples:
- `Campaign is required.`
- `Choose send now or schedule.`
- `Select a sender first.`
- `Add a subject line first.` / `Save an email design first.` (drip)
- `Add a subject and design for every sequence first.` (oneone)
- `This campaign has no recipients to send to.`
- `Pick a valid schedule date and time.` / `Schedule time must be in the future.`

**Launch drip now (minimal):**
```json
{
  "campaign": {
    "id": "1",
    "name": "Welcome",
    "kind": "drip",
    "status": "draft",
    "tags": [],
    "recipients": 0,
    "opens": 0,
    "clicks": 0,
    "unsubscribed": 0,
    "conversions": 0,
    "senderId": "674abc…",
    "senderEmail": "from@acme.com",
    "listId": "674def…",
    "recipientMode": "list",
    "subject": "Hello",
    "hasDesign": true,
    "designHtml": "<p>Hi {{ contact.FIRSTNAME }}</p>",
    "timezone": "Asia/Kolkata"
  },
  "mode": "now"
}
```

**PATCH oneone sequences (before launch):**
```json
{
  "senderId": "674abc…",
  "senderEmail": "sales@acme.com",
  "recipientMode": "list",
  "listId": "674def…",
  "timezone": "Asia/Kolkata",
  "windowStart": "09:00",
  "windowEnd": "18:00",
  "emailGapMinutes": 5,
  "sequences": [
    {
      "id": "seq-1",
      "delayDays": 0,
      "subject": "Intro",
      "hasDesign": true,
      "designHtml": "<p>Hi {{ contact.FIRSTNAME }}</p>"
    },
    {
      "id": "seq-2",
      "delayDays": 0,
      "subject": "Same day follow up",
      "hasDesign": true,
      "designHtml": "<p>Following up</p>"
    }
  ]
}
```

---

### POST `/api/campaigns/process-due`
No body. 200 `{ "reports": CampaignReport[], "followUps": { "launched": number } }`  
Sends due pending emails for this project, then launches due **automation follow-up** campaigns (after the step wait, to openers/clickers). **Must be polled** — no background cron.

### GET `/api/campaigns/stats`
200 `{ "reports": CampaignReport[] }`

### GET `/api/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD`
Project-wide dashboard for emails **sent** in the range (UTC days). Unique delivered / opens / clicks / unsubscribes, drip vs 1-1 split, daily series, campaign table, plus contacts and automations created in range. Defaults to last 30 days if `from`/`to` omitted.

200 `AnalyticsDashboard`

### GET `/api/analytics/kanban`
Saved kanban lists for this project (name + selected campaigns). Oldest per-campaign boards without a name are ignored.

200 `KanbanList[]`

### POST `/api/analytics/kanban`
```json
{ "name": "Q3 outreach", "campaigns": [{ "campaignId": "23", "kind": "drip", "name": "Launch" }] }
```
Create a list from one or more **sent or running** Drip and/or 1-1 campaigns. People are merged by email; opens/clicks are OR’d. Delivered start in **Prospect**, opens in **Engage**, clicks in **Cold**.

201 `KanbanBoard`

### GET `/api/analytics/kanban/{id}`
200 `KanbanBoard` — `{ id, name, campaigns, stages, placements, people }`

### PATCH `/api/analytics/kanban/{id}`
```json
{ "stages": [], "placements": { "a@b.com": "stage-id" }, "campaigns": [] }
```
System stages Prospect / Engage / Cold are always kept (dots: blue / orange / purple). Custom stages can be added with a `color` from the fixed palette. `campaigns` replaces the selected sent/running campaigns.

### POST `/api/analytics/kanban/{id}/chat`
```json
{ "message": "Move Jane to Engage", "history": [] }
```
Board assistant. Can create a stage or move people. Returns `{ "reply": "string", "board": KanbanBoard }`.

### DELETE `/api/analytics/kanban/{id}`
200 `{ "ok": true }`

### POST `/api/analytics/share`
Body `{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }`. Creates (or reuses a still-valid) public link for that exact range. Links **expire after 30 days**.

200 `{ "token": "string", "url": "https://host/a/{token}", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "expiresAt": "ISO" }`

### GET `/api/campaigns/{id}/recipients?filter=audience&kind=oneone`
`filter`: `audience` | `delivered` | `opens` | `clicks` | `unsubscribes` (default `audience`)

200: `CampaignSendRecipient[]` (includes `sequenceIndex` / `sequenceNumber` for 1-1).

### GET `/api/campaigns/{id}/export?kind=`
200 Excel workbook (`.xlsx`): sheets `Sent, Open, Click`, `Bounces & Unsubscribes`, and `Summary`.

### POST `/api/campaigns/{id}/share?kind=`
No body. 200 `{ "token": "string", "url": "https://host/r/{token}" }`

### POST `/api/campaigns/test-email`
```json
{
  "senderId": "required",
  "to": ["you@example.com"],
  "subject": "string",
  "html": "<html>…</html>",
  "fromName": "string",
  "replyTo": "string",
  "campaignName": "string",
  "utmEnabled": false,
  "utmSourceEnabled": true,
  "utmSource": "nexuses",
  "utmMediumEnabled": true,
  "utmMedium": "email",
  "utmCampaignEnabled": true,
  "utmCampaign": "[CAMPAIGN_NAME]"
}
```
200 `{ "sent": 1 }` — tracking tokens start with `test-` and are not counted in reports.

---

## Automations (portal session or Bearer)

UI: `/portal/marketing/automation` (new blank canvas; **no DB row until first email step**). Edit via `/portal/marketing/automation/{id}` or History.

Email steps are set up in Drip/1-1 with `?fromAutomation=1`, then return to Automation. Launch/schedule happens on the Automation canvas (not in Drip while linked). After launch, builder is read-only.

### GET `/api/automations`
200: `PortalAutomation[]`

### POST `/api/automations`
```json
{
  "name": "Untitled automation",
  "kind": "drip",
  "status": "draft",
  "steps": []
}
```
Defaults: name `"Untitled automation"`, kind `drip`, status `draft`, steps `[]`.  
201: `PortalAutomation`

### GET `/api/automations/{id}`
200 `PortalAutomation` · 404 `Not found`

### PATCH `/api/automations/{id}`
Body: `{ "name"?, "kind"?, "steps"?, "status"? }`  
200 updated · 400 `Automation name is required` / `Invalid steps` · 404

### DELETE `/api/automations/{id}`
200 `{ "ok": true }` · 404 `Not found`

### POST `/api/automation/chat`
```json
{
  "message": "Build a 3-step follow-up sequence",
  "history": [{ "role": "user", "content": "…" }],
  "context": { "kind": "drip", "campaignName": "Untitled", "stepCount": 1 }
}
```
200 `{ "reply": "…" }`  
Requires `DEEPSEEK_API_KEY` (503 if missing). No DB writes.

---

## Public / tracking (no auth)

### GET `/api/public/reports/{token}`
Public campaign report. Strips `senderId`, `individualContacts`, `designSourceCampaignId`.

### GET `/api/public/analytics/{token}`
Public analytics dashboard for the date range stored on the share. Same payload as `GET /api/analytics`, plus `shareToken` on each campaign row. Page: `/a/{token}`. Campaign names link to `/r/{shareToken}?a={analyticsToken}` so clients can open the full campaign report and return to the dashboard. **404 / expired page** after 30 days.

### GET `/api/public/reports/{token}/recipients?filter=`
Same filters as portal recipients; `contactId` omitted.

### GET `/api/public/reports/{token}/export`
Excel (`.xlsx`) — same workbook as portal export.

### GET `/api/campaigns/track/open/{token}`
Returns a 1×1 GIF. Increments open (ignored if token starts with `test-`, or if the email was sent less than **45 seconds** ago — bot filter).

### GET `/api/campaigns/track/click/{token}?u=https://example.com`
302 redirect to `u` (http/https only). Records click with bot filters (redirect still happens):
- same **45s** post-send grace
- clicks closer than **2s** are ignored
- **2+ different URLs within 5s** (or 3+ clicks in 5s) = burst scan → click stats cleared for that recipient

If the campaign has **UTM tracking** on, `u` already includes `utm_source` / `utm_medium` / `utm_campaign` (destination is still wrapped as `/t/c/{token}?u=…`). `[CAMPAIGN_NAME]` is replaced with the campaign name.

### POST `/api/unsubscribe/{token}`
200 `{ "email": "a@b.com", "alreadyUnsubscribed": false }`  
Marks contact unsubscribed/blocklisted, adds to Unsubscribe list, stamps the send.

---

## CRM (portal session or Bearer, project-scoped)

### GET `/api/crm/contacts`
`Contact[]`: `{ id, firstName, lastName, fullName, email, companyId, companyName, subscribed, blocklisted, createdAt, updatedAt }`

### GET `/api/crm/contacts/{id}`
Mongo ObjectId. `ContactDetail`: contact + `owner`, `company`, `lists[]`, `history[]`, `campaignStats`, `navigation`.  
400 invalid id · 404 not found.

### GET `/api/crm/companies`
Companies with nested contacts.

### GET `/api/crm/companies/{id}`
`{ company, history, navigation }`

### GET `/api/crm/lists`
`{ id, name, displayId, contactCount, createdAt, importFileName? }[]`

### POST `/api/crm/lists`
```json
{
  "name": "Newsletter",
  "contacts": [
    {
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "jane@co.com",
      "companyName": "Co",
      "attributes": {
        "position": "Founder",
        "industry": "SaaS",
        "website": "https://co.com",
        "companySourceUrl": "https://linkedin.com/company/co",
        "personalLinkedIn": "https://linkedin.com/in/jane",
        "contactSourceUrl": "https://co.com/jane",
        "personLocation": "Austin, TX"
      }
    }
  ],
  "importFileName": "export.csv"
}
```
Rows need **firstName**, **email**, and **companyName**. Extra fields go in `attributes`.  
201 `{ "list": CrmList, "importSummary": { "imported", "skipped", "companiesCreated", "contactsCreated", "contactsUpdated" } | null }`

### DELETE `/api/crm/lists`
Body: `{ "ids": ["…"] }`. Deletes those lists and their memberships. Contacts stay in CRM. The Unsubscribe list is skipped.  
200 `{ "deleted": number }` · 400 `No lists selected`

### GET `/api/crm/lists/{id}`
`{ "list": CrmList, "contacts": Contact[] }`

### POST `/api/crm/lists/{id}`
Add more contacts: `{ "contacts": [ { "firstName", "lastName", "email", "companyName", "attributes?" } ] }`  
400 `No contacts to import`

### DELETE `/api/crm/lists/{id}`
Deletes one list and its memberships. Contacts stay in CRM.  
404 if missing or the Unsubscribe list.

### GET `/api/crm/suppression`
Unsubscribe list + email entries `{ id, email, fullName, addedAt }` and blocked domains `{ id, domain, addedAt }`. Creates the Unsubscribe list if missing.

### POST `/api/crm/suppression`
Bulk-add emails or domains. Body: `{ "kind": "email"|"domain", "text": "one per line, CSV, or comma-separated" }`.  
200 `{ "kind", "added", "skipped", "total" }`.  
Uploaded emails join the Unsubscribe list and are skipped on send. Uploaded domains skip every recipient at that domain.

### DELETE `/api/crm/suppression`
Body: `{ "kind": "email"|"domain", "id": "…" }`.  
Removes an email from the unsubscribe list (and unblocks the contact) or a blocked domain.

---

## Integrations / API keys (portal session or Bearer)

Full project **read + write** access for external integrations.

### GET `/api/integrations/keys`
`{ "keys": [ { id, name, keyPrefix, keyLast4, hint, scopes, lastUsedAt?, createdAt } ] }`

### POST `/api/integrations/keys`
Body: `{ "name": "Zapier" }` (≤80 chars)  
201:
```json
{
  "key": { "id": "…", "name": "Zapier", "hint": "up_live_••••abcd", "scopes": ["read", "write"], "createdAt": "…" },
  "rawKey": "up_live_…",
  "warning": "Copy this API key now. You will not be able to see it again."
}
```

### DELETE `/api/integrations/keys/{id}`
`{ "ok": true }` — revokes immediately.

Use: `Authorization: Bearer up_live_…` on any `requirePortalSession` route.

---

## Webhooks (portal session or Bearer)

Push events to your HTTPS endpoint so external tools (e.g. Attio sync) can react without polling a single campaign name.

### Events

| Event | When |
|-------|------|
| `campaign.created` | `POST /api/campaigns` succeeds |
| `campaign.launched` | `POST /api/campaigns/launch` succeeds |
| `send.opened` | First open recorded for a send (tracking pixel) |
| `send.clicked` | First click recorded for a send |

### Delivery

- Method: `POST` to your `url`
- Headers:
  - `Content-Type: application/json`
  - `X-Unified-Event: campaign.created`
  - `X-Unified-Signature: sha256=<hmac-sha256-hex of raw body using the webhook secret>`
  - `User-Agent: Unified-Portal-Webhooks/1.0`
- Body:
```json
{
  "id": "evt_…",
  "type": "campaign.created",
  "createdAt": "ISO",
  "projectId": "mongoObjectId",
  "data": {
    "campaignId": "1",
    "kind": "drip",
    "name": "Welcome",
    "status": "draft",
    "createdAt": "ISO"
  }
}
```

`campaign.launched` `data` includes `mode`, `status`, `recipients`, `scheduledFor?`.  
`send.opened` / `send.clicked` `data` includes `email`, `fullName`, `sendId`, `sequenceIndex?`, and `url?` on click.

Verify signature: HMAC-SHA256(secret, rawBody) hex, compare to the value after `sha256=`.

### GET `/api/integrations/webhooks`
`{ "webhooks": [ { id, url, events, secretHint, enabled, createdAt, updatedAt, lastDeliveredAt?, lastStatus? } ], "events": ["campaign.created", …] }`

### POST `/api/integrations/webhooks`
```json
{
  "url": "https://your-app.example/hooks/unified",
  "events": ["campaign.created", "campaign.launched", "send.opened", "send.clicked"]
}
```
`events` optional — defaults to all.  
201:
```json
{
  "webhook": { "id": "…", "url": "…", "events": ["…"], "secretHint": "whsec_••••abcd", "enabled": true, "createdAt": "…" },
  "secret": "whsec_…",
  "warning": "Copy this webhook signing secret now. You will not be able to see it again."
}
```

### DELETE `/api/integrations/webhooks/{id}`
`{ "ok": true }` — revokes immediately.

---

## SMTP senders (portal session or Bearer)

Providers: `aws_ses` | `gmail` | `outlook` | `sendgrid` | `cloudflare` | `resend`

Create/update fields:
- aws_ses / gmail / outlook: `smtpHost`, `smtpUser`, `smtpPassword`, `smtpPort`, `fromEmail`
- sendgrid / resend: `apiKey`, `fromEmail`
- cloudflare: `cloudflareAccountId`, `cloudflareEmailApiToken`, `fromEmail`

Secrets are masked in responses. Default tracking host: `unified.nexuses.xyz`.

### GET `/api/smtp/senders`
### POST `/api/smtp/senders` — 201 sender (runs DNS verification unless `noInbox: true`)
### PATCH `/api/smtp/senders/{id}`
### DELETE `/api/smtp/senders/{id}` — `{ "success": true }`
### POST `/api/smtp/senders/{id}/verify` — refresh DKIM/DMARC/SPF (skipped when `noInbox`)
### POST `/api/smtp/senders/{id}/tracking` — body `{ "trackingDomain": "track.example.com" }` → `{ sender, records[] }`
### POST `/api/smtp/senders/{id}/tracking/verify`

409 if the same sender is already configured for that provider.

---

## Admin users & projects (no session check in these handlers)

### GET `/api/users`
`{ id, fullName, email, projectId, projectName }[]`

### POST `/api/users`
Required: `{ fullName, email, password, projectId }`  
409 email taken · 404 project not found.

### PUT `/api/users/{id}`
Required: `{ fullName, email, projectId }`. `password` optional.

### DELETE `/api/users/{id}`
`{ "success": true }`

### GET `/api/projects`
`{ id, name, slug, logoUrl, users }[]`

### POST `/api/projects`
`{ "name": "required", "logoUrl": "", "slug": "optional-auto" }`

### PUT `/api/projects/{id}`
Same fields as create.

### DELETE `/api/projects/{id}`
Deletes the project, its users, CRM data, and SMTP senders.  
Does **not** delete `drip_campaigns`, `campaign_blasts`, `campaign_sends`, `api_keys`, or `automations`.

---

## Route index

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/auth/login` | none |
| POST | `/api/auth/logout` | none |
| GET | `/api/auth/me` | portal **cookie only** |
| POST | `/api/auth/admin-login` | none |
| POST | `/api/auth/admin-logout` | none |
| GET | `/api/auth/admin-me` | admin cookie |
| GET, POST, DELETE | `/api/campaigns` | portal (cookie or Bearer) |
| GET, PATCH, DELETE | `/api/campaigns/[id]` | portal |
| POST | `/api/campaigns/[id]/duplicate` | portal |
| POST | `/api/campaigns/launch` | portal |
| POST | `/api/campaigns/process-due` | portal |
| GET | `/api/campaigns/stats` | portal |
| GET | `/api/analytics` | portal |
| GET, POST | `/api/analytics/kanban` | portal |
| GET, PATCH, DELETE | `/api/analytics/kanban/[id]` | portal |
| POST | `/api/analytics/kanban/[id]/chat` | portal |
| POST | `/api/analytics/share` | portal |
| POST | `/api/campaigns/test-email` | portal |
| GET | `/api/campaigns/[id]/recipients` | portal |
| GET | `/api/campaigns/[id]/export` | portal |
| POST | `/api/campaigns/[id]/share` | portal |
| GET | `/api/campaigns/track/open/[token]` | public |
| GET | `/api/campaigns/track/click/[token]` | public |
| GET, POST | `/api/automations` | portal |
| GET, PATCH, DELETE | `/api/automations/[id]` | portal |
| POST | `/api/automation/chat` | portal |
| GET | `/api/public/reports/[token]` | public |
| GET | `/api/public/reports/[token]/recipients` | public |
| GET | `/api/public/reports/[token]/export` | public |
| GET | `/api/public/analytics/[token]` | public |
| POST | `/api/unsubscribe/[token]` | public |
| GET | `/api/crm/contacts` | portal |
| GET | `/api/crm/contacts/[id]` | portal |
| GET | `/api/crm/companies` | portal |
| GET | `/api/crm/companies/[id]` | portal |
| GET, POST, DELETE | `/api/crm/lists` | portal |
| GET, POST, DELETE | `/api/crm/lists/[id]` | portal |
| GET, POST, DELETE | `/api/crm/suppression` | portal |
| GET, POST | `/api/integrations/keys` | portal |
| DELETE | `/api/integrations/keys/[id]` | portal |
| GET, POST | `/api/integrations/webhooks` | portal |
| DELETE | `/api/integrations/webhooks/[id]` | portal |
| GET, POST | `/api/smtp/senders` | portal |
| PATCH, DELETE | `/api/smtp/senders/[id]` | portal |
| POST | `/api/smtp/senders/[id]/verify` | portal |
| POST | `/api/smtp/senders/[id]/tracking` | portal |
| POST | `/api/smtp/senders/[id]/tracking/verify` | portal |
| GET, POST | `/api/users` | none in handler |
| PUT, DELETE | `/api/users/[id]` | none in handler |
| GET, POST | `/api/projects` | none in handler |
| PUT, DELETE | `/api/projects/[id]` | none in handler |

---

## Mongo collections (for context)

`users`, `projects`, `admins`, `drip_campaigns`, `campaign_blasts`, `campaign_sends`, `contacts`, `companies`, `lists`, `list_memberships`, `smtp_senders`, `api_keys`, `automations`, `webhooks`, `suppression_entries`, `analytics_shares`, `analytics_kanban`

Portal queries always filter by `projectId` from the session (cookie or API key).
