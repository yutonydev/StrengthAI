/**
 * resolve-exercise — turns a free-text description into a canonical exercise variant.
 *
 * The model is the authority. There is no dictionary fallback and no hand-written alias
 * list; an earlier design had both, and they outranked the model on any phrase they
 * happened to touch, which is how "jm press" became a tricep extension and
 * "heel elevated barbell squat" silently merged into a plain barbell squat.
 *
 * Order of operations:
 *   1. Junk filter (free)          — obvious nonsense never reaches the model
 *   2. Alias cache (free)          — anyone resolved this phrase before? Done.
 *   3. Model call (~$0.002)        — one call, cached forever after
 *
 * Runs server-side so the API key is never in the browser, and so the per-user monthly cap
 * cannot be edited by the client.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { json, preflight, userIdFrom } from '../_shared/http.ts';
import { capFromEnv, checkCap, monthStartKey } from '../_shared/usage.ts';
// The vocabulary and the cache-key normalization, shared verbatim with the browser —
// see _shared/vocab.ts for why a second copy here was a liability rather than a
// convenience. `norm` below stays local: it is a looser cleanup for model output, not
// the cache key, and the two must not be conflated.
import {
  BODY_PARTS,
  JOINT_ACTIONS,
  MUSCLES,
  normalizePhrase,
  VOCAB_BASES,
  VOCAB_MODS,
} from '../_shared/vocab.ts';

// Pinned to a version alias, never `-latest`.
//
// `claude-3-5-haiku-latest` broke this function once already: the underlying dated model
// retired, calls started returning 404, and because a 404 and a network failure land in the
// same catch on the client, the AI layer degraded to "I could not reach the coach just now"
// and read as bad wifi for days. A version alias tracks one generation and cannot silently
// jump; override via the RESOLVER_MODEL secret if it ever needs pinning harder.
const MODEL = Deno.env.get('RESOLVER_MODEL') ?? 'claude-haiku-4-5';

// Env-configurable like the chat coach's cap, so the limit can be changed — or exercised in
// a test — without redeploying the function. A cap you cannot reach on demand is a cap
// nobody ever verifies, which is how the broken one survived for months.
//
// Parsed through capFromEnv rather than Number(): a typo'd secret would otherwise become NaN
// and disable the cap entirely, silently.
const MONTHLY_CALL_CAP = capFromEnv(Deno.env.get('RESOLVER_MONTHLY_CAP'), 400, 'RESOLVER_MONTHLY_CAP');

const norm = (s: unknown) =>
  String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function buildPrompt(registry: Array<{ base: string; mods: string[] }>) {
  const modLines = Object.entries(VOCAB_MODS)
    .map(([group, list]) => `  ${group}: ${list.join(', ')}`)
    .join('\n');

  const known = registry.length
    ? registry.slice(0, 40).map((v) => `  ${v.base}${v.mods?.length ? ` [${v.mods.join(', ')}]` : ''}`).join('\n')
    : '  (none yet)';

  return `You identify strength-training exercises from how a lifter describes them, and tag
them so the same movement described differently on different days lands on the same trend
line. You know the whole domain — every variation, machine, implement and technique, however
obscure or regional. Trust that knowledge.

Return ONE JSON object, no prose, no markdown fence.

Accepted:
{"ok":true,"base":"...","mods":[...],"muscles":[{"name":"...","role":"primary|secondary"}],
 "joint_actions":[...],"body_part":"...","note":"...","confidence":"high|low"}

Rejected (not an exercise at all):
{"ok":false,"reason":"one short sentence, second person, telling them what to type instead"}

RULES

base — the movement itself, lowercase, no modifiers in it. Reuse one of these names when it
genuinely fits, so phrasings converge:
${VOCAB_BASES.map((b) => `  ${b}`).join('\n')}
If none fits, name it yourself in the same style. A movement missing from that list is
normal, not an error — do not force a bad fit. A JM press is its own movement, not a tricep
extension. A Zercher squat is a squat with a front-loaded rack position.

A lift that lifters are taught as its own movement gets its own base, even when a listed
movement is mechanically adjacent. A stiff-leg deadlift is not a Romanian deadlift with a
modifier — the knee angle, bar path and lumbar demand differ enough that their loads are not
comparable, so filing one under the other would merge two trend lines that should stay
separate. Same for a JM press versus a skull crusher. Only use base + modifier when the
movement really is the listed one performed differently.

mods — everything that changes how the movement loads. At most one per group:
${modLines}
Invent a tag when the description names something the list does not cover.

  THE CRITICAL RULE: every distinguishing term the lifter typed must appear in "base" or in
  "mods". If they wrote "zercher barbell squat" and you return mods ["barbell"], their
  Zercher squats merge into their ordinary barbell squats and months of trend data are
  quietly corrupted. Explaining the difference in "note" does NOT protect them — only the
  tag keeps the trend lines apart. When in doubt, tag it.

  Drop only words carrying no loading information: filler, set counts, "warmup", "felt good".

muscles — the muscles doing real work, using EXACTLY these names:
${MUSCLES.join(', ')}
  role "primary" for the muscles the movement is chosen to train — usually one, sometimes
  two. role "secondary" for other real contributors, ordered biggest first, AT MOST TWO.
  Judge by contribution, not by anatomy: include a muscle only if a lifter would feel it
  work and it would accumulate meaningful fatigue. A wide-grip lat pulldown is lats primary
  with biceps and upper back secondary — the rear delts do too little to be worth counting,
  and listing them inflates rear-delt volume in the lifter's weekly totals. Never list a
  muscle that is only stabilising or isometric. When in doubt, leave it out: a padded list
  corrupts per-muscle volume just as badly as a missing one.

joint_actions — every joint action the working muscles perform, as an ARRAY, using EXACTLY
these names:
${JOINT_ACTIONS.join(', ')}
  Anatomical, never trainer shorthand. Do NOT answer "vertical push" or "horizontal pull";
  name what the joints actually do. Most lifts have two or three actions, because a press
  works the shoulder and the elbow.
    machine shoulder press -> ["shoulder abduction","elbow extension"]
    lat pulldown          -> ["shoulder adduction","elbow flexion","scapular depression"]
    bench press           -> ["shoulder horizontal adduction","elbow extension"]
    barbell row           -> ["shoulder horizontal abduction","elbow flexion","scapular retraction"]
    squat                 -> ["knee extension","hip extension"]
    romanian deadlift     -> ["hip extension"]
    leg curl              -> ["knee flexion"]
    lateral raise         -> ["shoulder abduction"]
    cable curl            -> ["elbow flexion"]
    plank                 -> ["anti-extension"]
  List an action only where a muscle is doing work against the load. Isometric trunk demand
  counts (anti-extension, anti-rotation); passive stabilising does not. This is how the coach
  finds an imbalance at the joint that per-muscle volume totals hide.

body_part — one of: ${BODY_PARTS.join(', ')}. The primary muscle's group.

note — one or two sentences on why this variant loads differently from the plain version of
the movement: moment arm, range of motion, stability demand, joints involved. Concrete and
mechanical. Empty string if it is simply the standard version. Never give form coaching,
injury advice, or programming advice. Plain text only — no markdown, no asterisks for
emphasis, no backticks. The app renders this string verbatim, so any formatting characters
show up as literal punctuation.

confidence — "low" if you are inferring from an unfamiliar name rather than recognising the
movement. Be honest; a low-confidence answer is kept private rather than shared.

REJECT anything that is not a strength-training exercise: food, moods, questions, random
words. Cardio and stretching are also rejected — this app tracks loaded sets.

The lifter has already logged these variants. Reuse their exact base and mod strings when
the description matches one, so it continues an existing trend line rather than forking:
${known}`;
}

/**
 * Backfill — an OWNER-OPERATED migration, not a user feature.
 *
 * Adding a resolver field leaves every previously-resolved row without it, and partial
 * coverage is worse than none: per-joint volume would quietly exclude the lifts people have
 * been training longest, which are exactly where a plateau shows up first. Variants are
 * per-user rows, so a fix that signs in as one lifter only ever reaches one account.
 *
 * Gated on the service-role key rather than a user JWT for that reason: it has to cross
 * account boundaries, which no user is allowed to do. The key never ships in the app — the
 * project owner runs this once from their own machine.
 *
 * This only translates base + mods into joint actions. The caller owns the writes, so
 * nothing here can touch a row it was not asked about. One model call per batch, so the
 * whole database costs a fraction of a cent.
 */
async function handleBackfill(
  body: Record<string, unknown>,
  authHeader: string,
  serviceKey: string
): Promise<Response> {
  const bearer = authHeader.replace(/^Bearer\s+/i, '');
  if (!serviceKey || bearer !== serviceKey) {
    return json({ error: 'Backfill requires the service role key.' }, 403);
  }

  type Item = { id: string; base?: string; mods?: string[] };
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 60) as Item[];
  if (!items.length) return json({ ok: true, results: [] });

  const list = items
    .map((it, i) => `${i}: ${it.base ?? ''}${it.mods?.length ? ` (${it.mods.join(', ')})` : ''}`)
    .join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: `For each numbered exercise, list every joint action its working muscles perform.

Use EXACTLY these names:
${JOINT_ACTIONS.join(', ')}

Anatomical only, never trainer shorthand — no "vertical push" or "hip hinge". Name what the
joints do. Most lifts have two or three actions, because a press works the shoulder and the
elbow. A machine shoulder press is ["shoulder abduction","elbow extension"]. A lat pulldown
is ["shoulder adduction","elbow flexion","scapular depression"]. A leg curl is
["knee flexion"]. Isometric trunk demand counts; passive stabilising does not.

Reply with JSON only: {"results":[{"i":0,"joint_actions":["..."]}, ...]}
One entry per input number, in order. No prose.`,
      messages: [{ role: 'user', content: list }],
    }),
  });

  if (!res.ok) {
    console.error('[resolve-exercise] backfill model call failed', res.status, await res.text());
    return json({ ok: false, reason: 'Backfill could not reach the model.' }, 502);
  }

  const payload = await res.json();
  const raw = payload?.content?.[0]?.text ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return json({ ok: false, reason: 'Backfill got an unparseable reply.' }, 502);

  const rows = JSON.parse(match[0])?.results ?? [];
  const results = rows
    .map((row: Record<string, unknown>) => {
      const item = items[Number(row?.i)];
      if (!item) return null;
      const actions = [...new Set(
        (Array.isArray(row.joint_actions) ? row.joint_actions : [])
          .map((x: unknown) => norm(x))
          .filter((x: string) => JOINT_ACTIONS.includes(x))
      )];
      return actions.length ? { id: item.id, joint_actions: actions } : null;
    })
    .filter(Boolean);

  return json({ ok: true, results });
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const body = await req.json();

    // Backfill is checked BEFORE user auth: it authenticates with the service-role key
    // rather than a user JWT, so the ordinary "not signed in" gate would reject it.
    if (body.mode === 'backfill') {
      return await handleBackfill(body, authHeader, serviceKey);
    }

    const userId = await userIdFrom(authHeader);
    if (!userId) return json({ error: 'Not signed in' }, 401);


    const { text, registry = [] } = body;
    const phrase = normalizePhrase(text);
    if (!phrase) return json({ ok: false, reason: 'Type what you did.' });

    // Service-role client: reads the SHARED cache (rows owned by nobody) and writes usage.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ---- layer 2: cache -------------------------------------------------------------
    // Shared rows first (high-confidence, paid for by whoever typed it first), then this
    // lifter's private low-confidence rows.
    const { data: cached } = await admin
      .from('exercise_aliases')
      .select('*')
      .eq('phrase', phrase)
      .or(`user_id.is.null,user_id.eq.${userId}`)
      .order('user_id', { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle();

    if (cached) {
      return json({
        ok: true,
        base: cached.base,
        mods: cached.mods ?? [],
        muscles: cached.muscles ?? [],
        joint_actions: cached.joint_actions ?? [],
        muscle: cached.muscle,
        body_part: cached.body_part,
        note: cached.note ?? '',
        confidence: cached.confidence ?? 'high',
        source: 'cache',
      });
    }

    // ---- cap ------------------------------------------------------------------------
    // `resolver_usage` is a daily counter — (user_id, day, calls) — so a monthly cap is the
    // sum of this month's rows, at most 31 of them. Summing rather than counting rows is
    // load-bearing: a row count would cap a heavy user at 31 calls and never stop a light
    // one. See _shared/usage.ts for what the previous version got wrong.
    const { data: usageRows, error: usageErr } = await admin
      .from('resolver_usage')
      .select('calls')
      .eq('user_id', userId)
      .gte('day', monthStartKey());

    const cap = checkCap(usageRows, usageErr, MONTHLY_CALL_CAP);

    if (cap.failed) {
      // Fail closed. A counter that cannot be read is not evidence of zero usage.
      console.error('[resolve-exercise] usage read failed', usageErr);
      return json({ ok: false, unavailable: true, reason: 'I could not reach the coach just now.' });
    }

    if (cap.capped) {
      return json({
        ok: false,
        capped: true,
        reason: 'You have hit this month\'s limit for new exercise descriptions. Anything you have logged before still works.',
      });
    }

    // ---- layer 3: the model ---------------------------------------------------------
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      console.error('[resolve-exercise] ANTHROPIC_API_KEY is not set');
      return json({ ok: false, unavailable: true, reason: 'The coach is not configured.' });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system: buildPrompt(registry),
        messages: [{ role: 'user', content: phrase }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      // Loud on purpose. A silent failure here is indistinguishable from bad wifi on the
      // client, which is exactly how the retired-model outage went unnoticed for days.
      console.error('[resolve-exercise] anthropic error', res.status, detail.slice(0, 400));
      return json({ ok: false, unavailable: true, reason: 'I could not reach the coach just now.' });
    }

    const payload = await res.json();
    const raw = payload?.content?.[0]?.text ?? '';

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    } catch {
      console.error('[resolve-exercise] unparseable model output', raw.slice(0, 400));
      return json({ ok: false, unavailable: true, reason: 'I could not reach the coach just now.' });
    }

    // Atomic increment on the (user_id, day) counter. The previous insert named a `phrase`
    // column that does not exist and omitted the not-null `day`, so it failed on every
    // call — and its error was never checked, so nothing ever surfaced.
    const { error: bumpErr } = await admin.rpc('bump_resolver_usage', { target_user: userId });
    if (bumpErr) console.error('[resolve-exercise] usage bump failed', bumpErr);

    if (parsed.ok === false) {
      return json({
        ok: false,
        rejected: true,
        reason: String(parsed.reason ?? 'That does not look like an exercise.'),
      });
    }

    const base = norm(parsed.base);
    if (!base) {
      return json({ ok: false, unavailable: true, reason: 'I could not reach the coach just now.' });
    }

    let mods = Array.isArray(parsed.mods)
      ? [...new Set(parsed.mods.map(norm).filter((m: string) => m && m.length <= 24))]
      : [];

    // Safety net for the critical rule above. The model sometimes explains a distinguishing
    // term in `note` but omits it from `mods` — which merges the variant into the plain
    // movement's trend line, invisibly and permanently. Any content word from the input that
    // neither the base nor a mod accounts for becomes a tag, so a forgotten term degrades to
    // an ugly tag rather than corrupted data.
    const FILLER = new Set([
      'a', 'an', 'the', 'and', 'with', 'of', 'for', 'to', 'at', 'in', 'on', 'my', 'me',
      'using', 'use', 'used', 'plus', 'both', 'set', 'sets', 'rep', 'reps', 'x', 'then',
      'from', 'some', 'it', 'today', 'warmup', 'warm', 'up', 'superset', 'heavy', 'light',
      'easy', 'hard', 'normal', 'regular', 'standard', 'usual', 'did', 'do', 'doing',
    ]);
    const accounted = new Set(
      `${base} ${mods.join(' ')}`
        .split(/\s+/)
        .flatMap((w: string) => [w, w.replace(/s$/, ''), `${w}s`, w.replace(/-/g, ' ')])
    );
    const missed = phrase
      .split(/\s+/)
      .filter((w) => w && !FILLER.has(w) && !/^\d/.test(w) && !accounted.has(w));

    if (missed.length) {
      console.warn('[resolve-exercise] model dropped terms, tagging them', { phrase, base, mods, missed });
      mods.push(missed.join(' '));
    }
    mods = [...new Set(mods)].sort();

    const muscles = (Array.isArray(parsed.muscles) ? parsed.muscles : [])
      .map((m: Record<string, unknown>) => ({
        name: norm(m?.name),
        role: m?.role === 'secondary' ? 'secondary' : 'primary',
      }))
      .filter((m: { name: string }) => MUSCLES.includes(m.name));

    // Cap secondaries server-side as well as in the prompt. An over-long list silently
    // inflates per-muscle weekly volume, and the prompt is guidance rather than a
    // guarantee. Primaries are never trimmed.
    const trimmedMuscles = [
      ...muscles.filter((m: { role: string }) => m.role === 'primary'),
      ...muscles.filter((m: { role: string }) => m.role === 'secondary').slice(0, 2),
    ];

    const jointActions = [...new Set(
      (Array.isArray(parsed.joint_actions) ? parsed.joint_actions : [])
        .map((a: unknown) => norm(a))
        .filter((a: string) => JOINT_ACTIONS.includes(a))
    )];

    const primary = trimmedMuscles.find((m: { role: string }) => m.role === 'primary') ?? trimmedMuscles[0] ?? null;
    const part = norm(parsed.body_part);
    const confidence = parsed.confidence === 'low' ? 'low' : 'high';

    const result = {
      ok: true,
      base,
      mods,
      muscles: trimmedMuscles,
      joint_actions: jointActions,
      muscle: primary?.name ?? null,
      body_part: BODY_PARTS.includes(part) ? part : null,
      note: String(parsed.note ?? '').trim(),
      confidence,
      source: 'ai' as const,
    };

    // Cache it. High-confidence answers go in the SHARED cache so nobody pays for this
    // phrase again; low-confidence stays private, so a shaky inference cannot teach everyone
    // something wrong. Conflict target must match the NULLS NOT DISTINCT constraint from
    // migration 003 — a partial index cannot be inferred here and every write fails silently.
    const { error: cacheErr } = await admin.from('exercise_aliases').upsert(
      {
        phrase,
        base: result.base,
        mods: result.mods,
        muscles: result.muscles,
        joint_actions: result.joint_actions,
        muscle: result.muscle,
        body_part: result.body_part,
        note: result.note,
        confidence,
        source: 'ai',
        shared: confidence === 'high',
        user_id: confidence === 'high' ? null : userId,
      },
      { onConflict: 'phrase,user_id' }
    );

    // Never swallow: a failed cache write means every repeat of this phrase is billed again.
    if (cacheErr) console.error('[resolve-exercise] cache write failed', cacheErr);

    return json(result);
  } catch (err) {
    console.error('[resolve-exercise] unhandled', err);
    return json({ ok: false, unavailable: true, reason: 'I could not reach the coach just now.' });
  }
});
