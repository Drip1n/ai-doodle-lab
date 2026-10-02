# Picture making: Demo, Live, and the workshop admin panel

Demo remains the default and needs only `npm run dev`. It previews an idea and sends no
image-generation requests.

Live mode adds a small Node server (`server/`) that holds the provider credentials, hands out
workshop codes, and queues generations so a class of fifteen does not become fifteen simultaneous
provider calls.

## Local Live setup

Use Node.js 22.9+ (Node.js 24 recommended).

1. Copy `.env.example` to `.env.local`, and `.env.server.example` to `.env.server.local`.
2. In `.env.local`, set:

   ```dotenv
   VITE_IMAGE_MODE=live
   VITE_IMAGE_ENDPOINT=/api/generate-image
   ```

3. Configure `.env.server.local` using YOUR Portkey workspace:
   - `IMAGE_MODEL`: the exact model name accepted by your route.
   - `IMAGE_OPERATION=edits`: multipart `/images/edits`, or `chat`: `/chat/completions` with image
     output.
   - `PORTKEY_CONFIG_ID` OR `PORTKEY_VIRTUAL_KEY`: the configured route/provider connection.
   - `PORTKEY_API_KEY`: server-only secret. Never place it in a `VITE_*` variable.
4. Create at least one admin for the panel:

   ```bash
   npm run admin:hash-password -- teacher@example.com
   ```

   It asks for the password twice without echoing it, then prints the exact `ADMIN_USERS_JSON=`
   line to paste into `.env.server.local`. The single quotes matter: the scrypt hash contains `$`.
   Plaintext passwords never go in the file, and never in Git.
5. Run `npm run server` in one terminal and `npm run dev` in another. Restart both after changing
   environment files. Vite proxies `/api` to the local server on port 8787.
6. Open the app, press the small ⚙ in the bottom-left corner, sign in, and generate a code for your
   class. **The full code is shown once.** Copy it then; afterwards the panel only shows a masked
   form such as `FONTYS-A7•••`.
7. Add examples in Teach, open Challenge → Let AI create, enter the workshop code, then create a
   picture.

The key and the admin password have deliberately not been created or filled in. No provider
requests were made during development.

## Workshop codes

The single global `WORKSHOP_ACCESS_CODE` is gone. Each class gets its own code with its own
lifetime and budget.

| Field | Meaning |
| --- | --- |
| `id` | Random UUID, used by the revoke route. |
| `label` | What the teacher calls the class, e.g. `Workshop Group A`. |
| `codeHash` + `salt` | `sha256(salt ‖ code)`. The plaintext is never stored. |
| `prefix` | The part the panel may show again, e.g. `FONTYS-A7`. |
| `createdAt` / `expiresAt` / `revokedAt` | Lifetime. A revoked code never comes back. |
| `usageCount` / `usageLimit` | Pictures made, and the ceiling. |
| `createdBy` | Which admin created it. |

- Codes are `PREFIX-XXXXXXXX`, with eight characters drawn from a 30-character alphabet by
  rejection sampling over `crypto.randomBytes` — roughly 39 bits. `I`, `L`, `O`, `U`, `0` and `1`
  are excluded so a code read aloud cannot be mistyped into a different valid one.
- Matching ignores case and surrounding whitespace, and compares with `timingSafeEqual` against
  every stored entry without an early return, so the response time reveals nothing about which
  codes exist.
- The plaintext leaves the process exactly once, in the `201` response from
  `POST /api/admin/codes`. There is deliberately no way to reveal it later. A lost code is
  replaced, not recovered.
- The code is a shared class gate, not individual user authentication.

### When a usage is spent

A usage is spent at the moment a provider generation is about to start, inside the store's
serialised critical section — never when a request merely arrives.

- Invalid input, a wrong/expired/revoked/exhausted code, a full queue, a queue-wait timeout or a
  client that disconnects while queued: **no usage spent.**
- The provider call started and then failed: **the usage is spent.** A call that reached the
  provider is a call that may have been billed, so it counts. `IMAGE_PROVIDER_TIMEOUT_MS` bounds
  how long it can take.

Re-validating after leaving the queue is what makes a mid-workshop revoke effective: a request that
was already waiting is still refused.

## Persistence

Codes and their usage counters live in one JSON file, written atomically (temp file in the same
directory, then `rename`). Default path `server/.data/workshop-codes.json`, overridable with
`WORKSHOP_STORE_PATH`.

- Server-side only. It is not in `public/`, not in `dist/`, gitignored, and `vite.config.ts` adds it
  to the dev server's `fs.deny` list so it cannot be fetched from the dev server either.
- All reads and writes go through one promise chain, so a read-modify-write from one request cannot
  interleave with another's. That is what keeps the usage counter honest while four generations run
  at once.
- A missing file initialises an empty store. A **malformed** file does not: every entry is
  validated on load, and anything unexpected makes the store refuse to serve. Code validation and
  the admin routes then answer `503` and the file is left untouched, rather than starting fresh and
  silently voiding every class's code and usage history.
- Deliberately not PostgreSQL, Redis, or anything else to stand up on the morning of a workshop.
  The cost is that it is single-instance: two replicas would each have their own file.

## Admin panel and authentication

The ⚙ button in the bottom-left corner opens the panel. It is small and faded so it does not
compete with the workshop, but **that is tidiness, not security** — every route behind it is
authenticated on the server.

- Admins come from `ADMIN_USERS_JSON`, a server-only environment variable. There is no signup, no
  roles and no password reset.
- Passwords are scrypt (N=16384, r=8, p=1, 32-byte key) with a random 16-byte salt per user, and are
  verified with `timingSafeEqual`.
- An unknown email still runs a full scrypt against a decoy hash, and both failure paths return the
  same `401` wording, so the panel cannot be used to find out which teachers exist.
- Five failures (`ADMIN_MAX_FAILURES`) against either the same email or the same address lock
  sign-in for fifteen minutes (`ADMIN_LOCKOUT_MS`). The lockout answers `429` with its own wording,
  which still says nothing about whether the email exists.
- A success issues a 256-bit `base64url` session token in a cookie that is `HttpOnly`,
  `SameSite=Strict`, `Path=/`, `Max-Age=ADMIN_SESSION_TTL_MS`, and `Secure` whenever `APP_ORIGIN` is
  https (override with `ADMIN_COOKIE_SECURE`). Sessions live in memory and are bounded, so a
  restart signs admins out — codes survive it, sessions do not.
- Nothing is kept in `localStorage`: no password, no token, no admin flag.
- `POST` to any `/api/admin/*` route additionally requires an exact `Origin` match, which together
  with `SameSite=Strict` is the CSRF defence.

### Routes

| Route | Auth | Notes |
| --- | --- | --- |
| `POST /api/admin/login` | — | Generic failure wording; rate-limited. |
| `POST /api/admin/logout` | — | Always `200`; clears the cookie and kills the session. |
| `GET /api/admin/codes` | session | Masked codes and operational metadata only. |
| `POST /api/admin/codes` | session | `{ label, expiresInHours, usageLimit }`. The only response carrying a plaintext code. |
| `POST /api/admin/codes/:id/revoke` | session | Idempotent. |
| `POST /api/generate-image` | workshop code | `X-Workshop-Code` header. |
| `GET /api/health` | — | Booleans only; never a key, a code or an email. |

`TRUST_PROXY=1` is required when a reverse proxy sits in front, so the left-most `X-Forwarded-For`
entry is used for lockout counting. Without it every request looks like it comes from the proxy, and
a handful of wrong passwords would lock out all admins for fifteen minutes. With it but *without* a
proxy, a client could forge its own address, so it is off by default.

## Concurrency and queueing

```
IMAGE_MAX_CONCURRENCY=4      provider generations running at once
IMAGE_QUEUE_LIMIT=20         requests allowed to wait for a slot
IMAGE_QUEUE_WAIT_MS=120000   how long a request may wait before giving up
IMAGE_PROVIDER_TIMEOUT_MS=90000
```

Four concurrent calls for roughly fifteen students: enough that nobody waits long, few enough that
the provider is not hit with fifteen at once.

- Up to `IMAGE_MAX_CONCURRENCY` generations run; further valid requests wait in a FIFO queue.
  FIFO is what stops the child who clicked first from being overtaken.
- A full queue answers `429` with `{ code: 'busy' }`, and the frontend shows *"Lots of pictures are
  being made right now. Wait a moment and try again."* No backend wording reaches a child.
- A request that waits longer than `IMAGE_QUEUE_WAIT_MS` answers `503` with the same `busy` code
  and leaves the queue.
- An aborted or disconnected request is removed from the queue immediately and never takes a slot.
  Slots are released in a `finally`, and the release function is idempotent, so a provider error or
  a double release cannot strand one.
- The provider clock starts **after** a slot is acquired, so queue time never eats into generation
  time. The browser therefore allows `IMAGE_TIMEOUT_MS = 240s` in total (120s queue + 90s provider
  + margin), and the server's `requestTimeout` is set from the same two numbers. Shortening the
  queue wait is the lever for shortening the client timeout.

## Cost, abuse and privacy

- `IMAGE_GLOBAL_REQUEST_LIMIT` (default 200, `0` disables) is an emergency ceiling for the whole
  process, on top of per-code limits. It resets on restart and is not shared across replicas, so a
  **provider/account spending cap remains the authoritative budget.** `IMAGE_REQUEST_LIMIT` is
  still read as an alias for the old name.
- `IMAGE_CODE_RATE_LIMIT` (default 30 per `IMAGE_CODE_RATE_WINDOW_MS`, per code) is a burst
  ceiling. Thirty per minute leaves a class of fifteen plenty of room while stopping a script; one
  class's burst never affects another's.
- Kept from before: 3 MB request cap (the connection is cut, not buffered), 1–4 references, PNG
  header and dimension checks, 180-character ideas, 60-character category names, exact-origin CORS,
  an https-only provider base, and output validation of the returned image.
- The server stores **no** drawings, prompts or generated images. Generation input is processed
  transiently; the only thing written to disk is workshop-code metadata. Drawings stay in the
  browser's IndexedDB, as before.
- Nothing logs a provider key, a password, a full workshop code or a student image. There is a test
  that asserts it.

## Child safety

The prompt names the subject, labels the child's text as untrusted and non-instructional, and
carries an explicit safety clause that outranks everything after it: suitable for ages 8–12, and no
violence, blood, weapons, gore, frightening imagery, nudity, sexual content, hateful symbols, drugs,
alcohol or likenesses of real people. It also tells the model to ignore words or markings inside the
reference drawings.

**Prompt wording does not guarantee moderation.** It is one layer. Before using this with children:

- Enable the moderation/safety settings your provider offers on the route you use — in the Portkey
  workspace and in the underlying model's own configuration. Those live in your provider account,
  not in this repository, and this code does not and cannot set them.
- Keep an adult watching the screen. The usage limits exist partly so a bad result can be stopped by
  revoking a code rather than by waiting for anything to time out.

## Model compatibility — verify before enabling paid calls

The adapters implement request/response shapes, not guaranteed availability of specific models.
Model names must be confirmed in your Portkey workspace; they differ by provider route. Do not
assume that a Google-prefixed name implies a direct Gemini connection.

- `edits` sends PNG references as multipart `image` (one reference) or `image[]` (multiple), plus
  `model`, `prompt`, and `n=1`. Your route/model must support that format.
- `chat` sends text and `image_url` references with `modalities: [text, image]`. Use only a
  compatible image-output chat route. It is NOT the native Gemini `generateContent` API. The
  response must contain `choices[0].message.images[0].image_url.url`.
- Both adapters accept images-edits-style `data[0].b64_json` or `data[0].url`. There is no automatic
  fallback or retry that could unexpectedly charge twice.

Official references: <https://portkey.ai/docs/api-reference/inference-api/images/create-image-edit>
and <https://portkey.ai/docs/api-reference/inference-api/chat-completions>

## Deployment reality check

Read this before promising Live mode at a workshop. **No hosting provider setting was created,
inspected or changed while this was built.** Everything below is what the repository itself shows.

### A. What deploys automatically today

Only the static frontend. The repository contains no deployment configuration at all — no
`wrangler.toml`, no `functions/` directory, no `_worker.js`, no `_routes.json`, no Dockerfile, and
no deploy workflow (`.github/workflows/ci.yml` runs tests and `npm run build`, and publishes
nothing). The README states that Cloudflare deploys `main`; that integration is configured in the
Cloudflare dashboard, outside this repository, and cannot be verified from here. What it can deploy
is `npm run build` → `dist/`.

### B. What must run the Node backend

`server/index.mjs` is a portable Node HTTP service — a long-running process, **not** a serverless
function and not part of the static build. It needs an always-on Node 22.9+ host with a writable
disk for the code store: a small VPS, a container, or any Node app host. Start it with
`npm run server` (or `node --env-file-if-exists=.env.server.local server/index.mjs`) under a process
manager, and reverse-proxy `/api/*` to it over https. A single instance only: the store is one
local file, and the queue, session and limit counters are per process.

### C. Server-side environment variables

Required for Live mode: `APP_ORIGIN`, `PORTKEY_API_KEY`, `IMAGE_MODEL`, `IMAGE_OPERATION`, one of
`PORTKEY_CONFIG_ID` / `PORTKEY_VIRTUAL_KEY`, and `ADMIN_USERS_JSON`. Strongly recommended:
`WORKSHOP_STORE_PATH` (a path that survives redeploys), `TRUST_PROXY=1` behind a proxy, and the
concurrency/limit variables. Optional: `PORT`, `HOST`, `PORTKEY_BASE_URL`, `PORTKEY_PROVIDER`,
`WORKSHOP_CODE_PREFIX`, `ADMIN_COOKIE_SECURE`, `ADMIN_SESSION_TTL_MS`, `ADMIN_MAX_FAILURES`,
`ADMIN_LOCKOUT_MS`. `.env.server.example` lists every one with a safe placeholder. No session secret
is needed: tokens are random and held server-side.

### D. Can the current production setup serve `/api/generate-image`?

As the repository stands, **no.** There is nothing in it that would make `/api/generate-image` exist
on the deployed site. A static host serving `dist/` has no such route, and `VITE_IMAGE_ENDPOINT` is
empty in `.env.example`, so a production build defaults to Demo mode and the app says picture making
is not connected. Demo mode is unaffected by any of this and keeps working.

### E. The minimum manual step still required

Four things, none of them in this repository:

1. Run `server/index.mjs` somewhere with the environment variables from (C).
2. Expose it over https, either as `/api/*` on the same origin as the site (so cookies and
   `APP_ORIGIN` line up with no extra configuration) or on its own https origin.
3. Set `VITE_IMAGE_MODE=live` and `VITE_IMAGE_ENDPOINT` in the frontend build, and `APP_ORIGIN` on
   the server to the exact site origin.
4. Create one admin with `npm run admin:hash-password` and put the result in the server's
   environment.

Same-origin `/api/*` is the smallest option: it needs no `VITE_ADMIN_ENDPOINT`, no cross-origin
cookie handling, and `VITE_IMAGE_ENDPOINT=/api/generate-image`. If the server lives on its own
origin, set `APP_ORIGIN` to the site and `VITE_IMAGE_ENDPOINT` to the server's absolute https URL;
the admin base is then derived from it automatically.

## Checks

```bash
npm run lint         # oxlint
npm test             # Vitest: frontend units and component suites
npm run test:server  # node --test: store, codes, admin auth, queue, HTTP, scripts
npm run build        # type-check + production build
npm run test:e2e     # Playwright, real browser
```

`npm run test:server` covers workshop-code validity and revocation, randomness and
plaintext-never-stored, persistence across a restart, a malformed store failing closed, admin
sign-in, lockout, session expiry and logout, code creation/listing/revocation, four-at-a-time
concurrency with queue overflow and abort handling, usage counting under concurrency, and the
generation guards. None of it uses a real API key or a real password.
