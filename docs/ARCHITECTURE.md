# Architecture — BookMyStay Suite

## 1. Shape of the system

A **modular monolith**: one Express API and one React SPA in an npm-workspaces monorepo. For a 10–60 room hotel
with no IT staff, one deployable unit is cheaper and easier to operate than microservices. Module boundaries are
still enforced in code (each module owns its model, service, controller, routes and validation), so a module can be
extracted later if needed.

```
                ┌───────────────────────── client (React + Vite SPA) ─────────────────────────┐
                │  Public booking site  │  Guest lookup + chat  │  Owner/staff app (RBAC nav)  │
                └───────────────┬─────────────────────────────────────────────────────────────┘
                                │ HTTPS  /api/v1  (JSON, access JWT in Authorization header,
                                │                  opaque refresh token in httpOnly SameSite cookie)
┌───────────────────────────────▼──────────────────────────────────────────────────────────────┐
│ server (Express + TypeScript)                                                                  │
│  middleware: helmet · cors(allowlist) · rate-limit · request-id · pino (PII-redacted) ·        │
│              mongo-sanitize · authenticate · authorize(permission) · hotelScope · validate(zod)│
│                                                                                                │
│  modules/  auth  users  hotels  rooms  availability  bookings  payments  guests  crm          │
│            chatbot(gemini.service)  whatsapp  notifications                                    │
│  shared/   guestIdentity · auditLog · conversationLog · money · dates · phone · errors        │
│  jobs/     holdExpirySweeper · notificationOutboxWorker                                        │
└───────┬──────────────────────┬──────────────────────┬───────────────────────┬─────────────────┘
        │                      │                      │                       │
   MongoDB (Mongoose)   Google Gemini API      WhatsApp Cloud API     Payment gateway (adapter)
   replica set in prod  (@google/genai)        (Graph API + webhook)  mock in dev, UPI-first
```

## 2. Key architectural decisions

| Decision | Why |
|---|---|
| **TypeScript everywhere** | Shared mental model of types. Zod schemas are the single validation source on the server, and the same rules are mirrored on the client |
| **Express 5** | Native async error propagation. A custom query parser sanitises `$`/`.` keys (Express 5 makes `req.query` a getter, so classic sanitiser middleware no longer works) |
| **Mongoose 8** | Schemas, indexes, transactions, lean queries |
| **Money in paise (integers)** | No floating-point drift in GST or discounts |
| **Stay nights as `YYYY-MM-DD` strings** | Avoids UTC/IST off-by-one bugs. Hotel-local date semantics |
| **Inventory = one `Availability` doc per (hotel, roomType, date)** | Guarded atomic `$inc` prevents overselling even without transactions. Transactions wrap multi-doc writes when the deployment is a replica set |
| **Access JWT (15 min, memory) + opaque refresh token (7 d, httpOnly cookie, rotated, keyed hash in DB, family-based reuse detection)** | No tokens in `localStorage`, so XSS can't exfiltrate a long-lived token. A replayed refresh token revokes the whole family. A 30 s grace window treats simultaneous refreshes from two tabs as benign |
| **Server-side pricing** | The client sends `roomTypeId, dates, guests, promoCode`. The server computes the quote and booking amounts. Client prices are display-only |
| **Provider adapters** (payment, SMS, WhatsApp, LLM) | Real interface plus a clearly labelled dev implementation. Production boot fails if a dev provider is configured |
| **Notification outbox** | Booking confirmation never depends on a third-party API being up (PRD NFR). The worker retries with backoff |
| **Grounded LLM with tool calls** | Gemini never "knows" prices or times. It calls `getRoomQuote`, `createServiceRequest`, and similar tools that read or write MongoDB. Facts it can't ground cause an escalation |
| **Property scoping middleware** | Every staff request carries `req.auth.hotelId`. Services require a `hotelId` argument, and queries always filter on it. Only `super_admin` may pass a different `hotelId` |

## 3. Roles & permissions

Permissions are fine-grained strings. Roles map to permission sets in `server/src/modules/auth/permissions.ts`.
Routes declare the permission they need, not the role.

| Permission | super_admin | owner | manager | front_desk |
|---|:-:|:-:|:-:|:-:|
| `hotel.read` | ✓ | ✓ | ✓ | ✓ |
| `hotel.update` / `integrations.manage` / `policies.manage` | ✓ | ✓ | | |
| `staff.read` | ✓ | ✓ | ✓ | |
| `staff.manage` | ✓ | ✓ | | |
| `rooms.read` | ✓ | ✓ | ✓ | ✓ |
| `rooms.manage` / `rates.manage` / `availability.manage` | ✓ | ✓ | ✓ | |
| `bookings.read` | ✓ | ✓ | ✓ | ✓ |
| `bookings.manage` (create offline/OTA, cancel, confirm) | ✓ | ✓ | ✓ | |
| `stays.manage` (check-in/out) | ✓ | ✓ | ✓ | ✓ |
| `guests.read` / `guests.write` | ✓ | ✓ | ✓ | ✓ (relevant profiles) |
| `finance.read` (revenue dashboard) | ✓ | ✓ | | |
| `conversations.read` / `conversations.reply` | ✓ | ✓ | ✓ | ✓ |
| `conversations.escalations` (handle escalated) | ✓ | ✓ | ✓ | |
| `campaigns.manage` (follow-up drafts) | ✓ | ✓ | | |
| `audit.read` | ✓ | ✓ | | |

**Guest** is not a `User`. A guest gets a short-lived, **booking-scoped** JWT
(`typ: "guest", bookingId, guestId, hotelId`, 2 h) after proving `bookingRef + phone`. It grants read access to that
booking only, plus chat context. The WhatsApp channel identifies guests by the sender number, which Meta verifies.

Front desk sees "relevant" guest profiles: guests with a booking whose stay window covers the period from today minus
7 days to today plus 30 days, or guests in an active conversation. Owner and manager see all guests of their hotel.

## 4. Request lifecycle

1. `requestId` is assigned. pino logs method, path, status and latency. Phone, email, names, tokens and bodies are **redacted**.
2. helmet, CORS allowlist from `CLIENT_URL`, JSON body limit 100 kB, and query/body sanitisation (`$` and `.` keys stripped).
3. Rate limiters: global 300 req/min/IP. Auth 10 req/15 min/IP+email for login. Public booking/chat endpoints have tighter per-IP buckets.
4. `authenticate` verifies the access JWT (issuer, audience, algorithm pinned to HS256) and checks that the user is
   still active and `tokenVersion` matches. `authorize('perm')` follows. `validate({ body, query, params })` uses Zod.
5. The controller calls a service. Services own business rules and DB access. Controllers stay thin.
6. Errors → `AppError(status, code, message, details?)`. The error middleware maps Zod, Mongoose cast and
   duplicate-key errors to safe JSON. Stack traces are never sent in production.

Response envelope:
```json
{ "data": { ... }, "meta": { "page": 1, "limit": 20, "total": 134 } }
{ "error": { "code": "ROOM_UNAVAILABLE", "message": "…", "details": [ ... ], "requestId": "…" } }
```

## 5. Booking & payment flow (Phase 2 detail)

```
POST /bookings (public)
  ├─ validate → resolve hotel → quote (server pricing) → normalise phone
  ├─ txn/atomic: for each night $inc held where (sold+held+qty) <= total AND not stopSell
  │     on any failure: compensate the earlier increments → 409 ROOM_UNAVAILABLE
  ├─ guestIdentity.upsert(hotelId, phone, name, email, consent)
  ├─ Booking{status: pending_payment, holdExpiresAt: now+15m, amounts(paise), ref: BMS-XXXXXX}
  └─ audit + response {booking, payment intent next step}
POST /payments/create → provider.createOrder(booking.amounts.total) → Payment{status: created}
POST /payments/webhook → verify signature → idempotency on providerEventId → Payment captured
  └─ booking.confirm(): held→sold (re-checks the hold still exists; if expired, re-reserve or flag for refund)
       → Notification outbox: WhatsApp confirmation → SMS fallback
holdExpirySweeper (every minute): pending_payment past holdExpiresAt → expired, release held
```
The PRD requires that a payment gateway outage still lets the booking be captured. In that case
`POST /payments/create` fails, the booking remains `pending_payment` with `paymentStatus: provider_unavailable` and
the hold extended once. The guest sees "Booking received, payment link will be sent on WhatsApp" and staff see it
in the reservations queue.

## 6. AI receptionist design (Phase 3 detail)

- `gemini.service.ts` wraps `@google/genai` and is the only file that touches the SDK. `GEMINI_MODEL` is
  configurable. Timeouts and retries are bounded.
- **Grounding context** is built per turn: hotel profile (address, check-in/out times, amenities), active FAQs and
  policies (only `published: true`), and, only if the conversation is **authorised** for a booking, that booking
  and guest preferences. Data from other guests never enters the prompt.
- **Tools (function calling):** `getRoomQuote(checkIn, checkOut, guests)`, `createServiceRequest(type, details)`,
  `requestLateCheckout(time)`, `escalateToStaff(reason)`. The bot confirms a request only after the tool returns
  `ok: true`.
- **Pre-filter:** a regex/keyword list in English and Hinglish (complaint, refund, chargeback, doctor, fire, theft,
  harassment, "paisa wapas", and so on) escalates before calling Gemini. The model also returns
  `{escalate, reason, sentiment}`.
- **State machine:** `ai_active → escalated → staff_active → resolved → (ai_active on resume)`. While the status is
  `escalated` or `staff_active`, inbound messages are logged but **no AI reply** is generated.
- **Prompt hygiene:** the system prompt is server-only. The model is instructed never to reveal it. Guest input is
  passed as user content, never concatenated into system instructions.

## 7. Offline-friendly staff workflows (Phase 5)

TanStack Query cache is persisted to IndexedDB. Check-in, check-out, notes and staff replies go through an offline
mutation queue (persisted, replayed on `online`). Each queued mutation carries an `Idempotency-Key` header so replays
are safe. A banner shows queue size and the last sync time, as in the Stitch offline banner.

## 8. Security & privacy

- **Secrets** come only from env. `config/env.ts` validates them with Zod at boot. Production refuses weak or default
  JWT secrets, `PAYMENT_PROVIDER=mock`, or a missing `CLIENT_URL`.
- **Passwords:** bcrypt cost 12, a minimum of 10 characters, and a constant-time-ish login (dummy hash compare for
  unknown emails) so attackers can't enumerate accounts.
- **Refresh tokens:** opaque random values stored as keyed SHA-256 hashes and rotated on every refresh. Reusing a rotated token more than 30 s later revokes the family. Within 30 s, the request is a concurrent refresh (two tabs) and gets a sibling token. The successor hash is recorded atomically when the token is claimed, so a refresh racing a logout is rejected.
  `logout` revokes and clears the cookie (`httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`).
- **NoSQL injection:** `$`/`.` keys are stripped from the body and from the query (inside the Express 5 query parser), and
  Zod validates every input with strict schemas. Mongoose `sanitizeFilter` is deliberately **off**: it would also
  neutralise the service layer's own trusted operators.
- **Webhooks:** WhatsApp `X-Hub-Signature-256` HMAC over the raw body, compared in constant time. Payment
  signatures use provider HMAC. Both are idempotent on the event id.
- **Audit log:** auth events, staff changes, rate/availability changes, booking state changes, check-in/out, guest
  profile views by front desk, takeovers and campaign sends.
- **PII-safe logging:** pino redaction paths plus a phone masker (`+91•••••4552`).

### DPDP Act 2023 — implemented controls vs legal review

Implemented in code:
1. A purpose-specific notice at booking and at chat start. Separate consent flags: `transactional` (required to
   fulfil the booking) and `marketing` (optional, unticked by default), each with a timestamp and source.
2. Data minimisation: phone required, everything else optional. No Aadhaar numbers are stored (only an
   "ID verified" boolean plus the document type).
3. Access control and an audit trail on guest profile access.
4. Consent withdrawal: a "STOP" WhatsApp reply or a staff action sets `marketing=false`. Campaign sends hard-check consent.
5. An erasure/correction request record (`Guest.privacy.erasureRequestedAt`). Staff can anonymise a guest while
   keeping financial records that the GST retention rules require.

**Requires legal review before launch:** the notice wording and language versions, the lawful basis for
transactional processing, retention periods (GST records vs CRM data), Significant Data Fiduciary applicability,
cross-border transfer (Gemini/Meta processing outside India), a grievance officer contact, breach notification
procedure and timelines under the DPDP Rules, children's data (guests under 18), and processor agreements with
Google, Meta and the payment gateway.

## 9. Folder structure

```
bookmystay-suite/
├── client/                         React 19 + Vite + TS + Tailwind v4
│   ├── src/
│   │   ├── components/             shared UI (AppHeader, Sidebar, MobileNavigation, StatCard, RoomCard,
│   │   │                           GuestCard, BookingCard, StatusBadge, PricingBreakdown, DateRangePicker,
│   │   │                           ChatWindow, ChatMessage, StaffTakeoverPanel, GuestProfilePanel,
│   │   │                           DataTable, ConfirmDialog, ToastNotification, LoadingSkeleton, EmptyState)
│   │   ├── layouts/                PublicLayout, OwnerLayout, AuthLayout
│   │   ├── pages/                  public/, owner/, guest/, auth/
│   │   ├── modules/{booking,receptionist,crm}/   module-specific hooks, api, components
│   │   ├── hooks/  services/  context/  routes/  utils/  types/
│   │   └── test/
│   └── package.json
├── server/                         Express 5 + TS + Mongoose 8
│   ├── src/
│   │   ├── config/                 env, logger, db
│   │   ├── middleware/             authenticate, authorize, validate, rateLimit, error, sanitize, requestId
│   │   ├── modules/<name>/         *.model.ts *.service.ts *.controller.ts *.routes.ts *.validation.ts __tests__/
│   │   ├── database/               seed/, migrations (index sync)
│   │   ├── shared/                 errors, audit, guestIdentity, conversationLog
│   │   ├── utils/                  phone, money, dates, crypto
│   │   ├── jobs/
│   │   ├── app.ts                  express app factory (no listen – testable)
│   │   └── server.ts               bootstrap: env → db → jobs → listen → graceful shutdown
│   └── package.json
├── docs/
├── scripts/
├── .env.example  .gitignore  package.json  README.md
```

## 10. Environments

| | Development | Test | Production |
|---|---|---|---|
| MongoDB | local standalone (`mongodb://127.0.0.1:27017/bookmystay`) | mongodb-memory-server replica set | Atlas / self-hosted **replica set** (transactions) |
| Payments | `mock` (labelled DEV MODE in UI) | `mock` | real adapter (required) |
| WhatsApp | simulator if creds missing | mocked HTTP | Cloud API |
| Gemini | real if `GEMINI_API_KEY` set, otherwise the bot replies "AI offline, staff notified" | mocked SDK | real |
