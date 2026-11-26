# PRD Analysis — BookMyStay Suite MVP

Sources inspected:

| Source | Role |
|---|---|
| `BookMyStay_Suite_MVP_PRD.pdf` (updated 23 Nov 2026) | Functional source of truth |
| `stitch_bookmystay_hospitality_suite.zip` → `modern_indian_boutique_hospitality/DESIGN.md` | Design tokens and component rules |
| `bookmystay_direct_booking_upi_checkout/` (code.html + screen.png) | Module A reference screen |
| `ai_receptionist_staff_takeover_desk/` (code.html + screen.png) | Module B reference screen |
| `hotel_guest_crm_owner_revenue_dashboard/` (code.html + screen.png) | Module C reference screen |
| `bookmystay.html` | Generic "Explore stays" landing mock (illustrative prices, no live availability) |

The master development prompt adds engineering requirements (stack, RBAC, schemas, API list). Where it goes
beyond the PRD (for example, WhatsApp broadcast templates), the PRD's MVP intent wins: the feature is built as a
safe, consent-gated draft/personal-send workflow, not an automated mass-messaging engine.

---

## 1. PRD summary

**Problem.** Independent Indian hotels (10–60 rooms) pay OTAs 15–25% commission on nearly every booking. They
have no direct booking channel guests trust, can't answer guest questions at WhatsApp speed, and lose guest
history whenever staff turn over.

**MVP goal.** Ship the smallest version of three products that lets a pilot hotel:
1. take a **direct booking**,
2. handle **routine guest questions** without pulling staff off the desk,
3. keep a **usable guest record across stays**.

The aim is to prove the direct-vs-OTA value loop.

### Target users

| User | Context | Design implication |
|---|---|---|
| Owner / manager | 1–3 properties, multitasking, phone-first | Every owner action works on a phone, in under 2 minutes |
| Front desk / reservations | Young, variable English, high turnover | Learnable in under 15 minutes, no manual. Works on a shared terminal |
| Guest (direct booker) | Domestic leisure/business, NRI, compares with OTA | Mobile-first, fast on 3G/4G, trust signals, UPI first |
| Guest (in-stay) | Already checked in | Requests handled without calling the desk |

### Module A — BookMyStay (booking website)

| PRD feature | Engineering translation |
|---|---|
| Live rates & availability; owner updates from phone in <2 min | `RoomType`, `RatePlan`, `Availability` (one document per room type per night). Mobile rates/availability editor |
| Direct booking flow, as few steps as an OTA | Dates → room → guest details → review/price → pay → confirm. Mobile has a sticky footer CTA |
| UPI-first payments | `PaymentProvider` adapter. UPI intent/QR shown first, card/netbanking second. Dev mock provider is clearly labelled |
| Trust builders | Verified badge, real photos (hotel gallery), reviews/ratings (curated reviews stored on hotel), cancellation policy on room and review pages |
| Confirmation via WhatsApp/SMS | `Notification` outbox with WhatsApp → SMS → email fallback. Booking stays confirmed even if delivery fails |
| Mobile-first, low bandwidth | Code-split routes, responsive `srcset`-friendly images, no heavy UI kits, cached queries |
| Simple owner admin | Room/rate/photo management pages inside the owner app |
| *NFR:* degrade gracefully if gateway/SMS down | Booking persisted as `pending_payment` before the gateway call. Webhook reconciliation is idempotent. Notifications are retried from the outbox |

### Module B — AI Receptionist

| PRD feature | Engineering translation |
|---|---|
| WhatsApp + web chat | One conversation engine, two channel adapters: web widget and WhatsApp Cloud API webhook |
| Pre-arrival FAQ | Grounded on `HotelFAQ` + `HotelPolicy` + hotel profile from MongoDB |
| In-stay requests | Gemini function-calling creates `ServiceRequest` records. The bot only confirms after the DB write succeeds |
| Human escalation with context handoff | Conversation status `escalated` pauses the AI. Staff see the transcript, guest profile and booking |
| Staff takeover interface | Mobile-friendly receptionist desk (Stitch screen 2) |
| Code-switching (English/Hindi mix) | Gemini handles Hinglish input natively. The system prompt says to reply in the guest's language mix. Full regional-language UI is Phase 2 per PRD §8 |
| Sensitive-topic detection | Two layers: a deterministic keyword/regex pre-filter (instant, no LLM needed), then a Gemini classification in the same call. Either one escalates immediately, with no bot looping |
| Conversation logging into CRM | `Conversation` and `ChatMessage` link to `guestId`, so the guest timeline includes chats |
| *NFR:* WhatsApp-fast | Fast model (`GEMINI_MODEL`, default flash tier), compact grounding context, timeout with "connecting you to staff" fallback |
| *NFR:* never wrong on check-in time or pricing | Prices and availability come from tool calls into the pricing service, never from model memory. If data is missing the bot says "let me check with staff" |

### Module C — Guest CRM

| PRD feature | Engineering translation |
|---|---|
| Unified guest profile | `Guest` keyed by `(hotelId, phoneE164)`. Built from bookings, chat and manual entry |
| Low-friction check-in/out | Quick check-in station: search by phone or room, then one tap. Optional ID-verified flag |
| Informal contact data | Phone required, email optional, name optional at chat-first contact |
| Repeat-guest flagging | `stats.completedStays` ≥ 1 → "Returning guest" badge in booking, check-in and chat views |
| Owner-friendly dashboard | Plain-language metrics computed by MongoDB aggregations. Nothing hardcoded |
| Direct follow-up drafts | Pre-approved templates, draft per guest, owner sends personally (`wa.me` deep link) or via Cloud API when configured and consented |
| *NFR:* no separate "CRM work" | The CRM is a by-product of booking, check-in and chat. No standalone data-entry chores |
| *NFR:* survives staff turnover | All notes and preferences live in the DB with author and timestamp |
| *NFR:* no CRM jargon | UI copy says "Returning guests", "Booked direct", not "segments" or "lifecycle" |

### Cross-product integration (PRD §6)

- **Single identity:** the WhatsApp-linked phone number, normalized to E.164 (`+91XXXXXXXXXX`), unique per hotel.
- **Flow:** booking → guest upsert → CRM → chatbot reads context → chat logs back into CRM → dashboard reads from the CRM.
- **Standalone:** each module is gated by `hotel.modules.{booking,receptionist,crm}` flags. Shared services
  (`guestIdentity`, `auditLog`, `conversationLog`) work whichever modules are enabled.

### Success metrics we must be able to compute (PRD §7)

| Metric | Source |
|---|---|
| % bookings direct vs OTA | `Booking.source` |
| OTA commission saved (₹) | Σ direct booking revenue × `hotel.settings.otaCommissionRate` |
| Conversion / abandonment | `Booking.status` funnel (`held` → `pending_payment` → `confirmed` / `expired`) |
| % queries resolved without staff | Conversations closed without `escalatedAt` |
| Avg response time | `ChatMessage.latencyMs` |
| Repeat-direct-booking rate | Guests with ≥2 direct bookings ÷ guests with ≥1 |
| % guests with captured contact | Guests with phone (always) / email / consent flags |
| Staff adoption | `AuditLog` entries per staff per week |

### Explicitly out of scope (PRD §9) — will not be built

Multilingual guest UI, abandoned-booking recovery, AI dynamic pricing, voice notes, proactive messaging
(pre-arrival reminders and post-checkout offers), guest segmentation, data-export tooling, multi-property rollup,
loyalty and packages.

> **Conflict note:** The master prompt asks for "WhatsApp campaign functionality". PRD §9 defers proactive
> messaging and segmentation. **Resolution:** build the PRD's "Direct follow-up message drafts". The owner picks a
> pre-approved template, the system prepares a draft per guest, and the owner sends it personally. A Cloud API send
> is allowed only for guests with recorded marketing consent and only through an approved template. There are no
> scheduled or automatic blasts.

---

## 2. Stitch design summary

### Global design system (DESIGN.md)
- **Voice:** "Modern Indian boutique hospitality", organic minimalism with tactile warmth. Haveli and plantation-retreat feel.
- **Colors:** Forest `#1D3327` (primary actions and nav), Terracotta `#C25E38` (accents, deals, urgency), UPI Purple
  `#5F259F` (used **only** for payment UI), Emerald `#15803D` (verified, WhatsApp, confirmations), parchment
  `#FAF8F4` / `#F4F1EA` canvas, white cards with `#E5E0D8` borders, neutrals `#4A5A50 / #718077`.
- **Type:** Noto Serif for headings, hotel names and room names. Plus Jakarta Sans for body text and **all
  numerals and prices**. Uppercase only for `label-sm` metadata.
- **Shape:** Cards are 8px radius. Bottom sheets and modals use 24px top corners. Buttons and badges are full pills.
  Inputs are 48px tall with a 1.5px border.
- **Depth:** Tinted ambient shadow `0 8px 24px -4px rgba(29,51,39,.08)`. Modal backdrop is forest at 45% with a 4px blur.
- **Mobile:** 16px gutters, an 80px safe area for the sticky checkout bar, and a 4-tab bottom navigation
  (Explore, My Stays, Concierge, Account).

### Shared chrome (all three screens)
A forest **announcement strip** (commission status, UPI note, cluster pill) sits above a white **header**. The header
holds the logo and suite tagline, the hotel name with room count and direct share, **three module pill tabs** (the
active tab is a filled forest pill), a forest "WhatsApp Direct Hotline" pill and the user avatar with role. The
**footer** shows the suite name, copyright, UPI/GST badges and "Commission saved this month".

### Screen 1 — Direct Booking Engine + UPI checkout
- **Hero:** rating chip with verified-stays count, location tag, serif headline, story paragraph, a 4-up perks strip
  (arrival perk, checkout time, payment mode, voucher speed), a photo card ("The Central Chattris") and a
  commission-reinvested card.
- **Search bar:** check-in, check-out (with night count), guests and rooms, a direct promo code (with an "x% off"
  chip) and a "Check Live Haveli Rates" CTA.
- **Filter pills** by room type, and an urgency notice.
- **Room cards:** image with tags (view, "Only N left", "Save ₹X Direct"), serif name, size and features line,
  struck-out OTA price beside the direct price per night, amenity chips, a "Direct Privilege" strip and
  "Select & Proceed" / "Host Chat" actions.
- **Sticky reservation panel:** step 1 is guest details (WhatsApp number marked as the voucher channel, and name),
  followed by the price matrix (base × nights, GST line, promo discount, waived convenience fee, net total, "₹X lower
  than OTA" chip). Step 2 is a UPI tile grid (GPay, PhonePe, Paytm, Any UPI) with card/netbanking as secondary, the
  pay CTA and a refund-policy note.
- **Comparison table:** direct vs MakeMyTrip/Agoda vs Booking.com.
- **Testimonials** with a "Direct Guest" badge and the amount saved.

### Screen 2 — AI Receptionist & Staff Takeover Desk
- **Offline banner** (terracotta) that shows queued items and a reconnect action.
- **Hub header:** "AI Concierge & Staff Dispatch Hub", gateway number, "live hybrid desk" pill, a sensitive-escalation
  counter and a "Simulate Incoming Query" button.
- **KPI row:** automated resolution rate, average AI latency, conversations in flight, staff intervention queue.
- **Left column, guest view simulator:** WhatsApp-style chat (dark forest header, guest bubbles on the right,
  AI bubbles on the left labelled "AI Concierge (2.1s response)") with quick-prompt chips and a composer.
- **Right column, staff takeover console:** conversation cards (room, guest, last action, status badge "AI Handled"
  or "Staff Alert"), a paused-autopilot alert with the trigger reason, the guest context card (repeat badge, room,
  WhatsApp, booking source, "Call on WhatsApp"), the transcript excerpt, the guardrail routing notice,
  "1-click interventions", a reply composer and "Send to Guest / Resolve & Resume AI".

### Screen 3 — Guest CRM & Owner Revenue Dashboard
- **Offline banner** (checks-ins cached locally, retry).
- **Desk header:** hotel and shift, today's roster (check-ins and check-outs), in-house occupancy and a phone auto-fill search.
- **4 KPI cards:** direct savings ledger (commission saved), direct booking share (a stacked bar direct / MMT /
  Booking.com), repeat guest retention, unified database (contact count).
- **Guest Intelligence Ledger:** filter tabs (All, Repeat Direct, OTA-Converts) and a table with guest and contact,
  loyalty tier and origin, stay path and commission saved, key preference and a quick action. Pagination.
- **Guest profile panel:** conversion track record, host notes and preferences, recent AI touchpoints.
- **10-second quick check-in station:** room badge, guest, auto-identified badge, "Confirm Check-in & Hand Key".
- **WhatsApp follow-up panel:** pre-approved template radio list, a DPDP consent notice, estimated cost and the send CTA.
- **OTA → direct migration funnel:** 4 steps.

> All numbers in the mockups (₹84,600, 48%, 1,240, and so on) are illustrative. The implementation computes every
> figure from MongoDB.

---

## 3. Missing business decisions and risks

| # | Gap / risk | Decision (configurable, documented) |
|---|---|---|
| 1 | **Payment gateway** not chosen (PRD §10) | `PaymentProvider` interface. `mock` provider for development only, blocked when `NODE_ENV=production`. Razorpay/Cashfree adapter is the slot to fill once a gateway contract is signed |
| 2 | **SMS provider** not chosen. Indian SMS requires DLT template registration | `SmsProvider` interface with a `console` dev provider. Production needs DLT-registered templates |
| 3 | **GST slabs.** Hotel GST changed in Sept 2025 (≤₹7,500/night: 5% without ITC, >₹7,500: 18%) | Tax slabs stored per hotel in `settings.taxSlabs`. Defaults reflect the post-Sept-2025 slabs. **Needs CA verification** |
| 4 | Direct-booking discount size | `settings.directDiscountPercent` (default 10%) |
| 5 | OTA commission rate for "savings" | `settings.otaCommissionRate` (default 18%, midpoint of the PRD's 15–25%) |
| 6 | Hold duration for unpaid bookings | `settings.holdMinutes` (default 15). A sweeper job expires holds and releases inventory |
| 7 | Cancellation and refund policy | A `HotelPolicy` record of type `cancellation` with `freeCancellationHours` (default 48) |
| 8 | Guest authentication (guests have no passwords) | Booking lookup uses **reference + phone**. The chat unlocks booking context only after the reference and phone match, or the WhatsApp sender phone matches the booking. OTP verification is listed as a hardening item |
| 9 | Reviews / ratings source (PRD §10 trust question) | Curated, owner-entered reviews tied to real bookings where possible. No fake review generation. Google/TripAdvisor integration is out of scope |
| 10 | Chatbot error tolerance unknown | Conservative defaults: escalate on any missing fact, confidence below threshold, or two consecutive "I don't know" replies |
| 11 | **DPDP Act 2023 compliance** | Consent flags (transactional vs marketing) captured at booking and chat start. Purpose notice, data minimisation, staff access audit log, erasure-request workflow stub. **Legal review required** (see ARCHITECTURE.md §Security) |
| 12 | WhatsApp templates require Meta approval | Template records carry `metaTemplateName` and `approved` flag. Unapproved templates can only be used for personal sends |
| 13 | Low/variable connectivity at the property | Staff app uses TanStack Query persistence and an offline mutation queue for check-in/out and replies, with an explicit offline banner (matches Stitch) |
| 14 | Concurrency / double booking | Per-night `Availability` documents with guarded atomic `$inc`. Transactions are used when the deployment is a replica set |
| 15 | OTA bookings entering the system | MVP: manual entry of OTA bookings by staff (source = `ota_mmt`, `ota_bookingcom`, ...). Channel-manager sync is out of scope |
| 16 | Room-level vs type-level inventory | Inventory is sold at room-type level. A physical room is assigned at check-in (quick check-in picks a free room) |
| 17 | Gemini outage / latency | 8s timeout, then a canned "connecting you with our team" reply plus escalation flag. The guest is never left hanging |
| 18 | Money precision | All amounts are stored as integer **paise**. Rounding happens once, at the line-item level |
| 19 | Time zone | Property-local dates (`Asia/Kolkata` default per hotel). Stay nights are stored as `YYYY-MM-DD` strings to avoid UTC drift |

### Requirements traceability

Each PRD row above maps to a phase in `IMPLEMENTATION-PLAN.md`. Nothing is silently dropped. Deferred items are
listed in the "out of scope" section with the PRD reference.
