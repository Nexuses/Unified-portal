# Unified Portal API

Give this file to another AI as the source of truth for the app’s HTTP API.

Base URL (local): `http://localhost:3000`

This is a Next.js App Router app. Portal data is scoped to the logged-in user’s **project**. Drip campaigns and 1-1 campaigns are separate (`kind`: `"drip"` vs `"oneone"`). IDs for each kind start at `1` independently.

---

## Auth model

Two cookie-based sessions:

| Cookie | Used by | How it is set |
|--------|---------|---------------|
| `portal_user_session` | Portal APIs (campaigns, CRM, SMTP, `/api/auth/me`) | `POST /api/auth/login` |
| `portal_admin_session` | Admin UI session (`/api/auth/admin-me`) | `POST /api/auth/admin-login` |

Both cookies are httpOnly, `sameSite=lax`, 7-day lifetime.

Portal-protected routes return **401** `{ "error": "Not authenticated" }` if the cookie is missing/invalid.

Public (no cookie): tracking pixels, unsubscribe, public report links.

`/api/users` and `/api/projects` currently do **not** check a session in the route handler. They are meant for the admin UI.

Error shape (most routes): `{ "error": "message" }`.

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
  "listDisplayId": 1,
  "shareToken": "string",
  "sequences": [],
  "windowStart": "09:00",
  "windowEnd": "18:00",
  "emailGapMinutes": 5,
  "sequenceProgress": { "current": 1, "total": 2, "sent": 0, "contacts": 5 },
  "timeline": [{ "id": "string", "type": "draft|scheduled|sent", "title": "string", "description": "string", "at": "ISO" }]
}
```

On **create oneone**, server sets: one empty sequence, `windowStart: "09:00"`, `windowEnd: "18:00"`, `emailGapMinutes: 5`.

Campaign names are unique **per kind** inside a project.

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

### Email merge tags

HTML/subject supports:

- `{{ contact.FIRSTNAME }}`
- `{{ contact.LASTNAME }}`
- `{{ contact.EMAIL }}`
- `{{ contact.COMPANY }}`
- `{{ unsubscribe }}`

Aliases (`*|FNAME|*`, `{{first_name}}`, etc.) are normalized at send time. Unsubscribe is **not** auto-injected; only existing unsubscribe placeholders are replaced.

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
- Sending continues only while process-due is called (UI poll). If nobody has the page open, sends pause.

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
Portal session. 200 same user object as login.

### POST `/api/auth/admin-login`
Body: `{ "email", "password" }`  
200 `{ id, email, fullName }` + sets `portal_admin_session`

### POST `/api/auth/admin-logout`
200 `{ "success": true }`

### GET `/api/auth/admin-me`
Admin session. 200 `{ id, email, fullName }`

---

## Campaigns (portal session)

### GET `/api/campaigns?kind=drip|oneone`
`kind` optional. 200: `DripCampaign[]` (non-draft/paused merged with blast stats).

### POST `/api/campaigns`
```json
{ "name": "Welcome", "kind": "drip" }
```
`kind` defaults to `"drip"`.  
201: `DripCampaign`  
400 name required · 409 name already exists for that kind.

### GET `/api/campaigns/{id}?kind=drip|oneone`
200 `DripCampaign` · 404 `Campaign not found`

### PATCH `/api/campaigns/{id}?kind=drip|oneone`
Body: any subset of DripCampaign fields listed below.  
200 updated campaign.

Patchable keys: `name`, `status`, `scheduledAt`, `sentAt`, `tags`, `recipients`, `opens`, `clicks`, `unsubscribed`, `conversions`, `delivered`, `senderId`, `senderName`, `senderEmail`, `listId`, `listName`, `recipientMode`, `individualContacts`, `subject`, `previewText`, `hasDesign`, `designHtml`, `designSourceCampaignId`, `replyToEnabled`, `replyToEmail`, `attachmentEnabled`, `attachmentName`, `timezoneEnabled`, `timezone`, `listDisplayId`, `sequences`, `windowStart`, `windowEnd`, `emailGapMinutes`, `timeline`.

### DELETE `/api/campaigns/{id}?kind=drip|oneone`
200 `{ "ok": true }` — also deletes blasts and sends.

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
No body. 200 `{ "reports": CampaignReport[] }`  
Sends due pending emails for this project.

### GET `/api/campaigns/stats`
200 `{ "reports": CampaignReport[] }`

### GET `/api/campaigns/{id}/recipients?filter=audience&kind=oneone`
`filter`: `audience` | `delivered` | `opens` | `clicks` | `unsubscribes` (default `audience`)

200 array:
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
  "unsubscribedAt": "ISO"
}
```

### GET `/api/campaigns/{id}/export?kind=`
200 Excel file (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).

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
  "replyTo": "string"
}
```
200 `{ "sent": 1 }` — tracking tokens start with `test-` and are not counted in reports.

---

## Public / tracking (no auth)

### GET `/api/public/reports/{token}`
Public campaign report. Strips `senderId`, `individualContacts`, `designSourceCampaignId`.

### GET `/api/public/reports/{token}/recipients?filter=`
Same filters as portal recipients; `contactId` omitted.

### GET `/api/public/reports/{token}/export`
Excel download.

### GET `/api/campaigns/track/open/{token}`
Returns a 1×1 GIF. Increments open (ignored if token starts with `test-`).

### GET `/api/campaigns/track/click/{token}?u=https://example.com`
302 redirect to `u` (http/https only). Records click.

### POST `/api/unsubscribe/{token}`
200 `{ "email": "a@b.com", "alreadyUnsubscribed": false }`  
Marks contact unsubscribed/blocklisted, adds to Unsubscribe list, stamps the send.

---

## CRM (portal session, project-scoped)

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
    { "firstName": "Jane", "lastName": "Doe", "email": "jane@co.com", "companyName": "Co" }
  ],
  "importFileName": "export.csv"
}
```
201 `{ "list": CrmList, "importSummary": { "imported", "skipped", "companiesCreated", "contactsCreated", "contactsUpdated" } | null }`

### GET `/api/crm/lists/{id}`
`{ "list": CrmList, "contacts": Contact[] }`

### POST `/api/crm/lists/{id}`
Add more contacts: `{ "contacts": [ { "firstName", "lastName", "email", "companyName" } ] }`  
400 `No contacts to import`

### GET `/api/crm/suppression`
Unsubscribe list + entries `{ id, email, fullName, addedAt }`. Creates the Unsubscribe list if missing.

---

## SMTP senders (portal session)

Providers: `aws_ses` | `gmail` | `outlook` | `sendgrid` | `cloudflare` | `resend`

Create/update fields:
- aws_ses / gmail / outlook: `smtpHost`, `smtpUser`, `smtpPassword`, `smtpPort`, `fromEmail`
- sendgrid / resend: `apiKey`, `fromEmail`
- cloudflare: `cloudflareAccountId`, `cloudflareEmailApiToken`, `fromEmail`

Secrets are masked in responses.

### GET `/api/smtp/senders`
### POST `/api/smtp/senders` — 201 sender (runs DNS verification)
### PATCH `/api/smtp/senders/{id}`
### DELETE `/api/smtp/senders/{id}` — `{ "success": true }`
### POST `/api/smtp/senders/{id}/verify` — refresh DKIM/DMARC/SPF
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

---

## Route index

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/auth/login` | none |
| POST | `/api/auth/logout` | none |
| GET | `/api/auth/me` | portal |
| POST | `/api/auth/admin-login` | none |
| POST | `/api/auth/admin-logout` | none |
| GET | `/api/auth/admin-me` | admin |
| GET, POST | `/api/campaigns` | portal |
| GET, PATCH, DELETE | `/api/campaigns/[id]` | portal |
| POST | `/api/campaigns/launch` | portal |
| POST | `/api/campaigns/process-due` | portal |
| GET | `/api/campaigns/stats` | portal |
| POST | `/api/campaigns/test-email` | portal |
| GET | `/api/campaigns/[id]/recipients` | portal |
| GET | `/api/campaigns/[id]/export` | portal |
| POST | `/api/campaigns/[id]/share` | portal |
| GET | `/api/campaigns/track/open/[token]` | public |
| GET | `/api/campaigns/track/click/[token]` | public |
| GET | `/api/public/reports/[token]` | public |
| GET | `/api/public/reports/[token]/recipients` | public |
| GET | `/api/public/reports/[token]/export` | public |
| POST | `/api/unsubscribe/[token]` | public |
| GET | `/api/crm/contacts` | portal |
| GET | `/api/crm/contacts/[id]` | portal |
| GET | `/api/crm/companies` | portal |
| GET | `/api/crm/companies/[id]` | portal |
| GET, POST | `/api/crm/lists` | portal |
| GET, POST | `/api/crm/lists/[id]` | portal |
| GET | `/api/crm/suppression` | portal |
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

`users`, `projects`, `admins`, `drip_campaigns`, `campaign_blasts`, `campaign_sends`, `contacts`, `companies`, `lists`, `list_memberships`, `smtp_senders`

Portal queries always filter by `projectId` from the session.
