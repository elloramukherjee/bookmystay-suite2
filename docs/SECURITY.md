# Security review — OWASP ASVS 4.0 Level 1

Reviewed on 24 Nov 2026 (Phase 6) against the code in this repository. ✅ = met, verified by the test named. ⚠️ = met with a caveat
or depends on deployment. ❌ = not met (with the reason it's accepted for the MVP).

Automated checks: `server/src/__tests__/security.test.ts`, plus the auth, isolation and webhook tests listed below.
`npm audit` (both workspaces, all dependencies): **0 vulnerabilities**.

## V2 Authentication

| Control | Status | How |
|---|---|---|
| 2.1.1 Passwords ≥ 12 chars | ⚠️ | Minimum is **10** characters, max 128 (`auth.validation.ts`). Acceptable for a small staff user base; raise to 12 if policy requires. |
| 2.1.7 Breached-password check | ❌ | Not implemented (needs a HaveIBeenPwned k-anonymity call). Backlog. |
| 2.2.1 Anti-automation | ✅ | Login rate limit per IP (`AUTH_RATE_LIMIT_MAX`), lockout for 15 min after 5 failures per account (`auth.test.ts`). |
| 2.2.x No account enumeration | ✅ | Same status and message for unknown email vs wrong password. A dummy bcrypt compare equalises timing (`security.test.ts`). |
| 2.1.5 / 2.1.6 Users can change their password | ✅ | Account menu → Change password. Needs the current password and signs out every other device (`security.test.ts`, `ChangePasswordDialog.test.tsx`). Added in this review. |
| 2.4.1 Password storage | ✅ | bcrypt, cost 12 (`password.ts`). |
| 2.5.x Credential recovery | ⚠️ | No self-service "forgot password" (it would need an email or SMS channel, and none is integrated). The owner sets a new password for staff (Staff → Reset password: owner-only, roles they manage, same property, sessions revoked; `security.test.ts`). An owner's password is reset by platform support with `admin.js reset-password` (RUNBOOK). Both are audited. |
| 2.8 / 2.9 MFA | ❌ | Not in Level 1 scope. Backlog for owner accounts. |

## V3 Session management

| Control | Status | How |
|---|---|---|
| 3.2.x Token generation | ✅ | Access JWT (HS256, 15 min, issuer and audience pinned, `algorithms` fixed). Refresh token is 256-bit random, stored hashed. |
| 3.3.1 Logout invalidates | ✅ | The refresh token is revoked server-side. The access token expires within 15 min. Password change, role change and deactivation bump `tokenVersion` (checked on every request) and revoke all refresh tokens. |
| 3.4.x Cookie attributes | ✅ | `bms_rt`: `HttpOnly`, `Secure` in production, `SameSite=Strict`, `Path=/api/v1/auth`. Production refuses non-https `CLIENT_URL` (`security.test.ts`). |
| 3.5.x Token reuse | ✅ | Refresh rotation with family revocation on reuse (30 s grace for concurrent tabs) (`auth.test.ts`). |
| Token confusion | ✅ | Guest (booking) and chat tokens use separate audiences and are rejected as staff tokens (`security.test.ts`). |

## V4 Access control

| Control | Status | How |
|---|---|---|
| 4.1.x Deny by default, server-side | ✅ | Every staff route uses `authenticate` + `authorize(permission)`. The client hides UI, but the server enforces. |
| 4.2.1 IDOR / property isolation | ✅ | Every query is scoped by `hotelId` from the token (`requireScopedHotelId`). Cross-hotel access returns 404 (isolation tests in bookings, CRM and chatbot suites). |
| Least privilege | ✅ | Front desk sees no revenue (`financeVisible`), only guests in a 7/30-day window, and no campaigns (`crm.test.ts`). |
| 4.3.1 Admin interfaces | ✅ | `super_admin` is not bound to a hotel and is not exposed in the UI. |

## V5 Validation, sanitisation, encoding

| Control | Status | How |
|---|---|---|
| 5.1.x Input validation | ✅ | Zod `strictObject` schemas on every body, query and param. Unknown fields rejected. |
| 5.3.4 / 5.3.5 Injection | ✅ | MongoDB operator and dotted keys stripped from bodies and query strings; regex input escaped (`security.test.ts`). |
| 5.3.3 Output encoding / XSS | ✅ | React escaping only. No `dangerouslySetInnerHTML`, `eval` or `new Function` in the codebase. AI replies are rendered as text. |
| 5.2.x Template/LLM injection | ⚠️ | Guest text goes to Gemini. The model has no write tools beyond logging service requests and escalating; prices come from the engine, never the model. Sensitive topics are pre-filtered and escalated (`safety.test.ts`). |

## V7 Errors and logging

| Control | Status | How |
|---|---|---|
| 7.1.1 No secrets/PII in logs | ✅ | pino redacts auth headers, cookies, tokens, phones, emails and names. Request logs keep the path only (no query string). |
| 7.1.x Security events logged | ✅ | Audit log (400-day TTL) for logins, lockouts, bookings, check-in/out, takeovers, consent, follow-up resolution. IPs are hashed with a salt. |
| 7.4.1 Generic errors | ✅ | Production 500s say "Something went wrong" plus a request id. No stack traces. |

## V8 Data protection

| Control | Status | How |
|---|---|---|
| 8.2.x Client-side storage | ✅ | Access token in memory only. `localStorage` holds UI preferences and the offline action queue (booking ids and action type only, no guest PII). |
| 8.3.x Sensitive data | ✅ | ID document numbers are never stored, only the type. Phones are masked in guest-facing views. Marketing consent is recorded with source and time, and STOP is honoured. |
| Data minimisation (DPDP Act 2023) | ⚠️ | Consent capture and withdrawal are implemented. A data-export/erasure request process is operational (see RUNBOOK), not self-service. |

## V9 Communications

| Control | Status | How |
|---|---|---|
| 9.1.1 TLS everywhere | ⚠️ | HSTS (1 year) is sent. TLS termination depends on deployment: Caddy in `deploy/` or the platform. Plain-http origins are refused in production. |
| 9.2.x Outbound TLS | ✅ | Gemini, Meta Graph API and Razorpay are all https. |

## V10 Malicious code / V14 Configuration

| Control | Status | How |
|---|---|---|
| 10.3.x Integrity of webhooks | ✅ | Razorpay `X-Razorpay-Signature` and Meta `X-Hub-Signature-256` verified with HMAC over the raw body and `timingSafeEqual`. Both are idempotent. |
| 14.2.1 Dependencies | ✅ | `npm audit`: 0 vulnerabilities. Lockfile committed. `npm ci` in Docker. |
| 14.3.x No debug in production | ✅ | Mock payments (pay-at-hotel mode is allowed: it takes no money online), placeholder secrets, default IP salt, http/localhost origins and unavailable SMS/email providers all **refuse to start** in production (`security.test.ts`). |
| 14.4.x Security headers | ✅ | API: CSP `default-src 'none'`, nosniff, HSTS, no `X-Powered-By`. Web app: CSP allowing only self, Google Fonts, Razorpay and https images, with `frame-ancestors 'none'` (verified in the browser: no violations). |
| 14.5.x CORS | ✅ | Allow-list from `CLIENT_URL`, credentials only for listed origins. |
| Request size limits | ✅ | JSON bodies ≤ 100 KB (413 beyond, `security.test.ts`). |

## Pay-at-hotel mode

With no payment gateway, a fake booking costs an attacker nothing, so there are four safeguards. A phone number may hold
at most 3 upcoming unpaid bookings per property. Booking creation is rate-limited per IP. The guest's phone is verified
when they message on WhatsApp. Staff can mark a no-show from the check-in day, which puts the rooms back on sale.
Residual risk: someone with many phone numbers can still block rooms. Accepted for a single-property pilot; revisit with
deposits or OTP confirmation if it happens.

## Findings fixed in Phase 5–6

- The NoSQL sanitiser dropped dotted query keys, which would have broken Meta's webhook handshake. The handshake now reads the raw query string.
- Production now refuses non-https origins, because the Secure refresh cookie would otherwise silently fail.
- SMS/email provider names this version can't send with (`msg91`, `smtp`) are refused instead of silently logging.
- A missing hashed asset returned 500. It now returns a plain 404.
- Users had no way to change their own password (ASVS 2.1.5). Added, with other sessions revoked on change.

## Accepted for the MVP (backlog)

Breached-password check, self-service password reset (needs an email/SMS channel), MFA for owners, a 12-character minimum, automated DPDP export/erasure,
an external security test (penetration test) before onboarding multiple properties.
