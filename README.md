# StrengthAI

A strength-training log that reads your own data and tells you when a lift has stalled, and
why. No exercise database, no dropdowns. You type what you did in your own words and it
becomes a trend line.

**[strength-ai.vercel.app](https://strength-ai.vercel.app)** is live. Sign up and start
logging; there's nothing to install or configure.

React + Vite · Supabase (Postgres, auth, edge functions) · installable as a PWA.

---

## What it is

Most lifting apps ask you to pick your exercise from a list somebody else wrote. If your
lift isn't on it you pick the closest thing, and from then on your history is about a
movement you didn't do.

StrengthAI has no such list. **Your exercise registry is built entirely from what you
log.** You describe the lift the way you'd say it out loud (grip, attachment, stance,
tempo) and the app works out what it is, tags it, and keeps it on its own trend line.

That matters most in the negative case. `heel elevated barbell squat` must *not* quietly
merge into `barbell squat`: they load differently, and merging them corrupts months of
data in a way you cannot see. Equally, `SLDL`, `stiff-legged deadlift` and
`straight leg deads` typed six weeks apart must all land on the *same* line. Getting both
right is the product.

## How it works

### Logging is freeform

Type `zercher barbell squat`. You get back:

```
Squat  ·  barbell  ·  zercher
quads (primary), glutes (primary), upper back (secondary), abs (secondary)
knee extension, hip extension, spinal extension

"The front-rack elbow position keeps the torso upright and shifts load onto the quads
 and upper back, so it runs well under a back squat at the same effort."
```

Resolution passes through three gates, and only the last one costs anything:

1. **Your own history.** Typed this before? Instant, offline, free. Most logging stops here.
2. **Junk filter.** Rejects keyboard mash and empty input locally, before any network call.
3. **The model.** Checks a shared alias cache first, so only a phrase *nobody* has ever
   described costs a call. Cached forever after.

The rule that protects your data: **every distinguishing term you type must end up in the
base or the modifiers.** If you write "zercher barbell squat" and it comes back tagged only
`barbell`, your Zercher squats merge into your ordinary ones. This is stated in the prompt
and enforced again server-side. Any content word the model fails to account for is appended
as a tag, so a forgotten term degrades to an ugly label rather than corrupted data.

Nothing except outright rejection blocks logging. Offline, or out of credit, the set still
saves as typed and can be re-resolved later. You're standing at a rack; the workout has to
be loggable.

### The signal is RIR at matched load

Hold weight × reps constant and watch effort. If your reps-in-reserve falls while the load
hasn't moved, the same work is costing more. That's fatigue, not weakness. Comparing raw
RIR across different loads tells you nothing, so the analysis only ever uses your
*most-repeated* weight × reps for that lift, and reports the load it measured at.

A plateau needs **three matched sessions and a full point of RIR lost**. Half a point is
inside the noise of self-reported effort.

### Muscles and joints, not just exercises

Every variant is tagged with the muscles it trains (primary counts as a full set, secondary
as half) and the joint actions it performs. This is what makes cross-movement fatigue
visible: a bench press stalls because the triceps absorbed eighteen sets across bench, dips
and pushdowns. No per-exercise view can see that.

### Two kinds of coaching

**Insights** (`/coach/insights`) is deterministic and free, with no model calls at all. It
runs pure functions over your logged sets: plateau detection per lift, a program-level check
when several lifts stall together alongside falling readiness, goal projections, weekly
reports. Every function either has data-backed grounds to claim something or explicitly
declines to.

**Chat** (`/coach`) is conversational. It can answer general training-science questions and
questions about your own training. It never queries the database. Instead it receives a
*facts payload* computed locally by tested functions, so every number it quotes was derived
from sets you actually logged and can be checked against your own Progress screen.

It can do exactly two things: save a template, and stage exercises into a session. It
cannot write a weight, a rep count or an RIR. Those are yours to enter, always.

### What it deliberately won't do

- **No medical or injury claims.** Ask about pain and you get the real general mechanisms,
  plus an explicit hand-off to someone who can watch you move. It cannot see you lift and
  won't pretend otherwise.
- **No fabricated numbers.** If the data doesn't support an answer, it says so. A set won't
  save until you've entered weight, reps *and* effort. Nothing is inferred from your history
  or defaulted on your behalf.
- **No silent merging.** When two descriptions might be the same lift, you decide.

---

## Getting it on your phone

Open **[strength-ai.vercel.app](https://strength-ai.vercel.app)** and sign up with an email
and password. That's the whole setup.

It's a PWA, so add it to your home screen from the browser's share menu (iOS Safari:
*Share > Add to Home Screen*; Android Chrome: *menu > Add to Home screen*). It then opens
without browser chrome and keeps you signed in, which is how it's meant to be used standing
at a rack. Your unit preference, kg or lb, is under Settings.

---

## Using it

**The loop.** Start a workout from Home. Answer the ten-second readiness check, or skip it.
Tap *Describe an exercise* and type what you're doing. Log each set: weight, reps, and how
many reps you had left. A rest timer starts automatically and survives a page reload. Finish
when you're done.

**Templates** (`/workouts`) save a reusable exercise order. Starting one names the session
and pre-loads the lifts. You can also ask the chat coach to build one.

**Progress** shows volume per session, and RIR at matched load per exercise with a picker.
When a lift is flagged, the stability tile becomes a link straight to its diagnosis.

**Session detail** is read-only history. If a session was compromised, whether by four
hours' sleep, a flight or illness, exclude it from trends with a reason. It stays in your
history; it just stops distorting the analysis. The app never guesses *why* a week was bad.
You tell it.

**Settings** holds your unit (kg or lb), an optional diet phase so the coach can separate a
real plateau from a calorie deficit, and weekly session targets per body part.

---

## Running it yourself

Only needed if you're forking the project or working on the code. Everything below is for
standing up your own instance; users of the live app don't touch any of it.

```bash
npm install
```

Create `.env.local`:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

**Database.** In the Supabase SQL editor, run `supabase/schema.sql` first, then the
migrations in numerical order: `002`, `003`, `004`, `005`, `007`, `008`. There is no `006`;
it was superseded by `007`. Everything is idempotent, so re-running is safe.

**Edge functions.** These hold the API key server-side and enforce the usage caps where the
client can't edit them:

```bash
supabase functions deploy resolve-exercise
supabase functions deploy coach-chat
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Optional secrets, all with sane defaults: `RESOLVER_MODEL`, `COACH_CHAT_MODEL`,
`RESOLVER_MONTHLY_CAP` (400), `COACH_CHAT_DAILY_CAP` (40). Pin models to a version alias,
never `-latest`. A retired dated model once made the whole AI layer read as bad wifi for
days.

```bash
npm run dev     # http://localhost:5173
npm test        # 112 tests, no database or network needed
npm run lint
npm run build
```

Deploying the frontend is a static build, so any host works. The live instance is on Vercel
with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set as build-time environment
variables. Both are safe to expose: the anon key is designed to ship in the bundle, and RLS
is what actually protects the data.

### Cost

This only applies to whoever runs the instance, since the API key lives server-side.

Resolving is close to free: repeats never leave the device, anything anyone has described
before comes from the shared cache, and junk never reaches the model. Only a genuinely novel
phrase costs a call (~$0.002), and it's cached permanently. Realistically a few cents in your
first month, then near zero.

Chat is the opposite. Every turn is personal and nothing amortises, so the daily cap is the
only brake. Both caps fail *closed*: if the usage counter can't be read, the call is refused
rather than billed.

---

## Architecture

Pure logic is separated from I/O on purpose, so the hard-to-get-right parts are testable
without a database or a UI.

```
src/lib/resolver.js       normalization, junk filter, local match (re-exports the vocabulary)
src/lib/coach.js          matched-RIR series, plateau + program detection, goal projection,
                          per-muscle volume, the facts payload for the chat coach
src/lib/units.js          kg/lb, RIR → RPE, readiness score
src/lib/suggestNext.js    "up next" ranking: template order, then co-occurrence, then recency
src/lib/bodyParts.js      body-part order and labels for the weekly-goals UI
src/lib/localState.js     the localStorage keys, and the one place that clears them

src/api/db.js             the ONLY file that touches Supabase
src/api/queryCache.js     stale-while-revalidate cache; writes invalidate their own keys
src/api/resolveExercise.js  the three resolution gates
src/api/coachChat.js      builds the facts payload, calls the chat function

src/hooks/useQuery.js         read one cached query
src/hooks/useVariantMap.js    id → variant lookup
src/hooks/useExerciseOrder.js add / reorder, shared by the workout and template screens

supabase/schema.sql            tables, indexes, RLS policies
supabase/functions/            resolve-exercise, coach-chat
supabase/functions/_shared/    vocab.ts (the vocabulary, shared with the browser),
                               usage.ts (cap logic), http.ts (CORS, JSON, the user gate)
public/sw.js                   offline shell: network-first HTML, cache-first hashed assets
prototype/                     the original high-fidelity UI reference
```

**The exercise vocabulary lives in `supabase/functions/_shared/vocab.ts`, not in
`src/lib/resolver.js`.** It is the one thing the browser and the Deno edge function both
need to agree on exactly, and a Deno function can only import from inside
`supabase/functions/`. `resolver.js` re-exports it, so `from '@/lib/resolver'` still works.

Screens live in `src/pages`: Home, Workout, Progress, CoachChat, Coach (insights),
Templates, TemplateEditor, SessionDetail, Settings, and the four auth pages.

### Rules that must survive changes

**Store kilograms, display the preference.** Every conversion goes through `units.js`. Mixed
units in the database is a months-long bug.

**RLS is the security boundary, not a nicety.** The anon key ships inside the app bundle, so
the `auth.uid() = user_id` policies are the only thing stopping one lifter reading another's
data. Any new table needs RLS enabled and a matching policy.

**Never swallow errors.** `db.js` throws on every Supabase error deliberately, with no bare
`catch {}`. Catch at the UI layer and show the user something.

**Don't add an alias list to the resolver.** Hand-written aliases outranked the model on any
phrase they touched, and were confidently wrong in ways nobody could see. If the model gets
something wrong, fix the prompt or the vocabulary.

**Weight, reps and RIR are entered, never inferred.** No defaulting to your last set, your
best set, or a hardcoded value. Fabricated effort ratings feed the plateau engine, which is
the one thing the product cannot get wrong.

---

## Not built yet

- Apple Health sync (needs a Capacitor plugin and HealthKit entitlements)
- Sharing (needs image generation and a public link surface)
- App Store distribution
- A `variant_stats` rollup table. `sets.all()` pulls full history and computes trends
  client-side, which is correct and fast at personal scale. Don't build the rollup until
  it actually hurts.
