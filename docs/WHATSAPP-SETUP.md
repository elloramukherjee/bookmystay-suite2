# WhatsApp Cloud API — go-live guide

BookMyStay runs in **simulator mode** until all four `WHATSAPP_*` credentials are set. In simulator mode every flow
works end to end (AI replies, staff takeover, confirmations, fallbacks), and messages are recorded as `simulated`.
Nothing reaches a guest. Hotel Settings → **Guest messaging** shows which mode the server is in.

Switching to live needs no code change: fill the `.env` values below and restart the API.

## 1. What the hotel (client) must provide or do

| # | Item | Who does it | Notes |
|---|---|---|---|
| 1 | **Meta Business account** for the hotel's legal entity | Hotel owner | business.facebook.com. Use the hotel's legal name as on GST/PAN. |
| 2 | **Business verification** | Hotel owner | Upload GST certificate / Udyam / utility bill with the same name and address. Usually takes 2–7 working days. Without it, messaging is capped at 250 new conversations/day. |
| 3 | **A phone number for WhatsApp Business API** | Hotel owner | A number that can receive an SMS or call for the OTP. It **must not** be active in the normal WhatsApp or WhatsApp Business *app* (delete that account first, or use a new number). Landlines work via voice OTP. |
| 4 | **Display name** | Hotel owner | E.g. "Heritage Courtyard Haveli". Must match the business name and is reviewed by Meta. |
| 5 | **Payment method in Meta** | Hotel owner | Card added to the WhatsApp Business account. Service (guest-initiated) conversations are free; template messages to guests are charged per message by Meta. |
| 6 | **Add the developer as an admin** | Hotel owner | Business Settings → Users → add the developer's email (Admin, or at least access to the app and WhatsApp account). |
| 7 | **Message templates** | Developer drafts, owner approves | Needed for messages sent more than 24 hours after the guest last wrote (website booking confirmations, cancellations, check-in welcome). See §4 for the exact texts. |

## 2. Developer steps in Meta

1. developers.facebook.com → **Create app** → type *Business* → add the **WhatsApp** product, linked to the hotel's
   business account.
2. WhatsApp → API Setup → **Add phone number** (item 3) and verify it with the OTP. Copy the **Phone number ID**.
3. Business Settings → System users → create a system user (Admin) → assign the app and the WhatsApp account →
   **Generate token** with `whatsapp_business_messaging` and `whatsapp_business_management`, expiry *Never*.
   This is the **permanent access token** (the 24-hour token on the API Setup page is for testing only).
4. App settings → Basic → copy the **App secret**.
5. Choose any random string as the **verify token** (e.g. `openssl rand -hex 16`).
6. WhatsApp → Configuration → **Webhook**: callback URL `https://<api-domain>/api/v1/webhooks/whatsapp`, verify token
   from step 5 → *Verify and save* → subscribe to the **messages** field.
   The API must be reachable over public HTTPS. For local testing use a tunnel (e.g. `ngrok http 4000`).

## 3. Server configuration

```dotenv
WHATSAPP_ACCESS_TOKEN=<permanent system-user token>
WHATSAPP_PHONE_NUMBER_ID=<phone number ID>
WHATSAPP_VERIFY_TOKEN=<random string from step 5>
WHATSAPP_APP_SECRET=<app secret>
WHATSAPP_API_VERSION=v21.0
```

Restart the API. The startup log shows `whatsapp: "cloud-api"`, and Hotel Settings shows **WhatsApp live**.
For a single property this number is used automatically. For several properties on one server, set each hotel's
`integrations.whatsappPhoneNumberId` so incoming messages are routed to the right property.

**Never** commit these values or put them in the client (`VITE_*`) environment.

## 4. Templates (24-hour rule)

WhatsApp allows free-form messages only within 24 hours of the guest's last message. Chat replies and request updates
are normally inside that window. Booking confirmations, cancellations, the check-in welcome and staff alerts usually
are not, so they need **approved Utility templates**. Create these in WhatsApp Manager (language English), with the
placeholders exactly in this order:

| Message type | Suggested template name | Body (placeholders in this order) |
|---|---|---|
| `booking_confirmed` | `bms_booking_confirmed` | Namaste {{1}}! Your stay at {{2}} is confirmed. Booking ref: {{3}} ({{4}}). Check-in {{5}}, check-out {{6}}. {{7}}. Reply here for anything you need before arrival. |
| `booking_cancelled` | `bms_booking_cancelled` | Your booking {{1}} at {{2}} has been cancelled. {{3}} |
| `checkin_welcome` | `bms_checkin_welcome` | Welcome to {{1}}, {{2}}! You're in room {{3}}. Check-out is by {{4}}. Message us here anytime for towels, food or late checkout. |
| `staff_escalation_alert` | `bms_staff_alert` | Guest chat needs staff: {{1}}. Open the Concierge Desk to take over. |

Once approved, map them in `.env` and restart:

```dotenv
WHATSAPP_TEMPLATES=booking_confirmed=bms_booking_confirmed:en,booking_cancelled=bms_booking_cancelled:en,checkin_welcome=bms_checkin_welcome:en,staff_escalation_alert=bms_staff_alert:en
```

Mapped message types are sent as templates. Everything else goes as text. Values never contain newlines (Meta rejects
them), and the code replaces them automatically. Hotel Settings → Guest messaging shows how many are mapped.

**Without templates:** in live mode Meta rejects these messages (error 131047). This version has no SMS or email
gateway, so the message is **not faked**. The booking is flagged "please call the guest" and listed under **Guests to
call** on the dashboard and in Guest messaging.

## 5. What happens at runtime

- **Inbound**: Meta → `POST /webhooks/whatsapp`. The `X-Hub-Signature-256` signature is checked against the app
  secret. Each message is stored once (duplicates by `wamid` are ignored) and answered by the AI receptionist in the
  background. Meta gets its 200 immediately. A message saved but not processed (e.g. a restart) is retried by a
  recovery job every minute.
- **The guest's number is their identity**: it links the chat to their CRM profile and to their current or next
  booking.
- **STOP / START** from a guest withdraws or restores marketing consent (booking messages continue).
- **Photos, voice notes and documents** are logged for staff ("open the WhatsApp app to view it"). The AI only reads text.
- **Outbound**: every message goes through the outbox. Network errors, 429s and 5xx responses are retried with
  backoff (5 attempts). Permanent errors (not on WhatsApp, outside the 24-hour window) move straight to the next channel
  **that can actually deliver**. In this version there is none (no SMS/email gateway), so staff get a call task.
  Delivered and read receipts update the tick status staff see in the Concierge Desk.

## 6. Go-live test

1. Hotel Settings → Guest messaging shows **WhatsApp live** and the masked number ID.
2. From a personal phone, message the business number "What time is check-in?". You should get an AI reply within a
   few seconds, and the chat appears in the Concierge Desk with channel *WhatsApp*.
3. Reply as staff from the desk. The message arrives on the phone, and the desk shows delivered/read.
4. Send "STOP". The guest profile shows marketing consent withdrawn.
5. Make a test booking with your own number and check the confirmation arrives on WhatsApp. Without an approved
   template it only arrives within 24 hours of your last message; otherwise it appears under "Guests to call".
