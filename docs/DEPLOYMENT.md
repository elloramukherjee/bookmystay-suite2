# Deployment

BookMyStay ships as **one Node.js service**: the API also serves the built React app (`SERVE_CLIENT=true`). Guests
and staff use one HTTPS origin, the refresh cookie stays first-party, and there is one thing to deploy, monitor and
roll back.

```
Browser ──HTTPS──▶ TLS (platform / Caddy) ──▶ app:4000 ──▶ MongoDB replica set (Atlas or self-hosted)
                                               │  ├─ /api/v1/…   REST API, webhooks
                                               │  └─ /…          React app (client/dist)
                                               └─▶ Gemini · Meta WhatsApp · Razorpay (all optional except payments)
```

## Prerequisites (all options)

| Need | Why |
|---|---|
| **MongoDB replica set** | Bookings and inventory use multi-document transactions. MongoDB Atlas (M10+ recommended; M0/M2 work for a pilot) is a replica set by default. A standalone `mongod` makes preflight report an error. |
| **A domain with HTTPS** | Production refuses an `http://` `CLIENT_URL`. The refresh cookie is `Secure`. |
| **A payment mode** | Either `PAYMENT_PROVIDER=pay_at_hotel` (no gateway: website bookings are confirmed immediately and paid at the property; nothing else needed), or `razorpay` with the key id, key secret and webhook secret (webhook URL `https://<domain>/api/v1/payments/webhook`). The mock provider is refused in production. |
| **Secrets** | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (different, ≥ 32 chars) and `IP_HASH_SALT`. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. |
| Optional | `GEMINI_API_KEY` (AI receptionist), WhatsApp credentials (`docs/WHATSAPP-SETUP.md`). |
| Not available in this version | SMS and email gateways. Undeliverable important messages become staff call tasks (Hotel Settings → Guest messaging, and the dashboard). |

All variables are listed in `deploy/.env.production.example`.

## Option A — Render or Railway (Docker, managed TLS) — recommended for the pilot

1. Create a MongoDB Atlas cluster. Add the platform's egress IPs to the Atlas IP access list (or `0.0.0.0/0` with a
   strong password for a pilot) and copy the connection string.
2. New **Web Service** from this repository, runtime **Docker** (the root `Dockerfile`). Health check path: `/api/v1/health`.
3. Set environment variables from `deploy/.env.production.example`, with `TRUST_PROXY=1`.
4. Add your custom domain on the platform. TLS is automatic. Set `CLIENT_URL=https://<that domain>`.
5. After the first deploy, open the service shell and run `npm run preflight:dist --workspace server`. Fix anything marked ✗.
6. Create the property and owner account (see RUNBOOK → "Onboard a property"). **Never run the seed in production**; it refuses anyway.

## Option B — Single VM with Docker Compose (MongoDB on the same box)

For a small VM (2 vCPU / 4 GB, e.g. AWS Lightsail, DigitalOcean, an Indian cloud provider):

```bash
git clone <repo> bookmystay && cd bookmystay
cp deploy/.env.production.example deploy/.env.production   # fill it in; leave MONGODB_URI empty (compose sets it)
# DNS: point stay.example.in (A record) at the VM, open ports 80/443
DOMAIN=stay.example.in docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml exec app node dist/scripts/preflight.js
```

The compose file runs MongoDB 8 as a single-node **replica set** (`rs0`, initialised automatically, not exposed
publicly), the app, and Caddy with automatic Let's Encrypt certificates. Backups: see RUNBOOK.

## Option C — Separate static hosting (Vercel / Netlify / S3+CloudFront for the client)

Possible but not recommended. Set `SERVE_CLIENT=false`, build the client with `VITE_API_URL=https://api.<domain>/api/v1`,
and serve both from sibling subdomains of one site (`stay.` and `api.`) so the `SameSite=Strict` refresh cookie still
works. Copy the CSP from `server/src/web.ts` into the static host's headers.

## Release checklist

1. `npm ci && npm run typecheck && npm test` (server 205 / client 52 tests).
2. `npm run build`. Optionally `docker build -t bookmystay .` locally.
3. Deploy. The platform waits for `/api/v1/health` = 200.
4. `preflight:dist` shows no ✗. Review each `!` and confirm it's expected (e.g. WhatsApp simulator, no SMS).
5. Smoke test: open the site, search dates, open a room, sign in as staff, open the dashboard, Guests and Concierge Desk.
6. Make a test booking with your own phone number and cancel it. With Razorpay, pay ₹1 on your own card first.

## Rollback

Deploys are stateless images. Roll back by redeploying the previous image or commit (platform "rollback" button, or
`git checkout <tag> && docker compose … up -d --build`). Schema changes in this codebase are additive (new optional
fields and indexes), so the previous version runs against the newer data.

## Performance notes (measured in Phase 6)

- First visit for guests (public site): about **165 KB gzipped** of JS/CSS (React 98 KB, data layer 34 KB, app 20 KB,
  CSS 11 KB). Staff screens load on demand (largest page chunk 6 KB gzipped). Hashed assets are cached for a year and
  `index.html` is revalidated on each navigation.
- Room photos are external URLs. Use compressed 1600 px JPEG/WebP (≤ 300 KB) for listing photos.
- All 16 hot queries (availability, bookings, guests by phone, outbox, WhatsApp dedupe, desk lists, transcripts,
  refresh tokens) use indexes. This is enforced by `server/src/__tests__/query-plans.test.ts`.
- Indexes are created at startup (`autoIndex`) and by preflight. Both are idempotent.
