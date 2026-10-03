# Picture making: Demo, Live, and the workshop admin panel

This is the detailed reference for the **Let AI create** path: how workshop codes work, what the
server validates, what it limits, what it does and does not store, and what has to be configured
outside this repository before a class uses it.

Two modes:

- **Demo** is the default for a checkout and needs only `npm run dev`. It previews the idea a child
  assembled and sends no image-generation request at all.
- **Live** adds the small Node server in `server/`, which holds the provider credentials, hands out
  workshop codes, and queues generations so a class of fifteen does not become fifteen simultaneous
  provider calls.

Live mode is deployed and running in production. See [Deployment](#deployment) below and
[deployment.md](deployment.md) for the topology.

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

The repository contains no key and no admin password, and none of the example files hold a real
value. Production credentials exist only as runtime environment variables on the backend host.

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

## Phone handoff: the temporary share link

A booth machine is not the child's device, so "Download my picture" saves the picture somewhere they
will never see again. After a successful generation the panel therefore also shows a QR code, and
scanning it opens the picture on their own phone.

A QR code cannot carry a `blob:` or `data:` URL — the phone is a different device — so the picture
needs a URL of ours. `server/imageShares.mjs` provides exactly that and nothing more.

| Property | Value |
| --- | --- |
| Where the bytes live | Process memory. **Never** written to disk, never added to the code store. |
| Token | 32 random bytes as `base64url` (43 characters, 256 bits). Encodes nothing: no code, no category, no timestamp. |
| TTL | `IMAGE_SHARE_TTL_MS`, default 30 minutes. |
| How many at once | `IMAGE_SHARE_MAX_ITEMS`, default 40. `0` switches sharing off entirely. |
| How much at once | 8 MB per picture, 64 MB in total. Expired entries are swept; the oldest are evicted when either ceiling is reached. |
| Survives a restart | **No.** Every link dies with the process; this is intentional and is why nothing has to be cleaned up. |
| Auth | None, by design. The phone that scans the QR has no workshop code. The random token is the whole capability. |

### The response

A successful `POST /api/generate-image` keeps its existing `image` field and adds two more when a
share could be made:

```json
{ "image": "data:image/png;base64,...", "sharePath": "/api/shared-image/<token>", "shareExpiresAt": 1791055617974 }
```

`GET /api/shared-image/<token>` answers the image itself — the simplest thing that works on a phone,
since a browser shows it and a long press saves it:

- `Content-Type` sniffed from the actual bytes (PNG, JPEG or WebP only), `Content-Disposition:
  inline; filename="ai-doodle-cat.png"`, `Cache-Control: no-store`, `X-Content-Type-Options:
  nosniff`.
- Unknown, malformed and expired tokens all get the same generic `404 {"error":"Not found"}` that an
  unknown path gets. Nothing distinguishes them.
- It is the one route that is not bound to `APP_ORIGIN`: a phone opens it from another device, and a
  top-level navigation carries no `Origin` header. No `Access-Control-Allow-Origin` is set on it, so
  another site's JavaScript still cannot read the bytes.
- `GET` only. Every other method falls through to the same `404`.

### Normalising the share copy

The generation adapters can return either an inline `data:` image or an `https:` URL on the
provider's own host, and the QR has to work for both.

- A `data:` image is decoded straight into the share table.
- An `https:` result is fetched **once**, server-side, with a 15 s timeout, an 8 MB ceiling enforced
  while reading, and a content type that must be an image — and is then checked again by magic
  bytes, so a host that mislabels its response cannot make us serve an HTML or SVG document from our
  own origin. Only the bytes are kept; the provider's URL is never handed out as our share link.
- That is one extra image download, never a second generation. A picture is still billed once.

**Sharing never endangers the picture.** If the copy fails for any reason — not an image, too big,
the host refused, sharing switched off — the generation response goes out exactly as before, simply
without `sharePath` and `shareExpiresAt`. The frontend then shows no QR section at all, and
"Download my picture" is unaffected.

### In the browser

The QR is drawn in the page by `qrcode.react` (no QR web service, so nothing about a child's picture
is handed to another third party). The absolute URL is built from the configured
`VITE_IMAGE_ENDPOINT`: an absolute endpoint gives the backend's origin, a relative one means the
backend is this same site. No hostname is hardcoded. A `sharePath` that does not match
`/api/shared-image/<43 token characters>` exactly is dropped rather than turned into a URL.

The section is shown only for a real generated picture with live share metadata — never in demo
mode, never before a picture, never when the share failed. When the link expires while the panel is
open, the QR is replaced by *"This phone link has expired. Create a new picture to get a new one."*

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
| `POST /api/generate-image` | workshop code | `X-Workshop-Code` header. Answers `image`, plus `sharePath` and `shareExpiresAt` when a phone copy was made. |
| `GET /api/shared-image/:token` | the token itself | The temporary phone copy. No code, no cookie, no origin binding; generic `404` for anything it does not hold. |
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
- Phone-handoff shares are held in memory only, bounded by `IMAGE_SHARE_MAX_ITEMS` (40) and 64 MB,
  expire after `IMAGE_SHARE_TTL_MS` (30 minutes), and vanish on restart. The token is 256 random
  bits and carries no information; the route logs neither token nor bytes.
- Kept from before: 3 MB request cap (the connection is cut, not buffered), 1–4 references, PNG
  header and dimension checks, 180-character ideas, 60-character category names, exact-origin CORS,
  an https-only provider base, and output validation of the returned image.
- The server writes **no** drawings, prompts or generated images to disk. Generation input is
  processed transiently; the only thing written to disk is workshop-code metadata. Drawings stay in
  the browser's IndexedDB, as before, and so does the child's latest generated picture — only the
  latest one, and only when it is inline image data.
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

Production runs `IMAGE_OPERATION=edits` against `gpt-image-2`, so that combination is known to work
through a Portkey `/images/edits` route. Everything else here still applies to any other
configuration.

The adapters implement request/response shapes, not guaranteed availability of specific models.
Model names must be confirmed in your own Portkey workspace; they differ by provider route. Do not
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

## Deployment

Live mode is deployed and running in production. The detail below is the summary; the full topology,
environment-variable categories and redeploy considerations live in
[deployment.md](deployment.md).

### What runs where

| Piece | Deployment |
| --- | --- |
| Frontend (`dist/`) | Static bundle on Cloudflare, `fontys-ai-lab.milansmiesko.nl` |
| Backend (`server/index.mjs`) | `Dockerfile.server`, one container on a VPS managed by Coolify, behind a TLS reverse proxy at `fontys-ai-doodle-api.milansmiesko.nl` |
| Code store | A persistent volume mounted at `/app/data` |
| Generation | Portkey, `IMAGE_OPERATION=edits` → `/images/edits`, model `gpt-image-2` |

Production runs `IMAGE_QUALITY=medium` and `IMAGE_SIZE=1024x1024`.

`POST /api/generate-image` and the `/api/admin/*` routes exist in production. `GET /api/health`
answers `configured: true` once a provider key, a model, at least one admin and a readable store are
all present.

Neither Cloudflare nor Coolify is required by the application. The frontend is a plain static bundle
with a single entry point — no edge functions, no `_worker.js`, no `_routes.json`, no framework
adapter — so any static host serves it. The backend is a portable Node HTTP service, so any Docker
host runs it. Both are current deployment choices, not architectural dependencies.

### What the backend needs

`server/index.mjs` is a long-running process, **not** a serverless function and not part of the
static build. It needs an always-on Node 22.9+ host with a writable disk for the code store.
`Dockerfile.server` provides exactly that: `node:24-alpine` plus `server/`, no `npm ci` — every
module under `server/` imports only `node:` built-ins, so the backend has no package to install.

Run **one instance only**. The store is one local file, and the queue, sessions and limit counters
are per process.

### Server-side environment variables

Required for Live mode: `APP_ORIGIN`, `PORTKEY_API_KEY`, `IMAGE_MODEL`, `IMAGE_OPERATION`, one of
`PORTKEY_CONFIG_ID` / `PORTKEY_VIRTUAL_KEY`, and `ADMIN_USERS_JSON`. Strongly recommended:
`WORKSHOP_STORE_PATH` on a path that survives redeploys, `TRUST_PROXY=1` behind a proxy, and the
concurrency/limit variables. Optional: `PORT`, `HOST`, `PORTKEY_BASE_URL`, `PORTKEY_PROVIDER`,
`IMAGE_QUALITY`, `IMAGE_SIZE`, `WORKSHOP_CODE_PREFIX`, `ADMIN_COOKIE_SECURE`,
`ADMIN_SESSION_TTL_MS`, `ADMIN_MAX_FAILURES`, `ADMIN_LOCKOUT_MS`, `IMAGE_SHARE_TTL_MS`,
`IMAGE_SHARE_MAX_ITEMS`. `.env.server.example` lists every
one with a safe placeholder. No session secret is needed: tokens are random and held server-side.

### Cross-origin versus same-origin

Production currently serves the frontend and the backend from **different** hostnames, which is why
`VITE_IMAGE_ENDPOINT` is the backend's absolute https URL and `APP_ORIGIN` is the exact frontend
origin. The admin base is derived from `VITE_IMAGE_ENDPOINT` automatically, so `VITE_ADMIN_ENDPOINT`
is not set.

Same-origin `/api/*` remains the smaller configuration: no cross-origin cookie handling, a relative
`VITE_IMAGE_ENDPOINT=/api/generate-image`, and an `APP_ORIGIN` that lines up with the site by
construction. Moving to it is the
point of the portable Docker Compose deployment on the
[roadmap](../README.md#roadmap).

### Deploying it yourself

Four things, none of them in this repository:

1. Run the backend container with the environment variables above and a volume mounted at
   `/app/data`. Without the volume, every redeploy voids every workshop code and usage counter.
2. Expose it over https, either as `/api/*` on the site's own origin or on its own https origin.
3. Set `VITE_IMAGE_MODE=live` and `VITE_IMAGE_ENDPOINT` in the frontend **build** — they are
   compile-time constants, so changing them needs a rebuild — and `APP_ORIGIN` on the server to the
   exact site origin.
4. Create one admin with `npm run admin:hash-password` and put the result in the server's
   environment.

Demo mode is unaffected by all of this and keeps working with no server, no key and no code.

## Checks

```bash
npm run lint         # oxlint
npm test             # Vitest: frontend units and component suites
npm run test:server  # node --test: store, codes, admin auth, queue, HTTP, scripts
npm run build        # type-check + production build
npm run test:e2e     # Playwright, real browser
```

`npm run test:server` also covers the share table (token entropy and format, expiry, eviction by
age, count and bytes), the share route (correct bytes and headers, one generic 404, GET only,
nothing on disk, nothing logged) and share normalisation (both provider shapes, bounded external
fetch, a failed copy never costing the child their picture).

`npm run test:server` covers workshop-code validity and revocation, randomness and
plaintext-never-stored, persistence across a restart, a malformed store failing closed, admin
sign-in, lockout, session expiry and logout, code creation/listing/revocation, four-at-a-time
concurrency with queue overflow and abort handling, usage counting under concurrency, and the
generation guards. None of it uses a real API key or a real password.
