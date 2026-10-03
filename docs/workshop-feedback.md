# Workshop feedback and what it changed

A short, factual record of what was observed when AI Doodle Lab was used with children, and which
change each observation led to. It exists so a decision can be traced back to the thing that
prompted it, rather than to a hunch.

Only what was actually observed is written down here. No participant counts, quotations,
percentages or names are recorded, because none were collected.

## 3 October 2026 — first real workshop with children

Four observations, all from watching children use the app during the session.

### 1. Generating a picture looked like the app had frozen

**Observed.** While a real image was being generated, the feedback was too static. Children read the
wait as the app being stuck, rather than as the app working.

**Decided.** Give the result panel an obvious, animated waiting state, and keep it honest: the
backend cannot see how far along the provider is, so no percentage and no invented stage.

**Implemented.** `src/components/CreatingPicture.tsx` — a brush, drifting sparkles and travelling
dots under *"🎨 Creating your picture…"*, with an accessible `role="status"`. The whole state is
laid out and readable standing still, so the stylesheet's existing `prefers-reduced-motion` rule
removes the movement and nothing else.

### 2. The picture disappeared when a child looked at something else

**Observed.** Switching from **Let AI create** to another challenge tab, or to Teach or Learn, and
coming back left an empty panel. The picture had been local state inside the panel, so unmounting it
threw the picture away.

**Decided.** The latest picture is part of the workshop session, not of one component. Keep exactly
one — the most recent — and persist it on the device where that can be done honestly.

**Implemented.** A `GeneratedPicture` model owned by `src/hooks/useAiLab.ts`, persisted through the
existing IndexedDB meta store, with its own prompt and category snapshot so an older picture can
never end up under a newer caption. **Reset AI** clears it with everything else. A picture the
provider returned as a link is kept for the session but not stored: its lifetime is not ours to
promise, and a broken image labelled as the child's picture would be worse than an empty panel.
Changing a look, a world or a style no longer destroys the picture already on screen, and neither
does a failed or slow new attempt.

### 3. Children wanted the picture on their own phone

**Observed.** Children liked keeping what they made, but **Download my picture** saves to the
machine running the workshop — which at a booth or in a school is not their device.

**Decided.** Show a QR code that opens the picture on a phone. Build it so it adds as little as
possible to what the backend knows and keeps: no account, no gallery, no database, nothing on disk.

**Implemented.** `server/imageShares.mjs` holds one copy of a finished picture **in memory only**,
behind a 256-bit random token, for about 30 minutes, with bounded item and byte ceilings and
eviction of the oldest and the expired. `GET /api/shared-image/<token>` serves it with `no-store`
and `nosniff`, and answers one generic `404` for anything unknown, malformed or expired. The QR
itself is drawn in the browser, so no QR service sees a child's link. Details in
[image-generation.md](image-generation.md#phone-handoff-the-temporary-share-link).

### 4. The workshop-code field hid what children had typed

**Observed.** The student code input was `type="password"`, so the shared class code appeared as
dots. Children who mistyped eight characters they could not see had no way to check.

**Decided.** Add a show/hide toggle to the student's input. This is about the field on screen, not
about the stored codes: the backend still keeps only salted hashes, the plaintext still leaves the
server exactly once when the code is minted, and the admin list stays masked.

**Implemented.** A real, keyboard-reachable button beside the field with `aria-pressed` and a
touch-sized target. Hidden remains the default, and toggling never changes the value.

## What was deliberately not done

Scope kept deliberately small, so the session's findings stayed separable from other ideas: no image
gallery or history, no accounts, no permanent cloud storage for pictures, no database, no phone
pairing, no analytics, no public sharing, and no way to recover a plaintext workshop code.

## Also see

- [Workshop runbook](workshop-runbook.md) — how to run a session, including the QR handoff.
- [Picture making](image-generation.md) — codes, limits, the share store and safety in detail.
- [Architecture](architecture.md) — what runs where, and what is stored where.
