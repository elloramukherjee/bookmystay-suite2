# Operations runbook

For whoever runs BookMyStay day to day. Commands assume Docker Compose (`deploy/`). On Render or Railway, run them in the
service shell from `/app/server`.

## Health at a glance

| Check | Where |
|---|---|
| Is it up? | `GET /api/v1/health` → `{ status: "ok", db: "connected", transactions: true }`. 503 means the database is unreachable. |
| What's configured? | `node dist/scripts/preflight.js`: database, AI, WhatsApp, SMS/email, payments. No secret values are printed. |
| Messages | Hotel Settings → **Guest messaging**: WhatsApp mode, 7-day counts per channel, failures, guests to call. |
| Guests to call | Dashboard card "N guests to call". A booking also shows a "needs attention" note. |
| Logs | JSON (pino). Each request has a `requestId`, also returned in every error response, so search for the id a user reports. Phones, emails, names and tokens are redacted. |

## Routine

**Daily (front desk / owner)**
- Dashboard: clear "guests to call" (call, then **Mark called**).
- Concierge Desk: resolve escalated chats and open service requests.
- Bookings: anything with a ⚠ "needs attention" note (late payments, refunds due, undelivered confirmations).
- Pay-at-hotel: yesterday's arrivals who never came → **Mark no-show** so the rooms can be resold. Collect payment at check-out (the desk won't check out an unpaid stay without ticking "payment collected").

**Weekly (operator)**
- Guest messaging panel: repeated WhatsApp failures (expired token, template rejected).
- Confirm last night's backup exists and its size looks right (below).
- Glance at error-level logs.

**Monthly**
- `npm audit` on the deployed commit. Apply patch updates.
- Restore test: restore the latest backup into a scratch database and run preflight against it.

## Backups and restore

**Policy:** daily full backup, 14 daily + 8 weekly copies kept, stored **off the VM** (another region or bucket),
encrypted at rest. Restore is tested monthly. Recovery point objective: 24 h. Recovery time objective: 2 h.

- **Atlas:** enable Cloud Backup (continuous / point-in-time on M10+). Restores are done in the Atlas UI. Nothing else needed.
- **Docker Compose (self-hosted MongoDB):** add this to the VM's crontab:

  ```bash
  # 02:30 IST daily: compressed archive of the bookmystay database
  30 21 * * * cd /opt/bookmystay && docker compose -f deploy/docker-compose.yml exec -T mongo \
    mongodump --db bookmystay --archive --gzip > /var/backups/bookmystay/$(date +\%F).archive.gz \
    && find /var/backups/bookmystay -name '*.archive.gz' -mtime +14 -delete
  ```

  Copy `/var/backups/bookmystay` off the box (e.g. `rclone` to object storage) after each run.

- **Restore** (overwrites the database; stop the app first so no writes are lost or mixed):

  ```bash
  docker compose -f deploy/docker-compose.yml stop app
  docker compose -f deploy/docker-compose.yml exec -T mongo mongorestore --drop --archive --gzip < 2026-11-24.archive.gz
  docker compose -f deploy/docker-compose.yml start app
  ```

Audit logs expire after 400 days (TTL index). Everything else is kept until deleted.

## Common incidents

| Symptom | Likely cause | What to do |
|---|---|---|
| Health 503 / `db: "disconnected"` | Atlas IP list, credentials, or mongo container down | Check the Atlas access list or `docker compose ps`. The app reconnects automatically. |
| All chats go to staff with "A member of our team will reply" | Gemini key missing, quota, or Google outage (common 503s) | Preflight shows AI status. Set `GEMINI_FALLBACK_MODEL`. Staff can answer from the Concierge Desk meanwhile. |
| WhatsApp messages not arriving | Token expired (code 190), webhook unsubscribed, number not linked | Guest messaging panel shows the error. Regenerate the system-user token, re-verify the webhook (`docs/WHATSAPP-SETUP.md`). Pending messages retry automatically. |
| Confirmations show "guests to call" | Outside WhatsApp's 24-hour window without an approved template, and no SMS/email in this version | Call the guest. Long-term, map approved templates in `WHATSAPP_TEMPLATES`. |
| Guest paid but booking says pending | Razorpay webhook not reaching us | Razorpay dashboard → Webhooks → delivery log. The URL must be `https://<domain>/api/v1/payments/webhook`, with the secret matching `PAYMENT_WEBHOOK_SECRET`. Redelivery is safe (idempotent). |
| "Room was just taken" at check-in | Two desks assigned the same room | Expected protection. Pick another room. |
| Guest booked but never arrived | Common with pay-at-hotel | Check-in station → open the arrival → **Didn't arrive?**, or Bookings → booking → **Mark no-show**. Tonight's room goes back on sale. |
| Guest says "can't book, too many bookings" | Pay-at-hotel cap: 3 upcoming unpaid bookings per phone | Genuine group or family: book the extra rooms from Bookings → Add booking (staff bookings aren't capped). |
| Staff member forgot password | — | Owner: Staff → **Reset password**, then share it in person. Their other sessions end. |
| Owner forgot password / locked out | No email reset in this version | Lockout clears after 15 minutes. For a forgotten owner password, platform support resets it from a server shell (below). |
| Desk shows "You're offline — N actions saved" | Wi-Fi drop | Actions sync automatically when the connection returns (or press **Sync now**). Anything another person already changed is reported, not applied twice. |

**Owner password reset by platform support** (server shell; inputs via environment variables so they stay out of shell history):

```bash
ADMIN_EMAIL=owner@hotel.in ADMIN_PASSWORD='<temporary password>' node dist/scripts/admin.js reset-password
```

This signs out all their sessions and clears any lockout. They should change the password after signing in
(account menu → Change password).

## Onboard a property

The seed is for development only and refuses production. For a new property:

1. Platform support creates the property and its owner:

   ```bash
   ADMIN_HOTEL_NAME="Heritage Courtyard" ADMIN_HOTEL_SLUG=heritage-courtyard ADMIN_CITY=Jaipur ADMIN_STATE=Rajasthan \
   ADMIN_TOTAL_ROOMS=12 ADMIN_OWNER_NAME="Vikramaditya Singh" ADMIN_OWNER_EMAIL=owner@hotel.in ADMIN_PASSWORD='<temporary>' \
     node dist/scripts/admin.js create-property
   ```
2. The owner signs in, changes their password (account menu), fills in Hotel Settings (contact numbers, check-in
   times, GSTIN), adds room types, rooms and rates, then adds staff (Staff → Add team member).
3. Run preflight, then make a test booking.

## Data protection requests (DPDP Act 2023)

- **Withdraw marketing consent:** the guest replies STOP on WhatsApp, or staff use the guest profile → "Record withdrawal".
- **Access / export:** from the guest profile (Guests → search by phone), copy their profile, history and bookings. Send them
  to the verified phone or email.
- **Erasure:** bookings must be kept for GST records (8 years). Erase what isn't needed (notes, preferences, chat
  transcripts) from a server shell, and record the request in your own register.

## Secrets rotation

| Secret | Effect of rotating |
|---|---|
| `JWT_ACCESS_SECRET` | All staff access tokens, guest booking links and chat sessions become invalid. Staff sign in again. |
| `JWT_REFRESH_SECRET` | Staff sign in again. |
| `IP_HASH_SALT` | Old audit IP hashes can no longer be correlated with new ones. |
| WhatsApp token / app secret | Update `.env` and restart. Then re-verify the webhook if the verify token changed. |
| Razorpay keys / webhook secret | Update both Razorpay and `.env` together. Pending webhooks retry. |

Rotate immediately if a secret may have leaked. Otherwise rotate yearly.
