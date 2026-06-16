# Email Automation

A reusable starter for an **automated daily email** with a **signup landing page**. It
sends on a schedule (or on demand) to either yourself or a list of subscribers. The
**email content is pluggable** — it's read from a content file, so the body can be
anything (a post, a digest, a note) written by you or by another skill.

```
content file ─┐
              ├─▶ render ─▶ send ──▶ personal: your inbox
signups ──────┘                     domain:   every active subscriber (+ unsubscribe)
(landing page → Supabase)
```

The automation has **no AI dependency** — generating the content is a separate concern
(e.g. run a `/write-post` skill that writes `content.md`). This project just delivers it.

## Two modes — `EMAIL_AUDIENCE`

| Mode | Who receives it | Unsubscribe | Needs |
|------|-----------------|-------------|-------|
| **`personal`** (default) | Your **one** email — set on `/admin` (or `RESEND_TO`). Works on Resend's free sandbox sender, which only delivers to the account owner. | n/a | Resend key |
| **`domain`** | **Every active subscriber** collected via `/signup`, each with their own unsubscribe link. | yes (`/unsubscribe`) | A **Resend-verified domain** + `PUBLIC_BASE_URL` |

Both modes ship the same code, so a personal setup upgrades to domain later by flipping
`EMAIL_AUDIENCE` and verifying a domain — no re-scaffold.

## Content — the pluggable part

The email body is read from **`CONTENT_FILE`** (default `content.md`) at send time:

- **`content.md`** — markdown with optional frontmatter:
  ```markdown
  ---
  subject: This week's update
  title: Hello again
  ---
  Your **markdown** body here. Headings, lists, links, `code`, bold/italic.
  ```
- **`content.json`** — `{ "subject": "...", "title": "...", "html": "...", "text": "..." }`

To change what goes out, edit that file — or have another skill write it (e.g. run
`/write-post` and point it at `content.md`). The automation always sends the latest.

## Pages (web console — `app.js`)

| Page | What it's for |
|------|---------------|
| `/` | Dashboard. |
| `/signup` | Public signup form (Name, Email, optional Company, consent) → adds a subscriber. |
| `/admin` | Set the recipient (personal) or view subscribers (domain), check the content file, and **Send now**. |
| `/preview` | The email rendered from your content file (or a sample if none yet). |
| `/unsubscribe?token=…` | Public opt-out page (domain) — reachable without the console password. |

## Setup

1. **Install** — `npm install` (needs [Node.js](https://nodejs.org)).
2. **`.env`** — copy `.env.example` → `.env`; set `BRAND_NAME`, `EMAIL_AUDIENCE`, and the
   keys below.
3. **Supabase** — create a free project, open the SQL editor, paste **`schema.sql`**
   (creates `signups` + `settings`). Put the URL + `service_role` key in
   `SUPABASE_URL` / `SUPABASE_KEY`.
4. **Content** — edit `content.md` (or generate it with your content skill).
5. **Run the console** — `node serve.mjs` → **http://localhost:3000**.
   - **Personal:** `/admin` → save your recipient → **Send now** → check your inbox.
   - **Domain:** `/signup` to add a subscriber → **Send now** → the email carries an
     unsubscribe link → click it to verify opt-out.

CLI:
```bash
node index.js --no-send     # load content + print, don't email
node index.js               # send the current content to the audience
node scheduler.mjs --now    # run once now, then keep the daily schedule
```

## Schedule it

- **Local:** `node scheduler.mjs` (node-cron, `SEND_CRON` in `SEND_TZ`). In-process.
- **Cloud (pick ONE):** Vercel (`vercel.json` → `api/cron.js`) or Render (`render.yaml`).
  Cron is **UTC**, so 7 AM Manila = `0 23 * * *`. The cloud cron reads `CONTENT_FILE` from
  the deployed code — commit `content.md` (or point `CONTENT_FILE` at a runtime source).

## Environment variables

| Variable | What it is | Needed for |
|----------|-----------|------------|
| `BRAND_NAME` | Name shown in the email + console | always |
| `EMAIL_AUDIENCE` | `personal` (default) or `domain` | always |
| `CONTENT_FILE` | Path to the content file (`content.md`/`.json`) | always |
| `EMAIL_PROVIDER` | `resend` (default) or `gmail` | always |
| `RESEND_API_KEY` / `RESEND_FROM` / `RESEND_TO` | Resend config; `RESEND_TO` is the personal recipient + fallback | `EMAIL_PROVIDER=resend` |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Gmail SMTP | `EMAIL_PROVIDER=gmail` |
| `SUPABASE_URL` / `SUPABASE_KEY` | Supabase URL + `service_role` key | subscribers, recipient setting, unsubscribe |
| `PUBLIC_BASE_URL` | Deployed app URL — builds unsubscribe links | `domain` mode |
| `SEND_CRON` / `SEND_TZ` | Local schedule + timezone | scheduler |
| `CONSOLE_USER` / `CONSOLE_PASSWORD` | Login for the deployed console (blank = open) | deploy |
| `CRON_SECRET` | Secret the cron sends to `/api/cron` | deploy |

Secrets live in `.env` locally (git-ignored) and in the Vercel/Render dashboard when
deployed — never commit real keys.

## Project layout

| File | Role |
|------|------|
| `app.js` | Web console handler (pages + routes). No server — imported by the two below. |
| `serve.mjs` | Local server wrapper for `app.js`. |
| `api/index.js` / `api/cron.js` | Vercel console function / daily-send cron function. |
| `content.js` + `content.md` | Reads the content file → `{ subject, title, body }`. |
| `subscribers.js` | Supabase access: signups, recipient setting, subscribers, unsubscribe. |
| `email.js` + `email-template.js` | Resolves recipients and renders + sends the email. |
| `run.js` | Shared pipeline: content → send. |
| `index.js` | Command-line runner. |
| `scheduler.mjs` | Local daily scheduler (node-cron). |
| `schema.sql` | Supabase tables — paste once. |
| `vercel.json` / `render.yaml` | Deploy configs (pick one for the cron). |
