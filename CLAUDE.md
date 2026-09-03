# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo state

This is a **working, deployed app**, live at
[strength-ai.vercel.app](https://strength-ai.vercel.app). React + Vite · Supabase
(Postgres, auth, edge functions) · installable as a PWA. `README.md` is the accurate
description of what exists; this file is the accurate description of how to change it.

## Commands

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # vitest — 118 tests, no database or network needed
npm run lint    # oxlint; currently warnings-only, no errors
npm run build
```

Single test file: `npx vitest run src/lib/resolver.test.js`.

Tests live in `src/lib/{resolver,coach,suggestNext}.test.js`,
`supabase/functions/_shared/{usage,anthropic}.test.ts`, and
`src/pages/pages.smoke.test.js`. All are plain function tests — no DB, no mocks, no
setup. They should pass before any UI work is considered done.

The smoke test only imports every page and shared module and checks it exports a component.
It renders nothing. It exists because the routes are lazy (`App.jsx`), so a broken import no
longer fails the build — it fails at navigation, on whichever screen the lifter opens.

`.env.local` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

**Database.** In the Supabase SQL editor run `supabase/schema.sql`, then the migrations
in numerical order: `002`, `003`, `004`, `005`, `007`, `008`. There is no `006` — it was
superseded by `007`. Everything is idempotent, so re-running is safe.

**Edge functions.** These hold the API key server-side and enforce usage caps where the
client can't edit them:

```bash
supabase functions deploy resolve-exercise
supabase functions deploy coach-chat
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Optional secrets with sane defaults: `RESOLVER_MODEL`, `COACH_CHAT_MODEL`,
`RESOLVER_MONTHLY_CAP` (400), `COACH_CHAT_DAILY_CAP` (40). Pin models to a version
alias, never `-latest` — a retired dated model once made the whole AI layer read as bad
wifi for days.

`ANTHROPIC_WORKSPACE_ID` is optional, and which way it goes is decided by the key, not by
preference: an identity-linked key belongs to a person rather than a workspace, so the API
refuses it with a 400 until the workspace is named in an `anthropic-workspace-id` header. A
workspace-scoped key must *not* receive that header. Set the secret and it is sent, leave it
unset and it is omitted — `_shared/anthropic.ts` builds the headers for both cases, so
swapping one kind of key for the other never needs a code change or a redeploy.

## Architecture

**Pure logic is separated from I/O on purpose**, so the hard-to-get-right parts can be
tested without a database or a UI:

```
src/lib/resolver.js       normalization, junk filter, local match; re-exports the vocabulary
src/lib/coach.js          matched-RIR series, plateau + program detection, goal projection,
                          per-muscle volume, the facts payload for the chat coach
src/lib/units.js          kg/lb, RIR → RPE, readiness score
src/lib/suggestNext.js    "up next" ranking: template order, then co-occurrence, then recency
src/lib/bodyParts.js      body-part order + labels for the weekly-goals UI
src/lib/localState.js     the localStorage keys, and the one place that clears them

src/api/db.js               the ONLY file that touches Supabase
src/api/queryCache.js       stale-while-revalidate cache; db.js writes invalidate their keys
src/api/resolveExercise.js  the three resolution gates
src/api/coachChat.js        builds the facts payload, calls the chat function

src/hooks/                  useQuery, useVariantMap, useExerciseOrder, useHoldRepeat
src/components/ScreenState.jsx  ScreenLoading + ErrorBanner, used by every screen

supabase/schema.sql            tables, indexes, RLS policies
supabase/functions/            resolve-exercise, coach-chat
supabase/functions/_shared/    vocab.ts, usage.ts (cap logic), http.ts (CORS/JSON/user gate)
public/sw.js                   offline shell; registered from main.jsx in production only
prototype/                     the original high-fidelity UI reference
```

**Routes are lazy.** `App.jsx` eagerly imports Home and Login only; every other screen is a
`React.lazy` chunk with its Suspense boundary in `AppLayout`. Keep new screens lazy, and add
them to the smoke test.

Screens in `src/pages`: Home, Workout, Progress, CoachChat, Coach (insights), Templates,
TemplateEditor, SessionDetail, Settings, and the four auth pages.

### The resolver (`src/lib/resolver.js` + `src/api/resolveExercise.js`)

There is no global exercise database. A lifter's registry is built entirely from what
they've logged (`exercise_variants`, keyed by `user_id, base, mods`). **The model decides
what an exercise is** — the local module only normalizes, autocompletes, and filters junk.

`resolveExercise(text, variants)` runs three gates, cheapest first, and returns a
`status` that the UI must respect:

- `known` — `findLocal` matched a phrase this lifter already typed. Instant, offline,
  free. Most logging stops here.
- `resolved` — the shared alias cache or the model identified it.
- `rejected` — not an exercise. **The only status that blocks logging.**
- `unresolved` — couldn't reach the model, or the cap is hit. **Never blocks**: the set
  saves as typed and can be re-resolved later. You're standing at a rack; the workout has
  to be loggable.

The rule that protects the data: **every distinguishing term the lifter types must end up
in the base or the modifiers.** If "zercher barbell squat" comes back tagged only
`barbell`, those squats merge into ordinary ones and corrupt months of trend invisibly.
This is stated in the prompt and enforced again server-side; any unaccounted-for content
word is appended as a tag, so a forgotten term degrades to an ugly label rather than bad
data.

`VOCAB_BASES` / `VOCAB_MODS` / `MUSCLES` / `JOINT_ACTIONS` / `BODY_PARTS` are vocabularies
given to the model, not a matching dictionary. **They live in
`supabase/functions/_shared/vocab.ts`**, which is the only directory both the browser and the
Deno edge function can import from — the function is the side that actually shows them to the
model, so a second copy on the client is a silently forking trend line waiting to happen.
`resolver.js` re-exports them, so `from '@/lib/resolver'` still works. Edit the shared file,
never a copy. `isPlausibleExercise` is deliberately permissive — it
rejects only what *cannot* be an exercise (keyboard mashing, repeated characters). Note
there is intentionally no "must contain a vowel" rule: SLDL, RDL, OHP and BSS are all
vowel-free.

**Don't add an alias list.** Hand-written aliases outranked the model on any phrase they
touched and were confidently wrong in ways nobody could see. If the model gets something
wrong, fix the prompt or the vocabulary.

**Don't pre-seed `exercise_aliases` with hand-written rows either.** Same mistake wearing a
different hat, and worse: a wrong seed row is served free and forever, and because it hits
before the model is ever asked, no later call can correct it.

### The coach (`src/lib/coach.js`)

Deliberately conservative: every function either has data-backed grounds to claim
something, or explicitly declines to. Patterns to preserve when extending:

- `matchedRirSeries` only compares sessions at the *same* weight × reps (the lifter's
  modal combination for that variant) — RIR at different loads isn't comparable.
- `detectPlateau` requires ≥3 matched sessions and a full RIR point of drop; half a point
  is noise in self-reported RIR.
- `detectProgramPattern` looks for ≥2 lifts stalling together plus a falling readiness
  trend, because diagnosing each exercise in isolation turns "recovery" into several
  unrelated false plateaus (a bug from the prior Base44 version).
- `projectGoal` refuses to project when the observed rate isn't positive, and always
  returns a decay-adjusted range alongside the naive linear one — straight-line
  extrapolation is knowingly false near a lifter's ceiling.
- `muscleVolume` counts primary as a full set and secondary as half. This is what makes
  cross-movement fatigue visible: a bench stalls because the triceps absorbed eighteen
  sets across bench, dips and pushdowns. No per-exercise view can see that.
- `buildCoachFacts` is the payload for the chat coach. **The chat never queries the
  database** — it only sees numbers these tested functions computed, so everything it
  quotes can be checked against the lifter's own Progress screen. The chat can do exactly
  two things: save a template, and stage exercises into a session. It cannot write a
  weight, a rep count, or an RIR.
- No injury/pain classification exists or is planned — cut deliberately to avoid medical
  claims. Session notes are plain text; the only related feature is a manual "exclude
  this session from trends" action where the lifter gives their own reason.

### Data layer (`src/api/db.js`)

- Every write resolves the current user id itself (`uid()`) and throws if unauthenticated.
- `ok()` throws on any Supabase error deliberately — no bare `catch {}`. Catch at the UI
  layer and surface something to the user; don't swallow errors here.
- `variants.ensure` upserts on `(user_id, base, mods)` with `mods` pre-sorted, so the
  unique index is what actually prevents two racing clients from forking a trend line.
- `sets.all()` pulls full history and computes trends client-side — correct and fast at
  personal scale. Don't build a `variant_stats` rollup until it actually hurts.

### Database (`supabase/schema.sql` + migrations)

- All weights are stored in kilograms; unit is a per-profile display preference
  (`profile.unit`). Every conversion goes through `src/lib/units.js` — never convert
  inline. Mixed units in storage is a months-long bug to track down.
- **RLS is the actual security boundary**, not a nicety: the anon key ships inside the app
  bundle, so the `auth.uid() = user_id` policies are what stop one user reading another's
  data. Any new table needs RLS enabled and a matching policy, following the existing
  `do $$ ... foreach t in array [...] $$` pattern.
- `pattern_flags`, `coach_recommendations`, `coach_plans` are the coach's output tables;
  an accepted recommendation becomes a `coach_plans` row consumed by the next session.
- Both usage caps fail *closed*: if the counter can't be read, the call is refused rather
  than billed.

## Rules that must survive changes

- **Store kilograms, display the preference.** All conversion through `units.js`.
- **RLS is the security boundary.** New table ⇒ RLS + policy.
- **Never swallow errors** in `db.js`.
- **Don't add an alias list to the resolver, or pre-seed its cache.**
- **Weight, reps and RIR are entered, never inferred.** No defaulting to the last set, the
  best set, or a hardcoded value. Fabricated effort ratings feed the plateau engine, which
  is the one thing the product cannot get wrong.
- **Never merge two variants silently.** When two descriptions might be the same lift, the
  lifter decides.

## Design reference (from the prototype)

`prototype/StrengthAI-standalone.html` is the high-fidelity UI reference — colors,
spacing, type and copy are final there. Recreate it with the Tailwind components in this
project rather than copying its inline styles.

- Type: Instrument Sans for interface text, JetBrains Mono for anything compared
  numerically (weights, reps, RIR, dates). Numbers are tabular.
- Color: `#101211` background, `#171A18` cards, `#272C29` borders, `#ECEFEA` text,
  `#8A928C`/`#5F665F` secondary/tertiary text, `#A8C9A2` accent (actions/positive,
  `#12160B` text on filled accent buttons), `#4C8E96` secondary data series,
  `#F2B544` warnings/plateaus/health advisories, `#F2705C` destructive.
- Radii: 11px controls, 14–16px inner cards, 18–20px outer cards, 22px sheets. Sheets
  animate up over 260ms on `cubic-bezier(.32,.72,0,1)`.
