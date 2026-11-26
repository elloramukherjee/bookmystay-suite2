# BookMyStay Suite

BookMyStay Suite gives independent Indian hotels (10–60 rooms) three connected products:

- **BookMyStay**: a direct-booking site
- **AI Receptionist**: Gemini answers over WhatsApp and web chat, and hands off to staff
- **Guest CRM**: a guest register keyed by phone number

> **Status: all six phases complete — MVP ready to deploy.** It can run without a payment gateway (`PAYMENT_PROVIDER=pay_at_hotel`). WhatsApp is in simulator mode until Meta credentials are added, and there is no SMS/email gateway in this version. Phase 1 delivered auth, RBAC, property isolation, settings, staff and the
> responsive shell. Phase 2 adds:
>
> - the full guest funnel (search -> room -> details -> UPI payment -> confirmation -> find my booking)
> - server-side GST pricing and inventory that can't be double-booked
> - a mock/Razorpay payment adapter with signed webhooks and a WhatsApp/SMS notification outbox
> - staff screens for rooms, rates & availability, and bookings
>
> Phase 3 adds the Gemini AI receptionist:
>
> - grounded on your FAQs and policies, with live prices via tools
> - a safety pre-filter that escalates sensitive chats to staff
> - staff takeover, a WhatsApp-style simulator, guest web chat and a knowledge-base editor
>
> Phase 4 adds the Guest CRM:
>
> - an owner dashboard with commission saved, direct share, repeat guests and the OTA → direct funnel (all from MongoDB)
> - a guest ledger with search by phone, room, name or reference, and guest profiles with preferences, notes and history
> - 10-second check-in/out with room assignment, and consent-gated follow-up messages sent from your own WhatsApp
>
> Phase 5 adds the integration layer:
>
> - a WhatsApp Cloud API adapter with a signed webhook. It runs in simulator mode until credentials are added
>   (see [`docs/WHATSAPP-SETUP.md`](docs/WHATSAPP-SETUP.md))
> - a WhatsApp → SMS → email fallback chain, plus delivery ticks in the Concierge Desk
> - an offline queue for front-desk actions
> - an end-to-end test of the guest journey across all three products
>
> Phase 6 hardens it for production:
>
> - a security review against ASVS Level 1 ([`docs/SECURITY.md`](docs/SECURITY.md)), with password change and reset added
> - one deployable service serving the web app with a strict CSP, a Dockerfile, and Compose with MongoDB and HTTPS
>   ([`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md))
> - an operations runbook with backups and incident handling ([`docs/RUNBOOK.md`](docs/RUNBOOK.md)), plus `preflight` and `admin` scripts
> - guests that no message channel can reach become staff call tasks instead of being silently dropped

## Stack

| | |
|---|---|
| Client | React 19, Vite 8, TypeScript, Tailwind CSS v4, React Router, TanStack Query, Axios, React Hook Form, Zod, Lucide |
| Server | Node.js ≥ 20.11, Express 5, TypeScript, MongoDB + Mongoose 8, JWT, bcrypt, Zod, pino |
| Tests | Vitest, React Testing Library, Supertest, mongodb-memory-server (replica set) |

## Quick start (development)

Prerequisites: Node.js 20.11+ and MongoDB 7+ running locally (or a `MONGODB_URI` to Atlas).

```bash
npm install            # installs both workspaces
npm run setup:env      # creates .env with random JWT secrets (never overwrites an existing .env)
npm run seed           # sample Jaipur heritage hotel + 4 staff accounts; prints a generated password
npm run dev            # API on http://localhost:4000, web on http://localhost:5173
```

- Suite landing: http://localhost:5173/ - property page: `/h/heritage-courtyard-jaipur` - find my booking: `/my-booking`
- Staff desk: http://localhost:5173/login

Seeded accounts (password printed by `npm run seed`, or set `SEED_DEFAULT_PASSWORD` in `.env` before seeding):

| Role | Email |
|---|---|
| Owner & GM | `owner@heritagecourtyard.example` |
| Manager | `manager@heritagecourtyard.example` |
| Front desk | `frontdesk@heritagecourtyard.example` |
| Platform admin | `support@bookmystay.example` |

`npm run seed -- --reset` drops and re-seeds the dev database. Seeding is refused when `NODE_ENV=production`.

### Other commands

```bash
npm test               # server (205) + client (52) tests
npm run typecheck      # both workspaces
npm run format         # prettier (format:check for CI)
npm run build          # server → server/dist, client → client/dist
npm run dev:server     # API only (tsx watch)
npm run dev:client     # web only (proxies /api → :4000)
```

## Configuration

All configuration is environment-based and validated at boot (`server/src/config/env.ts`). See [`.env.example`](.env.example).

- The server **refuses to start** in production with placeholder or identical JWT secrets, the mock payment provider,
  a default IP-hash salt, or a localhost `CLIENT_URL`.
- Gemini, WhatsApp and payment keys are **server-only**. The React app never receives them. Integration status is
  shown in Hotel Settings as connected or not connected, never as values.
- Without WhatsApp credentials, use the Concierge desk's **Simulate incoming query** (a WhatsApp-style simulator).
- Without a Gemini key, chats go straight to staff with a holding reply. Nothing pretends to be connected.
- Gemini settings:
  - `GEMINI_MODEL` (default `gemini-3.8-flash`)
  - `GEMINI_FALLBACK_MODEL` (used for the single retry on overload)
  - `GEMINI_THINKING_LEVEL` (`LOW` recommended for chat speed)
  - `GEMINI_TIMEOUT_MS` (default 12000; after this the chat goes to staff)

### Payments in development

`PAYMENT_PROVIDER=mock` is a clearly labelled **development** provider: no money moves. The payment page shows a
"DEVELOPMENT MODE" panel with *Simulate successful payment / failure* buttons, which post a signed webhook through the same
pipeline production uses.

For Razorpay:
1. Set `PAYMENT_PROVIDER=razorpay`, `PAYMENT_GATEWAY_KEY`, `PAYMENT_GATEWAY_SECRET` and `PAYMENT_WEBHOOK_SECRET`.
2. Point the Razorpay webhook at `https://<api>/api/v1/payments/webhook`.

The seed data includes 12 sample bookings (past stays, today's arrivals, an in-house guest and upcoming stays), so every screen
has real data. `npm run seed -- --reset` restores the original sample data.

### MongoDB transactions

Local standalone MongoDB works for development: inventory safety relies on guarded atomic updates. The API logs a
warning at startup. **Production must use a replica set** (e.g. Atlas) so multi-document transactions are available.
Tests always run against an in-memory replica set.

## Project layout

```
client/   React SPA (components/, layouts/, pages/, routes/, services/, context/, hooks/)
server/   Express API (config/, middleware/, modules/<name>/{model,service,controller,routes,validation,__tests__})
docs/     PRD analysis, architecture, database design, API reference, implementation plan
scripts/  setup-env
```

## Documentation

- [PRD analysis, Stitch design summary, open decisions](docs/PRD-ANALYSIS.md)
- [Architecture, security & DPDP notes](docs/ARCHITECTURE.md)
- [Database design](docs/DATABASE-DESIGN.md)
- [API reference](docs/API-DOCUMENTATION.md)
- [Implementation plan & phase status](docs/IMPLEMENTATION-PLAN.md)
