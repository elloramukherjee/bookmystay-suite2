# API Documentation — `/api/v1`

Base URL in development: `http://localhost:4000/api/v1`

**Auth:** staff endpoints need `Authorization: Bearer <accessToken>`. The refresh token lives in the httpOnly
cookie `bms_rt` (path `/api/v1/auth`). Guest booking-scoped endpoints accept a guest token from
`POST /bookings/lookup`.

**Envelope:** success `{ "data": ..., "meta"?: {...} }`. Error `{ "error": { code, message, details?, requestId } }`.

**Pagination:** `?page=1&limit=20` (limit ≤ 100) → `meta: { page, limit, total, totalPages }`.

**Common error codes:** `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `TOKEN_EXPIRED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `CONFLICT` (409), `ROOM_UNAVAILABLE` (409), `RATE_LIMITED` (429), `INTERNAL` (500).

Legend: ✅ implemented · ⏳ planned phase

---

## Health
| Method | Path | Auth | Status |
|---|---|---|---|
| GET | `/health` | public | ✅ returns `{ status, db, transactions, uptime }` |

## Authentication
| Method | Path | Auth | Status | Notes |
|---|---|---|---|---|
| POST | `/auth/register` | `staff.manage` | ✅ | Owner creates a staff account in **their own** hotel. Owners may create `manager` and `front_desk`. Super admin may create `owner` for any hotel |
| POST | `/auth/login` | public, rate-limited | ✅ | `{ email, password }` → `{ accessToken, expiresIn, user }` and sets the refresh cookie |
| POST | `/auth/refresh` | refresh cookie | ✅ | Rotates the refresh token. A reused token revokes the whole family |
| POST | `/auth/logout` | refresh cookie | ✅ | Revokes the token and clears the cookie. Idempotent |
| GET | `/auth/me` | bearer | ✅ | Current user, hotel summary and permission list |
| POST | `/auth/change-password` | staff | `{ currentPassword, newPassword }` (≥ 10 chars, letters + numbers). Signs out every other session and returns a fresh session for this one (same shape as login). Rate-limited like login |
| PUT | `/users/:id/password` | `staff.manage` | `{ newPassword }`. Owner sets a password for a staff member who forgot theirs (roles they can assign, same property, not themselves). Their sessions end. 204 |

Login example:
```http
POST /api/v1/auth/login
{ "email": "owner@heritagecourtyard.example", "password": "••••••••••" }
→ 200 { "data": { "accessToken": "eyJ…", "expiresIn": 900,
       "user": { "id": "…", "name": "Vikramaditya Singh", "role": "owner", "hotelId": "…" } } }
```

## Users (staff management)
| Method | Path | Auth | Status |
|---|---|---|---|
| GET | `/users` | `staff.read` | ✅ staff of the caller's hotel, paginated |
| PATCH | `/users/:id` | `staff.manage` | ✅ `{ name?, role?, isActive? }`. Can't demote or deactivate yourself, and can't edit an owner unless super admin. Bumps `tokenVersion` |

## Hotels
| Method | Path | Auth | Status |
|---|---|---|---|
| GET | `/hotels/:slug` | public | ✅ public profile (no settings, no integrations, no GSTIN) |
| PUT | `/hotels/:id` | `hotel.update` + same hotel | ✅ profile and settings update (Zod, strict) |
| GET | `/hotels/:id/settings` | `hotel.read` + same hotel | ✅ full settings. Integrations are reported as `configured: bool` only, never secrets |

## Public directory & policies ✅
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/hotels` | public | Active properties with hero photo, rating and the lowest "from" rate |
| GET | `/hotels/:id/rooms` | public | Active room types (no inventory counts) |
| GET | `/hotels/:slug/policies` | public | Published policies (cancellation, check-in, ID, parking, pets, ...) |
| GET | `/hotels/:id/policies/all` | `hotel.read` | Includes unpublished |
| PUT | `/hotels/:id/policies/:type` | `policies.manage` | `{ title, body, published }` upsert |

## Rooms ✅ (`/rooms` = room types, `/rooms/:id/units` = numbered rooms)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/rooms` | `rooms.read` | Room types with units and rate plans |
| POST | `/rooms` | `rooms.manage` | Creates a type, optional `unitNumbers[]` and a default "Room only" plan |
| PUT | `/rooms/:id` | `rooms.manage` | Partial update (rates in paise) |
| DELETE | `/rooms/:id` | `rooms.manage` | Soft delete (stops selling; bookings untouched) |
| POST | `/rooms/:id/units` | `rooms.manage` | `{ number, floor? }` |
| PATCH | `/rooms/units/:unitId` | `rooms.manage` | `{ status?, isActive?, number? }`. Deactivation is refused (409) if future nights would become overbooked |

## Availability ✅
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/availability?hotelId&checkIn&checkOut&adults&children&rooms&promoCode` | public | Per room type: `available`, `bookable`, `reason`, and a server quote per rate plan. 400 on past dates, >30 nights, >365 days ahead, invalid promo |
| GET | `/availability/calendar?from&days` (days up to 62) | `rooms.read` | Per type per night: total / sold / held / blocked / available / effective rate / stop-sell |
| PUT | `/availability` | `availability.manage` | `{ roomTypeId, from, to, ratePaise? (null = reset), stopSell?, blocked?, minStay?, weekdays? }` returns `{ updatedNights, conflicts[] }` |

## Bookings ✅
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/bookings` | public, rate-limited, `Idempotency-Key` | Body has **no price fields**: `{ hotelId, roomTypeId, ratePlanId?, checkIn, checkOut, adults, children, rooms, guest{name, phone, email?}, specialRequests?, promoCode?, consent{transactional: true, marketing} }`. Returns 201 `{ booking, guestToken }` (200 on replay). 409 `ROOM_UNAVAILABLE` |
| POST | `/bookings/lookup` | public, 10 per 15 min | `{ reference, phone }` returns `{ booking, guestToken }`. Uniform 404 on any mismatch |
| GET | `/bookings/:id` | staff (own hotel) or `X-Guest-Token` for that booking | Guest view masks the phone |
| POST | `/bookings/:id/cancel` | `bookings.manage` or the guest's token | Free window: full refund due. Otherwise the first night is retained. Releases inventory |
| GET | `/bookings?status&source&from&to&q&attention&sort&page&limit` | `bookings.read` | `source` = direct, ota or a specific source. `q` matches reference, name or phone (any format) |
| POST | `/bookings/manual` | `bookings.manage` | OTA / walk-in / phone booking, sold immediately, optional staff nightly rate |
| POST | `/bookings/:id/confirm` | `bookings.manage` | Pending to confirmed as pay-at-hotel |

## Payments ✅
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/payments/create` | guest token / staff | `{ bookingId, method: upi / card / netbanking }` returns order + checkout instructions. 409 `HOLD_EXPIRED`. 503 `PAYMENT_PROVIDER_UNAVAILABLE` (booking kept, hold extended once, guest notified) |
| GET | `/payments/:id/status` | guest token / staff | Polled by the payment page |
| POST | `/payments/webhook` | provider signature | Razorpay `X-Razorpay-Signature` (HMAC-SHA256 of the raw body). Idempotent on event id |
| POST | `/payments/:id/simulate` | guest token / staff | **Only registered with the mock provider outside production.** `{ outcome: success / failure }` goes through the real webhook path |

### Pay-at-hotel mode (`PAYMENT_PROVIDER=pay_at_hotel`)
- `GET /hotels/:slug` includes `paymentMode: "pay_at_hotel" | "online"`, so the booking page can skip the payment step.
- `POST /bookings` returns the booking already `confirmed` with `paymentStatus: "pay_at_hotel"`: rooms sold, guest stats
  updated, WhatsApp confirmation queued ("Amount due at hotel"). An idempotent replay returns the same booking.
- One phone number may hold at most **3** upcoming unpaid bookings per property. Beyond that: 409 `TOO_MANY_UNPAID_BOOKINGS`.
- `POST /payments/create` → 409 `ONLINE_PAYMENTS_DISABLED`. `POST /payments/webhook` → 404.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/bookings/:id/no-show` | `stays.manage` | Confirmed booking, from its check-in day on (staff can't cancel after check-in time). Status → `no_show`; tonight and later nights go back on sale; no guest message. 409 if not yet due or already handled. Audited |

## Guests ✅
Guests are identified by E.164 mobile, unique per hotel. Front-desk roles (no `guests.read_all`) only see guests with a stay
from 7 days ago to 30 days ahead, or an open conversation; other guests return 404.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/guests?q&filter&page&limit` | `guests.read` | `q` matches name, email, phone in any format (or its last digits) and BMS reference. `filter`: `all\|returning\|direct\|ota\|ota_converts\|in_house\|marketing`. Ledger rows: tier, origin (first booking channel), stay path, stats, key preference, in-house / next stay |
| GET | `/guests/lookup?phone` | `guests.read` | Exact phone lookup |
| GET | `/guests/:id` | `guests.read` | Profile + notes, preferences, consent, ID-verification flag |
| POST | `/guests` | `guests.write` | `{ phone, name?, email?, city?, marketingConsent? }`. 409 if the phone already exists |
| PUT | `/guests/:id` | `guests.write` | `{ name?, email?, city?, tags?, marketingConsent? }`. Withdrawing consent sets `withdrawnAt` |
| POST | `/guests/:id/notes` | `guests.write` | `{ text, category: general\|room\|fnb }`. Staff-only, never sent to the AI |
| PUT / DELETE | `/guests/:id/preferences[/:prefId]` | `guests.write` | Upsert `{ category: room\|fnb\|accessibility\|communication\|other, key, value }` |

## CRM ✅
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/crm/dashboard?period=mtd\|30d\|90d\|ytd\|all` | `hotel.read` | Stays and channel mix, direct share, repeat-guest %, occupancy, today's counts, contacts, OTA→direct funnel. Revenue and commission-saved fields are `null` without `finance.read` (`financeVisible: false`) |
| GET | `/crm/guests`, `/crm/guests/:id/history` | `guests.read` | Ledger (same as `/guests`) and timeline: bookings, check-in/out, cancellations, chats, escalations, service requests, notes, follow-ups, newest first |
| GET | `/crm/today` | `stays.manage` | Arrivals, in-house, departures due and counts (hotel-local date) |
| GET | `/crm/desk-search?q` | `stays.manage` | Phone, room number, name or reference; current and upcoming stays |
| GET | `/crm/available-rooms?roomTypeId` | `stays.manage` | Rooms of that type that are free tonight |
| POST | `/crm/check-in` | `stays.manage` | `{ bookingId, roomId?, idVerified, idDocType?, sendWelcome }`. Confirmed booking with `checkIn <= today < checkOut`. Atomic room claim (409 if just taken). Only the ID type is recorded |
| POST | `/crm/check-out` | `stays.manage` | `{ bookingId, paymentCollected }` (required for pay-at-hotel). Room → cleaning, unused future nights released, guest stats updated |
| GET / POST / PUT | `/crm/templates[/:id]` | `campaigns.manage` | Follow-up templates |
| POST | `/crm/drafts` | `campaigns.manage` | `{ templateId, audience: returning\|ota_converts\|ota_only\|all_consented\|selected, guestIds? }`. Consent-gated; returns drafts + `excludedNoConsent` |
| POST | `/crm/drafts/:id/sent`, `/crm/drafts/:id/discard` | `campaigns.manage` | Records a personal send (re-checks consent, 409 if withdrawn) or a skip |

## Chatbot ✅
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/chatbot/message` | public (rate-limited); `X-Chat-Token` to continue; optional `X-Guest-Token` links the booking | `{ hotelId, text, name?, phone?, consent? }` returns `{ chatToken, conversationId, status, withStaff, verifiedBooking, messages[], aiAvailable }`. Phone needs consent and links the CRM profile only (no booking data) |
| GET | `/chatbot/session?after` | `X-Chat-Token` | Guest-visible messages (polled every 4s) |
| POST | `/chatbot/verify` | `X-Chat-Token` | `{ reference, phone }` unlocks stay context and service requests. Uniform 404 |
| GET | `/chatbot/stats` | `conversations.read` | 7-day KPIs: automated resolution %, avg AI latency, % under 4s, in-flight, escalation queue, open requests |
| GET | `/chatbot/conversations?status(open\|escalated\|…)&channel&q&page&limit` | `conversations.read` | Escalations first (urgent → high), then most recent |
| GET | `/chatbot/conversations/:id` | `conversations.read` | Full transcript incl. internal notes, guest profile, verified booking, service requests |
| POST | `/chatbot/conversations/:id/takeover` | `conversations.reply` (+ `conversations.escalations` if escalated) | Status `staff_active`, the AI stops |
| POST | `/chatbot/conversations/:id/reply` | as above | `{ text, internal? }`. A visible reply implicitly takes over |
| POST | `/chatbot/conversations/:id/resolve` | as above | `{ resumeAi: true\|false, note? }` |
| POST | `/chatbot/simulate` | `conversations.escalations` | WhatsApp-style simulator: `{ phone, name?, text }`. The sender phone identifies the guest and stay |
| GET | `/chatbot/service-requests?status` | `conversations.read` | Open/acknowledged by default |
| PATCH | `/chatbot/service-requests/:id` | `stays.manage` | `{ status: acknowledged\|done\|declined, message? }`. Done/declined notifies the guest in the chat |
| GET/POST/PUT/DELETE | `/chatbot/faqs[/:id]` | read: `conversations.read`; write: `policies.manage` | Knowledge base. Only `published` entries reach the AI |

## WhatsApp ✅
Live when all four `WHATSAPP_*` variables are set; otherwise simulator mode (see `docs/WHATSAPP-SETUP.md`).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token&hub.challenge` | verify token | Meta's subscription handshake; returns the challenge as plain text. 403 on token mismatch, 404 `WHATSAPP_NOT_CONFIGURED` in simulator mode |
| POST | `/webhooks/whatsapp` | `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret) | Inbound messages and delivery receipts. Returns `{ messages, statuses, duplicates }` immediately; replies are generated in the background. Not rate-limited (Meta bursts); unsigned requests get 401 |
| GET | `/whatsapp/status` | `hotel.read` | Mode (`live`/`simulator`), masked number ID, last inbound/outbound, 7-day counts per channel (sent / simulated / waiting / failed, plus `live` = a real provider exists), recent failures with the fallback used, `templates` (message type → mapped Meta template), `manualFollowUps` (guests to call). Never returns credentials |
| POST | `/whatsapp/follow-ups/:id/resolve` | `stays.manage` | Staff reached the guest by phone. Clears the booking's "needs attention" note. 404 if already resolved. Audited |

Guest keywords on WhatsApp: `STOP` / `UNSUBSCRIBE` withdraw marketing consent, `START` restores it.
