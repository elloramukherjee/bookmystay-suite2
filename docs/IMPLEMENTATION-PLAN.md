# Implementation Plan

Each phase ends with: typecheck → lint/build → tests → manual smoke run → docs updated. A phase is not marked
done until those steps pass.

## Phase 1 — Foundation ✅ (current)
- [x] PRD and Stitch analysis, architecture, DB, API docs
- [x] npm-workspaces monorepo (`client`, `server`), `.env.example`, `.gitignore`
- [x] Server: Zod-validated env config, pino logger with PII redaction, Express 5 app factory, helmet, CORS
      allowlist, rate limiting, `$`/`.` sanitisation, request ids, error middleware, `/health`
- [x] MongoDB connection, transaction capability detection, graceful shutdown
- [x] Models: Hotel, User, RefreshToken, AuditLog
- [x] Auth: register (staff, scoped), login (lockout), refresh rotation with reuse detection, logout, me
- [x] RBAC permission map, `authenticate`, `authorize`, hotel scoping
- [x] Hotels API (public profile, update, settings). Users API (list and manage staff)
- [x] Seed: one Jaipur heritage hotel and four staff users (passwords come from env or are generated and printed, never hardcoded)
- [x] Client: Vite + React + TS + Tailwind v4 with Stitch tokens, Router, TanStack Query, Axios with silent refresh,
      AuthContext, protected and permission routes
- [x] Responsive shell: announcement strip, AppHeader with module pill tabs, Sidebar (desktop),
      MobileNavigation (bottom bar), role-based navigation, footer
- [x] Pages: public HomePage (from live hotel API), Login, Owner Dashboard (Phase-1 overview), Staff Management,
      Hotel Settings. Later-phase routes are visible to roles that will use them, shown as module "not yet enabled" states
- [x] Shared components: StatCard, StatusBadge, DataTable, ConfirmDialog, ToastNotification, LoadingSkeleton, EmptyState
- [x] Tests: auth, authorization, hotel isolation, sanitisation (Vitest + Supertest + mongodb-memory-server). Client component tests

**Phase 1 verification (23 Nov 2026):** server 47/47 and client 14/14 tests passing, both workspaces typecheck,
production build succeeds (guest initial JS ≈ 146 kB gzip, staff screens lazy-loaded). Manual browser run: public
page, login, session restore on reload, dashboard, staff list, settings, and 390 px mobile layout with bottom nav.
Found and fixed during manual testing: concurrent refreshes from two tabs were falsely flagged as token theft,
which logged the owner out everywhere. Fixed with a 30 s rotation grace window and a regression test.

Deferred from Phase 1 (by design): password reset/change flow (staff ask the owner; owner can deactivate and recreate),
guest booking-scoped tokens (Phase 2, with booking lookup).

## Phase 2 — BookMyStay direct booking ✅
- [x] Models: RoomType, Room, RatePlan, Availability (per night), Booking, Payment, Guest, GuestPreference, HotelPolicy, Notification (outbox)
- [x] Pricing service: server-side quote. GST per night per room on the *discounted* tariff (slab-aware), direct discount, promo codes and OTA comparison. Integer paise throughout
- [x] Inventory: lazy per-night docs. Guarded atomic reserve (`sold + held + blocked + qty <= total`, stop-sell aware). Transactions on replica sets, compensation on standalone
- [x] Booking state machine: `pending_payment -> confirmed -> (checked_in -> checked_out)`. Also `expired` (hold sweeper) and `cancelled` (free-window refund rules)
- [x] Idempotent create (`Idempotency-Key`). Guest identity upsert by normalised phone. Booking-scoped guest tokens. Lookup by reference + phone with a uniform 404
- [x] Payments: provider interface, mock dev provider (refused in production) and Razorpay adapter (Orders API + HMAC webhook). Signed, idempotent webhook pipeline with amount check. Late payment after expiry is re-reserved or flagged for refund. Gateway outage keeps the booking and extends the hold
- [x] Notification outbox + worker (WhatsApp -> SMS fallback, retries with backoff). Dev providers mark messages `simulated`, never `sent`
- [x] Staff: room types and units (inventory sync with an overbooking guard), rates and availability calendar with bulk updates, booking list/detail, confirm pay-at-hotel, cancel, manual OTA/walk-in/phone bookings
- [x] Public UI: suite landing, property details (search, honest direct-vs-OTA comparison, policies), room listing, booking form, UPI-first payment (dev simulator panel), confirmation, find-my-booking
- [x] Components: RoomCard, PricingBreakdown, DateRangePicker, GuestCountSelector, BookingCard, booking status badges
- [x] Tests: pricing, availability search, **concurrent double-booking (with and without transactions)**, overlap compensation, idempotency, hold expiry, stop-sell/blocked, guest-token scoping, lookup, cancellation, staff isolation, manual OTA bookings, webhook idempotency and signatures, amount mismatch, gateway outage, late payment, rooms CRUD and inventory guard, Razorpay signature verification. Client: components, booking form (no price is ever sent), modal focus

**Phase 2 verification (24 Nov 2026 IST):** server 92/92 and client 23/23 tests passing, both workspaces typecheck, and
the production build succeeds. Manual browser run of the full guest funnel: landing -> property -> search -> rooms ->
details -> UPI (dev mock) -> confirmation, plus the staff bookings list, a rates calendar edit (checked live in the guest
quote) and rooms.

Bugs found and fixed during manual testing:
1. Cancellation deadline was shown in the *viewer's* time zone (an IST deadline appeared as "22 Nov 11:30 PM" on a non-IST
   machine). Hotel times now always render in the hotel's time zone, labelled IST.
2. Modal focus effect re-ran on every parent re-render and pulled focus back to the first field. Fixed, with a
   regression test that fails on the old code.
3. Pages kept the previous page's scroll position. A root `ScrollRestoration` was added.
4. A Stitch-supplied photo had a booking-UI mock-up baked into the image. It was replaced in the seed.

Known limits / follow-ups:
- Razorpay: the server adapter and webhook verification are unit-tested, but Checkout has **not** been exercised against
  a live Razorpay test account (needs your test keys).
- Refunds are *recorded* (`refund_pending`, amount due); they are not yet issued through the gateway refund API. Staff
  refund from the gateway dashboard.
- "Payment link will be sent" (gateway outage) relies on staff sending the link; automated payment links come with a real gateway.
- The rates grid scrolls horizontally inside its card on phones by design; the page itself doesn't.

## Phase 3 — AI receptionist ✅
- [x] Models: HotelFAQ, Conversation (state machine + escalation), ChatMessage (latency, tool calls, internal notes), ServiceRequest
- [x] `server/src/modules/chatbot/services/gemini.service.ts`: the only module that calls Gemini (official `@google/genai`)
  - function calling, bounded tool rounds and an overall timeout (`GEMINI_TIMEOUT_MS`)
  - one retry for 429/5xx, optionally on `GEMINI_FALLBACK_MODEL`
  - configurable thinking level
  - **truncated or filtered replies (`finishReason` other than STOP) are never sent**
  - Markdown is normalised to WhatsApp-style text
- [x] Grounding: hotel facts, published policies and published FAQs from MongoDB, built per message. Guest text is never put into
  the system instruction. Booking context is included only for a verified booking (booking token, reference + phone,
  or the WhatsApp sender number)
- [x] Tools: `check_availability_and_price` (the real pricing engine, the only source of prices), `create_service_request`
  (requires a verified stay; logged as `open`, never claimed as done or approved), `escalate_to_staff`
- [x] Safety pre-filter (English + Hinglish) runs **before** the AI: medical/safety (urgent, 112 guidance), complaints,
  payment disputes, refunds and strong negative sentiment escalate immediately, with no AI involved
- [x] Escalation: pauses the AI, keeps history, alerts the property's WhatsApp via the outbox, shows guest + booking
  context. Takeover/reply/resolve: managers handle escalations, front desk replies to normal chats, internal notes, and
  "Resolve & resume AI"
- [x] Failure modes: no key / API error / timeout / truncation means a holding reply plus staff handoff. If tools already
  logged requests, the holding reply says exactly what was logged
- [x] Guest web chat (chat token, optional phone with consent, booking verification), the WhatsApp-style simulator for staff
  (no Meta credentials needed), service-request completion messages sent by staff, desk KPIs from MongoDB, FAQ CRUD
- [x] UI: Concierge desk (Stitch screen 2), conversation detail (mobile), knowledge base, guest chat page. Components:
  ChatWindow, ChatMessage, StaffTakeoverPanel, GuestProfilePanel
- [x] Tests: safety rules (EN + Hinglish), grounded FAQ prompt (published only, no guest text in instructions, no other
  guests' data), price via tool, service-request verification and completion, booking-token linking, rule/AI/failure
  escalation, transient retry vs permanent error, truncated-reply rejection, staff permissions and takeover/resume,
  property and chat-token isolation, simulator identity, KPIs, FAQ permissions. Client: chat bubbles, composer, takeover
  permissions

**Phase 3 verification (24 Nov 2026 IST):** server 131/131 and client 28/28 tests passing (Gemini mocked at the SDK
boundary only), typecheck and build OK. **Live Gemini checks** against your API key:
- A FAQ answer (check-in time + Innova parking) was correct and grounded.
- A price question was answered through the availability tool with the exact engine prices (₹9,072 / ₹10,584 …) and
  the booking link.
- An in-house guest's late checkout + water requests were logged as `open` service requests for room 204.

Issues found and fixed during live testing:
1. `gemini-2.5-flash` is no longer available to new API keys (404). The default is now `gemini-3.8-flash` (verified
   against the key's model list).
2. "Thinking" models consumed the 800-token output budget, producing a truncated reply that stated a fact not in the
   knowledge base. The budget was raised to 4096, and any non-STOP finish is now rejected (with a regression test).
3. Transient 503s now get one retry, optionally on a fallback model.
4. A timeout after tools succeeded gave a generic holding reply. It now states which requests were logged.
5. Markdown bold in replies was converted to WhatsApp-style formatting.

**Live-environment caveat:** during testing Google's API was heavily degraded: `gemini-3.8-flash` mostly returned 503,
and `gemini-3.5-flash` took 10–55s per call. With the default 12s timeout, most chats in that window would be handed to
staff with a holding reply (the designed fallback). Recommended `.env`: `GEMINI_THINKING_LEVEL=LOW` (set) and
`GEMINI_FALLBACK_MODEL=gemini-3.5-flash`. Re-check reply latency when Google's service is normal before the pilot.

## Phase 4 — Guest CRM ✅
Guest profile APIs, notes and preferences, booking/stay/conversation timeline, repeat detection, quick check-in/out
(room assignment, room status), dashboard aggregations (all metrics from Mongo), follow-up templates and drafts
with consent checks. Pages: GuestCRMPage, GuestDetailsPage, OwnerDashboard metrics (Stitch screen 3).
Components: GuestCard, GuestProfilePanel. Tests: CRM aggregation, check-in/out, consent gating.

Delivered:
- Server: `modules/guests` (ledger, search, profile, notes, preferences, consent), `modules/crm` (today roster, desk
  search, check-in/out, dashboard aggregation, history timeline, templates and consent-gated drafts), seed templates
  and preferences.
- Client: OwnerDashboard (Stitch screen 3, period tabs, finance-aware KPIs, funnel), GuestCRMPage (ledger, filters,
  search, add guest), GuestDetailsPage (profile, consent, preferences, notes, timeline), QuickCheckInStation,
  FollowUpPanel (WhatsApp links for personal sending), GuestCard. GuestProfilePanel is folded into GuestDetailsPage.

**Phase 4 verification (24 Nov 2026 IST):** server 143/143 and client 35/35 tests passing, typecheck and build OK.
Browser check as owner: dashboard, ledger, guest profile and timeline all render from MongoDB. Fixed during the check:
- Origin was taken from the profile's first contact (often a chat), not the first booking. It now uses the earliest stay.
- The timeline showed raw dates and note categories. It now shows "14 Dec → 17 Dec 2026" and "Staff note · Food & drink".
- Seeded upcoming bookings had a future "booked at" time. The seed now caps it at the current time (re-run the seed to
  apply).

## Phase 5 — Integration ✅
WhatsApp Cloud API adapter (verify, inbound, outbound, statuses, retry, logging). Simulator fallback when creds are
missing. Notification outbox worker with WhatsApp → SMS → email fallback. Offline mutation queue for staff
workflows. End-to-end integration tests for booking → CRM → chatbot context → CRM log → dashboard.

Delivered (MVP runs in simulator mode; no Meta credentials yet):
- `modules/whatsapp`: Cloud API provider (Graph API, permanent vs retryable error codes), signed webhook (handshake,
  HMAC-SHA256 over the raw body, idempotent on `wamid`), background inbound processing with a recovery job, STOP/START
  consent keywords, media handling, delivery receipts → chat ticks, `/whatsapp/status`.
- Outbox: WhatsApp → SMS → email chain (`fallbackEmail` on booking messages); permanent errors skip retries; a late
  `failed` receipt also triggers the fallback; chat delivery status kept in sync.
- Shared `openPhoneConversation` for WhatsApp and the simulator; the guest's current/next booking is refreshed on every
  message.
- Client: offline queue for check-in, check-out and service-request updates (saved on the device, replayed on
  reconnect or every 30 s, 409 = already done) with a staff banner; Guest messaging panel in Hotel Settings with a
  go-live checklist.
- `docs/WHATSAPP-SETUP.md`: what the hotel must provide, Meta steps, `.env`, templates, go-live test.

**Phase 5 verification (24 Nov 2026 IST):** server 159/159 (15 WhatsApp + 1 end-to-end guest journey) and client
45/45 tests passing, typecheck and build OK. Simulator mode checked against the running dev server (webhook → 404
`WHATSAPP_NOT_CONFIGURED`, Guest messaging panel shows the real 7-day counts). Found and fixed:
- The app-wide NoSQL query sanitiser drops dotted keys, so Meta's `hub.mode` / `hub.verify_token` would never have
  arrived and webhook verification would fail at go-live. The handshake now reads the raw query string.
- "Check-outs today" missed guests who left early or late; it now counts by the actual check-out time.

Not yet live-tested: real Meta delivery (needs the hotel's credentials). Approved-template sending for messages outside
the 24-hour window is backlog; until then those fall back to SMS/email. SMS (MSG91) and email (SMTP) providers are still
console-only.

## Phase 6 — Hardening ✅
Security review (OWASP ASVS L1 checklist), dependency audit, performance (indexes explain, bundle size, image
sizes), responsive QA at 360/768/1280, production config (replica set, secrets, CORS, cookies), deployment docs
(Render/Railway/VM + Atlas), runbook, backup policy.

Delivered (MVP without SMS/email providers):
- **Messaging without SMS/email:** providers declare `live`, and the fallback chain skips anything that can't deliver. When
  nothing can, the message becomes a staff call task (`manualFollowUp`, booking "needs attention", dashboard card, Guest
  messaging list, "Mark called"). The env refuses `msg91`/`smtp` because they aren't implemented.
- **WhatsApp templates** for business-initiated messages (`WHATSAPP_TEMPLATES`): confirmation, cancellation, welcome and
  staff alert send their placeholder values in order. Meta-safe values (no newlines).
- **Security review** (`docs/SECURITY.md`, ASVS L1): self-service password change (other sessions revoked), owner reset of
  staff passwords, https-only production origin, token-audience separation and production config refusals, all tested in
  `security.test.ts`. `npm audit`: 0.
- **Production serving:** the API serves `client/dist` (`SERVE_CLIENT`) with a page CSP (self, Google Fonts, Razorpay,
  https images, no framing), immutable asset caching, a 404 for missing assets, and SPA fallback. Verified with the
  compiled build in the browser: no CSP violations, and sign-in/refresh work on one origin.
- **Operations:** `preflight` (config + DB + indexes + readiness, no secrets printed, also logged at startup), the
  `admin` script (create-property, reset-password), `Dockerfile`, `deploy/` (Compose with a MongoDB replica set and Caddy
  HTTPS, plus `.env.production.example`), `docs/DEPLOYMENT.md`, `docs/RUNBOOK.md` (backups, restore, incidents, DPDP,
  secret rotation).
- **Performance:** a query-plan test confirms all 16 hot queries use indexes. Guest first load is ~165 KB gzipped, and
  staff chunks load on demand.
- **Responsive QA** at 360/768/1280 on 14 routes (automated overflow measurement). Fixed: the public header overflowed at
  360 px on hotel pages, and grid columns grew with scrollable content (dashboard, Guests). A global `.grid > *
  { min-width: 0 }` rule fixes it.

**Pay-at-hotel mode (added after Phase 6):** `PAYMENT_PROVIDER=pay_at_hotel` lets the MVP go live without a payment
gateway. Website bookings are confirmed immediately (same path as staff "confirm · pay at hotel": rooms sold, guest stats,
WhatsApp confirmation with the amount due). Online payment endpoints are disabled, the booking page says "No online payment
needed" and skips the payment step, and the confirmation page shows what to pay at the hotel. Anti-abuse cap: 3 upcoming
unpaid bookings per phone. New **no-show** action (booking details and the check-in dialog) releases tonight's and later
nights. Copy that claimed "UPI checkout" was made true in both modes. Tests: server 8 new (205 total), client 2 new (52 total).

**Phase 6 verification (24 Nov 2026 IST):** server 197/197 and client 50/50 tests, typecheck and build OK. The compiled
server serving the built client was smoke-tested on a spare port (headers, deep links, caching, API 404s, sign-in).
**Not verified:** `docker build` (Docker Desktop was not running on this machine) and a real production deploy.
