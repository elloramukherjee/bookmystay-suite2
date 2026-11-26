# Database Design — MongoDB / Mongoose

Conventions:
- Every hotel-owned collection has `hotelId: ObjectId` (required, indexed, first key of compound indexes).
- `timestamps: true` on all schemas (`createdAt`, `updatedAt`).
- Money is **integer paise** (`₹4,800.00` → `480000`). Field names end in `Paise` where ambiguous.
- Stay dates are hotel-local `YYYY-MM-DD` strings (`checkIn`, `checkOut`, `Availability.date`).
- Phones are normalised to E.164 (`+919820144552`) by `utils/phone.ts` before every read and write.
- `toJSON` transforms strip `passwordHash`, `__v`, and internal token fields.

Status (✅ = implemented in the current phase):

| Collection | Phase |
|---|---|
| hotels ✅, users ✅, refreshtokens ✅, auditlogs ✅ | 1 |
| roomtypes ✅, rooms ✅, rateplans ✅, availabilities ✅, bookings ✅, payments ✅, hotelpolicies ✅ | 2 |
| guests ✅, guestpreferences ✅ (schema), notifications ✅ (outbox) | 2 |
| conversations ✅, chatmessages ✅, servicerequests ✅, hotelfaqs ✅ | 3 |
| messagetemplates ✅, followups ✅ (guest notes, preferences and stay timestamps in use) | 4 |
| whatsappmessages ✅, notifications ✅ (fallback chain) | 5 |

---

## Hotel
```
{ _id, name, slug (unique), tagline, story, starRating, verified: bool,
  address: { line1, line2, city, state, pincode, country:"IN", geo:{lat,lng} },
  contact: { phone, whatsapp, email },
  gstin, timezone: "Asia/Kolkata", currency: "INR", totalRooms,
  checkInTime: "13:00", checkOutTime: "11:00",
  photos: [{ url, alt, caption, isHero }],
  amenities: [string], highlights: [{ label, value }],
  reviews: [{ author, city, rating, text, stayedAt, roomTypeName, source:"direct"|"google"|"ota", savedPaise }],
  modules: { booking: bool, receptionist: bool, crm: bool },
  settings: {
    directDiscountPercent: 10, otaCommissionRate: 18, holdMinutes: 15,
    taxSlabs: [{ upToPaise: 100000, ratePercent: 0 }, { upToPaise: 750000, ratePercent: 5 }, { upToPaise: null, ratePercent: 18 }],
    promoCodes: [{ code, percentOff, active, validUntil }],
    freeCancellationHours: 48
  },
  integrations: { whatsappConfigured: bool, paymentProvider: "mock"|"razorpay"|..., smsProvider },
  status: "active"|"suspended" }
```
Indexes: `{ slug: 1 }` unique, `{ status: 1 }`.

## User (staff accounts)
```
{ _id, hotelId (null only for super_admin), name, email (lowercase), phone, passwordHash,
  role: "super_admin"|"owner"|"manager"|"front_desk", isActive, tokenVersion: number,
  lastLoginAt, failedLoginCount, lockedUntil, createdBy }
```
Indexes: `{ email: 1 }` unique, `{ hotelId: 1, role: 1 }`.
`tokenVersion` is incremented when a user is deactivated, has a role change or a password change. Outstanding
access tokens are then rejected.

## RefreshToken
```
{ _id, userId, hotelId, tokenHash (sha256), familyId, expiresAt, revokedAt, replacedBy, userAgent, ipHash }
```
Indexes: `{ tokenHash: 1 }` unique, `{ familyId: 1 }`, `{ expiresAt: 1 }` TTL (`expireAfterSeconds: 0`).

## AuditLog
```
{ _id, hotelId, actor: { type:"user"|"guest"|"system"|"ai", id, role }, action: "auth.login", entity: { type, id },
  metadata: {}, ipHash, requestId, createdAt }
```
Indexes: `{ hotelId: 1, createdAt: -1 }`, `{ hotelId: 1, "entity.type": 1, "entity.id": 1 }`,
`{ createdAt: 1 }` TTL 400 days (configurable).

## Guest (unified identity)
```
{ _id, hotelId, phoneE164, phoneDisplay, name, email?, city?,
  source: "direct"|"ota_mmt"|"ota_goibibo"|"ota_bookingcom"|"ota_agoda"|"walk_in"|"chat"|"manual",
  firstSource, tags: [string], notes: [{ text, category: "room"|"fnb"|"general", authorId, createdAt }],
  stats: { totalBookings, completedStays, directBookings, otaBookings, lifetimeValuePaise,
           commissionSavedPaise, lastStayAt, firstStayAt },
  isReturning (derived: completedStays ≥ 1),
  consent: { transactional: { granted, at, source }, marketing: { granted, at, source, withdrawnAt } },
  idVerification: { verified: bool, docType?: "aadhaar"|"passport"|"dl"|"voter", verifiedAt, verifiedBy },
  privacy: { erasureRequestedAt, anonymisedAt } }
```
Indexes: `{ hotelId: 1, phoneE164: 1 }` **unique**, `{ hotelId: 1, "stats.lastStayAt": -1 }`,
`{ hotelId: 1, name: "text", email: "text", phoneE164: "text" }` (guest search), `{ hotelId: 1, source: 1 }`.

## GuestPreference
```
{ _id, hotelId, guestId, category: "room"|"fnb"|"accessibility"|"communication"|"other", key, value,
  source: "staff"|"chat"|"booking", confidence, createdBy }
```
Indexes: `{ hotelId: 1, guestId: 1, category: 1, key: 1 }` unique.

## RoomType
```
{ _id, hotelId, name, slug, description, sizeSqft, maxAdults, maxChildren, maxOccupancy, bedType,
  view, amenities: [string], photos: [{url, alt}], tags: [string], directPrivilege,
  baseRatePaise, otaRatePaise (for comparison display), totalRooms (derived from Room count), isActive, sortOrder }
```
Indexes: `{ hotelId: 1, slug: 1 }` unique, `{ hotelId: 1, isActive: 1, sortOrder: 1 }`.

## Room (physical)
```
{ _id, hotelId, roomTypeId, number: "108", floor, status: "available"|"occupied"|"cleaning"|"maintenance"|"out_of_order", isActive }
```
Indexes: `{ hotelId: 1, number: 1 }` unique, `{ hotelId: 1, roomTypeId: 1, status: 1 }`.

## RatePlan
```
{ _id, hotelId, roomTypeId, name: "Room Only"|"Bed & Breakfast", code, mealPlan: "EP"|"CP"|"MAP"|"AP",
  adjustmentPaise (added to night rate), refundable: bool, isDefault, isActive }
```
Indexes: `{ hotelId: 1, roomTypeId: 1, code: 1 }` unique.

## Availability (inventory per night)
```
{ _id, hotelId, roomTypeId, date: "2026-12-24", totalRooms, sold, held, blocked, ratePaise (override or null), stopSell, minStay }
```
Indexes: `{ hotelId: 1, roomTypeId: 1, date: 1 }` **unique**, `{ hotelId: 1, date: 1 }`.
Invariant: `sold + held + blocked ≤ totalRooms`. It is enforced by a guarded update:
```
updateOne({ _id, stopSell: false, $expr: { $lte: [ { $add: ["$sold","$held","$blocked", qty] }, "$totalRooms" ] } },
          { $inc: { held: qty } })
```
`matchedCount === 0` means the night is unavailable. The service then compensates any previous nights and
returns 409. Documents are lazily created (upsert) from `RoomType.totalRooms` and `baseRatePaise` for dates that
are not yet initialised.

## Booking
```
{ _id, hotelId, reference: "BMS-7K3Q9P" (unique), guestId, guestSnapshot: { name, phoneE164, email },
  roomTypeId, ratePlanId, roomId? (assigned at check-in), quantity, adults, children,
  checkIn, checkOut, nights,
  source: "direct"|"ota_*"|"walk_in"|"phone",
  status: "pending_payment"|"confirmed"|"checked_in"|"checked_out"|"cancelled"|"expired"|"no_show",
  paymentStatus: "unpaid"|"pending"|"paid"|"pay_at_hotel"|"collected_by_ota"|"refund_pending"|"refunded"|"provider_unavailable",
  inventoryState: "held"|"sold"|"released", refundDuePaise, needsAttention (staff flag), otaReference, createdBy,
  amounts: { nightly: [{date, ratePaise}], subtotalPaise, directDiscountPaise, promoDiscountPaise, promoCode,
             taxablePaise, taxRatePercent, taxPaise, totalPaise, otaEquivalentPaise },
  holdExpiresAt, confirmedAt, cancelledAt, cancellationReason, checkedInAt, checkedOutAt, checkedInBy,
  specialRequests, consentSnapshot, idempotencyKey }
```
Indexes: `{ reference: 1 }` unique, `{ hotelId: 1, status: 1, checkIn: 1 }`, `{ hotelId: 1, guestId: 1, checkIn: -1 }`,
`{ hotelId: 1, checkOut: 1 }`, `{ status: 1, holdExpiresAt: 1 }` (sweeper),
`{ hotelId: 1, idempotencyKey: 1 }` unique (partial: idempotencyKey exists).

## Payment
```
{ _id, hotelId, bookingId, provider: "mock"|"razorpay"|..., method: "upi"|"card"|"netbanking",
  providerOrderId, providerPaymentId, amountPaise, currency, status: "created"|"pending"|"captured"|"failed"|"refunded",
  events: [{ providerEventId, type, receivedAt, raw (redacted) }], failureReason }
```
Indexes: `{ hotelId: 1, bookingId: 1 }`, `{ provider: 1, providerOrderId: 1 }` unique,
`{ "events.providerEventId": 1 }` (idempotency lookup).

## HotelPolicy / HotelFAQ
```
HotelPolicy { _id, hotelId, type: "cancellation"|"checkin"|"pets"|"parking"|"smoking"|"children"|"payment"|"id_proof"|"other",
              title, body, structured: {}, published }
HotelFAQ    { _id, hotelId, question, answer, category, keywords: [string], published, sortOrder }
```
Indexes: `{ hotelId: 1, type: 1 }` unique for policy. `{ hotelId: 1, published: 1, category: 1 }` and a text
index on question, answer and keywords for FAQ.

## Conversation / ChatMessage
```
Conversation { _id, hotelId, guestId?, bookingId? (authorised context), channel: "web"|"whatsapp"|"simulator",
               channelUserId (wa phone or web session id),
               status: "ai_active"|"escalated"|"staff_active"|"resolved",
               escalation: { reason, category: "complaint"|"safety"|"medical"|"payment_dispute"|"refund"|"negative_sentiment"|"unknown_fact",
                             at, by:"ai"|"rule"|"staff" },
               assignedTo, takenOverAt, resolvedAt, lastMessageAt, lastMessagePreview, unreadForStaff, messageCount }
ChatMessage  { _id, hotelId, conversationId, sender: "guest"|"ai"|"staff"|"system", staffId?, text,
               latencyMs?, toolCalls: [{ name, args, ok }], deliveryStatus (whatsapp), waMessageId }
```
Indexes: `{ hotelId: 1, status: 1, lastMessageAt: -1 }`, `{ hotelId: 1, guestId: 1, lastMessageAt: -1 }`,
`{ hotelId: 1, channel: 1, channelUserId: 1, status: 1 }`, and `{ conversationId: 1, createdAt: 1 }` for messages.

## ServiceRequest
```
{ _id, hotelId, guestId, bookingId, conversationId, roomNumber, type: "housekeeping"|"towels"|"extra_bed"|"late_checkout"|"maintenance"|"food"|"other",
  details, status: "open"|"acknowledged"|"done"|"declined", createdBy: "ai"|"staff", handledBy, completedAt }
```
Indexes: `{ hotelId: 1, status: 1, createdAt: -1 }`.

## Notification (outbox)
```
{ _id, hotelId, channel: "whatsapp"|"sms"|"email", to, template, payload, relatedEntity,
  status: "queued"|"sending"|"sent"|"simulated"|"failed"|"dead", attempts, nextAttemptAt, lastError, providerMessageId,
  fallbackChannel: "sms"|"email"|null, fallbackEmail, templateParams: [string] | null,
  manualFollowUp: { required, reason, resolvedAt, resolvedBy } | null }
```
Indexes: `{ status: 1, nextAttemptAt: 1 }`, `{ hotelId: 1, createdAt: -1 }`, `{ relatedEntity.type: 1, relatedEntity.id: 1 }`,
`{ providerMessageId: 1 }` (delivery receipts).
Chain: WhatsApp → SMS (same number) → email (`fallbackEmail`). A row goes `dead` after 5 attempts, on a permanent
provider error, or on a WhatsApp `failed` receipt. Only then is the next channel **with a real provider** queued. If
there is none (this version has no SMS/email gateway), `manualFollowUp` is set and the booking gets a "please call the
guest" note. Index `{ hotelId, manualFollowUp.required, manualFollowUp.resolvedAt }` serves the "guests to call" list.

## WhatsAppMessage (raw channel log)
```
{ _id, hotelId, direction: "in"|"out", waMessageId (unique), phoneNumberId, phoneE164, type, text, profileName,
  status: in → "received"|"processing"|"processed"|"ignored"|"failed"; out → "sent"|"delivered"|"read"|"failed",
  statusHistory: [{ status, at, error }], conversationId, notificationId, error, attempts }
```
Indexes: `{ waMessageId: 1 }` unique (webhook redelivery is idempotent), `{ direction: 1, status: 1, updatedAt: 1 }`
(recovery job), `{ hotelId: 1, createdAt: -1 }`. Inbound rows are the durable work queue: a message acknowledged to
Meta is processed even if the API restarts first.

## MessageTemplate / FollowUp (personal follow-ups)
```
MessageTemplate { _id, hotelId, name, body (placeholders {{firstName}} {{hotelName}} {{code}}),
  purpose: "thank_you"|"festival_offer"|"reunion"|"feedback"|"other", promoCode?, metaTemplateName?,
  metaApproved: bool (reset when the body is edited), isActive }
FollowUp { _id, hotelId, templateId, guestId, text (rendered), status: "draft"|"sent_personally"|"sent_api"|"discarded",
  createdBy, sentAt }
```
Indexes: MessageTemplate `{ hotelId: 1, isActive: 1, name: 1 }`; FollowUp `{ hotelId: 1, guestId: 1, createdAt: -1 }`,
`{ hotelId: 1, status: 1, sentAt: -1 }`. Drafts are created only for guests with current marketing consent, and consent
is re-checked when a draft is marked sent. Owners send them from their own WhatsApp; nothing is broadcast.

Check-in/out uses existing fields: `Booking.checkedInAt / checkedOutAt / roomId / roomNumber / idVerification { verified,
docType }` (the ID number is never stored), `Room.status` (occupied → cleaning on check-out) and `Guest.stats`
(`completedStays`, `firstStayAt`, `lastStayAt`).

## Transactions

`database/transaction.ts` exports `withTransaction(fn)`. It detects replica-set support once at boot
(`hello.setName`) and runs `fn(session)` in `session.withTransaction()` when supported. Otherwise it runs
`fn(undefined)`, and correctness relies on the guarded atomic inventory updates plus compensation. Production
**must** run a replica set. The startup log warns when transactions are unavailable.
