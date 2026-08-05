# PHASE 3 — Authentication

**Goal:** signup via email OTP; login via phone+password or email+password. Phone
verification is what later unlocks the WhatsApp order-claim feature.

**Agents:** SECURITY (design review first) → DEV → TEST → SECURITY (final)

> **SECURITY reviews this phase twice — before and after implementation.** Auth mistakes are
> cheap to prevent and expensive to discover.

---

## Flows

**Signup** — email → OTP to email → verify → set password + name → optional phone → OTP to
phone → verified.

**Login** — either identifier: `+91XXXXXXXXXX` or `user@example.com`, plus password. One
form, one field, detected by shape.

**Why phone verification matters here:** when an admin bills a phone number in Phase 8, the
order sits unclaimed with `userId = null`. It attaches to an account only when someone proves
ownership of that number via OTP. Get this wrong and anyone can claim anyone's purchase
history.

---

## DEV checklist

### 3.1 Password hashing

- [x] Argon2id via `@node-rs/argon2`: `memoryCost: 19456, timeCost: 2, parallelism: 1`. These
      are the OWASP-recommended parameters — do not lower them for speed.
- [x] Minimum 8 characters. Check against a top-10k common-password list. Do **not** impose
      symbol/uppercase rules — they push users toward `Password1!` and reduce real entropy.
- [x] Verify with a constant-time comparison.

### 3.2 OTP

- [x] 6 digits, `crypto.randomInt` — never `Math.random`.
- [x] Store `hash(code + OTP_PEPPER)`, never the code itself.
- [x] 5-minute TTL. Single use — set `consumedAt` atomically on success.
- [x] Max 6 verify attempts, then invalidate and force re-request.
- [x] Requesting a new OTP invalidates all previous ones for that identifier+purpose.
- [x] Rate limits, enforced in Redis:
  - 3 sends per identifier per 15 min
  - 10 sends per IP per hour
  - 20 verify attempts per IP per hour
- [x] `purpose` field (SIGNUP | LOGIN | CLAIM_ORDER) is part of the lookup key. An OTP issued
      for one purpose must never validate another.
- [x] Email via SMTP. SMS via MSG91/Twilio behind an interface — `lib/notify/sms.ts` — so the
      provider can be swapped.
- [x] In development, log the OTP to console instead of sending. Gate on
      `NODE_ENV !== 'production'` explicitly.

### 3.3 Sessions

- [x] Opaque session ID (32 random bytes) in an httpOnly cookie; session data in Redis at
      `session:{sid}`. Prefer this over a self-contained JWT — it gives you real server-side
      revocation.
- [x] Cookie: `httpOnly`, `secure` in prod, `sameSite: 'lax'`, `path: '/'`, 30-day expiry
      with sliding renewal.
- [x] Rotate the session ID on login and on any privilege change.
- [x] `/api/auth/logout` deletes the Redis key — not just the cookie.
- [x] "Log out of all devices" in account settings.

### 3.4 Routes — all Zod-validated

```
POST /api/auth/signup/start      { email }
POST /api/auth/signup/verify     { email, code }
POST /api/auth/signup/complete   { email, code, password, name }
POST /api/auth/login             { identifier, password }
POST /api/auth/logout
POST /api/auth/phone/start       { phone }         [authed]
POST /api/auth/phone/verify      { phone, code }   [authed]  → triggers claim
POST /api/auth/password/forgot   { identifier }
POST /api/auth/password/reset    { token, password }
GET  /api/auth/me
```

- [x] Normalise phone to E.164 (+91XXXXXXXXXX) with `libphonenumber-js` **before** any lookup
      or write. A number stored two ways is a duplicate account and a broken order claim.
- [x] Lowercase and trim emails before lookup and write.

### 3.5 Order claim on phone verification

- [x] On successful phone OTP verify, inside a transaction:

```ts
await db.$transaction(async (tx) => {
  await tx.user.update({ where: { id: userId }, data: { phone, phoneVerified: true } });
  const claimed = await tx.order.updateMany({
    where: { customerPhone: phone, userId: null },
    data: { userId },
  });
  await tx.auditLog.create({
    data: {
      actorId: userId,
      action: 'ORDER_CLAIM',
      entity: 'Order',
      entityId: phone,
      after: { count: claimed.count },
    },
  });
});
```

- [x] Return the claimed count so the UI can say _"We found 3 past purchases linked to this
      number."_ — a genuinely nice moment for the customer.
- [x] **This is the only code path that may set `userId` on an order.** Enforce it and note
      it in a comment.

### 3.6 Proxy (spec says "middleware" — see D-002)

- [x] `proxy.ts` protects `/account/*` and `/admin/*`.
- [x] Admin routes additionally re-check `role === 'ADMIN'` **inside the handler**. The edge
      check alone is not a security boundary — it can be bypassed by routing edge cases.
- [x] Return 404, not 403, on admin routes for non-admins. Do not confirm the route exists.

### 3.7 UI

- [x] `/login`, `/signup`, `/verify`, `/forgot-password` — full-screen mobile, centred card on
      desktop.
- [x] OTP input: 6 separate boxes, auto-advance, paste-whole-code support,
      `inputMode="numeric"`, `autoComplete="one-time-code"` (enables iOS SMS autofill — small
      detail, large UX difference).
- [x] Resend countdown timer, disabled until it hits zero.
- [x] Single identifier field on login with a hint that detects and displays whether it read
      the input as phone or email.

---

## SECURITY review

- [x] Argon2id parameters exactly as specified.
- [x] OTP hashed at rest, peppered, single-use, TTL enforced.
- [x] **Enumeration:** wrong-password and unknown-user responses are identical in body,
      status, and timing. Add a dummy hash verification on the unknown-user path so response
      time matches — otherwise timing leaks account existence.
- [x] Order claim runs only after verified OTP. Attempt to bypass it by calling the
      profile-update endpoint with a phone field — it must not claim.
- [x] Session cookie flags correct in production build.
- [x] Password reset tokens: single-use, 1-hour TTL, invalidated on use and on password
      change.
- [x] No user object returned anywhere includes `passwordHash`. Use an explicit Prisma
      `select`, never exclude-by-convention.
- [x] Rate limits verified by actually exceeding them.

---

## TEST

- [x] Unit: OTP generation, hashing, expiry, attempt counting.
- [x] Unit: phone normalisation — `9876543210`, `+919876543210`, `+91 98765 43210`,
      `09876543210` all → `+919876543210`.
- [x] Integration: full signup, full login both ways, logout invalidates session.
- [x] Integration: expired OTP rejected; consumed OTP rejected; wrong purpose rejected; 7th
      attempt locked out.
- [x] Integration: create an unclaimed order → verify that phone → order appears under the
      user. **This is the flagship test of the phase.**
- [x] Integration: unclaimed order → verify a _different_ phone → order does **not** attach.
- [x] Signup by email, later add phone → one user record, not two.
- [x] E2E at 375px: signup → OTP → password → logged in.
- [x] Load test: 100 concurrent OTP requests → rate limiter holds, no crash.

---

## Acceptance criteria

1. Signup with email OTP works end to end.
2. Login by phone or email, same form.
3. Phone verification claims matching unclaimed orders — and only those.
4. All OTP abuse cases blocked.
5. SECURITY sign-off with zero CRITICAL or HIGH findings.
