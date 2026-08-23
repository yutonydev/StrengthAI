/**
 * Exercise vocabulary and input hygiene.
 *
 * ARCHITECTURE NOTE — read this before adding anything here.
 *
 * This file used to be a matching engine: it parsed free text against a hand-written
 * dictionary of movements and modifiers, and answered FIRST, with the model consulted only
 * when it drew a blank. That was backwards, and every serious resolver bug came from it —
 * fifty-odd hand-written aliases outranking the model on any phrase they happened to touch.
 * "heel elevated barbell squat" resolved as a plain barbell squat and silently merged two
 * different lifts into one trend line. "jm press" resolved as a tricep extension because
 * someone had written that alias by hand.
 *
 * The model is the authority now. What survives here is VOCABULARY, not matching: the
 * canonical strings the model is told to reuse so that two sessions describing the same
 * lift six weeks apart produce identical tags. That is the actual hard problem. Identifying
 * a Zottman curl is easy; making "SLDL", "stiff-legged deadlift" and "straight leg deads"
 * converge on one trend line is what keeps the coaching honest.
 *
 * Speed and cost are the cache's job (`exercise_aliases`), not this file's.
 *
 * DO NOT add alias lists or matching logic here. If the model gets something wrong, fix the
 * prompt or the vocabulary — never add a hand-written override.
 */

/*
 * The vocabulary itself lives in supabase/functions/_shared/vocab.ts and is re-exported
 * here, so every existing `from '@/lib/resolver'` import keeps working.
 *
 * It is not defined in this file because the Deno edge function needs the identical lists
 * and can only import from inside supabase/functions/. Two hand-kept copies is what this
 * replaces; they had already drifted. See that file's header for the full reasoning.
 */
import { normalizePhrase } from '../../supabase/functions/_shared/vocab.ts';

export {
  VOCAB_BASES,
  VOCAB_MODS,
  MUSCLES,
  BODY_PARTS,
  JOINT_ACTIONS,
  normalizePhrase,
} from '../../supabase/functions/_shared/vocab.ts';

/**
 * Set-counting weight per role. A secondary muscle takes real but partial stimulus, and
 * counting it as a full set would make every pressing movement look like shoulder volume.
 * Half is the usual convention in the hypertrophy literature and it is honest enough for
 * "you have done 14 sets of chest this week".
 */
export const ROLE_WEIGHT = { primary: 1, secondary: 0.5 };

/**
 * Looser key, for comparing two phrases to each other — NOT for the cache.
 *
 * `normalizePhrase` keeps hyphens, because canonical names contain them (`push-up`,
 * `straight-arm pulldown`, `v-bar`) and the cache key has to be stable. But a lifter who
 * writes "feet-up bench" one week and "feet up bench" the next means the same lift, and an
 * exact-match gate that says otherwise sends them to the model for a phrase they already
 * have. Folding hyphens to spaces here fixes the comparison without touching the key.
 */
function matchKey(text) {
  return normalizePhrase(text).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Title-cased movement name for display. Modifiers render as chips, not in the name. */
export function canonicalLabel(base) {
  return String(base || '')
    .split(' ')
    .map((w) => (w.length <= 2 && w !== 'ab' ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Free junk filter, client-side, before anything costs money.
 *
 * Deliberately permissive: it only rejects input that CANNOT be an exercise. Anything
 * plausible goes to the model, which is far better at judging than a regex. The model's own
 * refusal is the real filter; this just stops keyboard mashing and obvious nonsense from
 * being billable.
 */
export function isPlausibleExercise(text) {
  const t = normalizePhrase(text);
  if (!t) return { ok: false, reason: 'Type what you did.' };
  if (t.length < 3) return { ok: false, reason: 'A bit more detail — name the movement.' };
  if (t.length > 120) return { ok: false, reason: 'Too long. Just name the movement and how you did it.' };
  // A run of consonants this long is keyboard mashing, not a word. Five rather than six:
  // "asdfgh" is a home-row smash whose "sdfgh" is exactly five.
  //
  // There is deliberately NO "must contain a vowel" rule. Lifters type abbreviations —
  // SLDL, RDL, OHP, BSS — and every one of them is vowel-free. Rejecting those locally
  // would be the same mistake as the old dictionary: a hand-written rule overruling the
  // model on input it would have handled correctly. Vowel-free mashing ("xzcvbnm") is
  // caught by the consonant run anyway, which is the honest signal.
  if (/[bcdfghjklmnpqrstvwxz]{5,}/.test(t)) {
    return { ok: false, reason: "That does not look like an exercise." };
  }
  if (/^(.)\1+$/.test(t.replace(/\s/g, ''))) {
    return { ok: false, reason: "That does not look like an exercise." };
  }
  return { ok: true };
}

/**
 * Autocomplete from the lifter's own history. Free, offline, and the fastest path for
 * anything they train regularly — most logging should never reach the model at all.
 */
export function suggest(text, variants = [], limit = 8) {
  const q = matchKey(text);
  const ranked = [...variants].sort((a, b) => (b.uses || 0) - (a.uses || 0));
  if (!q) return ranked.slice(0, limit);

  const words = q.split(' ').filter((w) => w.length > 1);
  const scored = ranked
    .map((v) => {
      const hay = matchKey(
        `${v.base} ${(v.mods || []).join(' ')} ${v.source_text || ''} ${v.muscle || ''}`
      );
      const hits = words.filter((w) => hay.includes(w)).length;
      // Exactness is judged against what identifies the variant — the phrase they typed, or
      // its full tag set — never the whole haystack. The haystack also carries the muscle,
      // so it can essentially never equal the query, which silently disabled this tie-break
      // and let a more-used near-match outrank an exact one ("bench press" landing on the
      // feet-up narrow-grip variant instead of the plain one).
      const exact =
        matchKey(v.source_text || '') === q ||
        matchKey(`${v.base} ${(v.mods || []).join(' ')}`) === q
          ? 1
          : 0;
      return { v, hits, exact };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.exact - a.exact || b.hits - a.hits || (b.v.uses || 0) - (a.v.uses || 0));

  return scored.slice(0, limit).map((s) => s.v);
}

/**
 * Has this lifter logged this exact phrase before?
 *
 * The zero-cost, zero-latency path — checked against variants already in memory, so a
 * repeated exercise resolves instantly and offline. `source_text` is what they originally
 * typed, so this hits whenever they describe it the same way twice.
 */
export function findLocal(text, variants = []) {
  const q = matchKey(text);
  if (!q) return null;
  return variants.find((v) => matchKey(v.source_text || '') === q) || null;
}

/** Set counts per muscle across a list of resolved variants. Drives per-muscle volume. */
export function muscleSetCounts(sets = [], variantsById = {}) {
  const counts = {};
  for (const s of sets) {
    const variant = variantsById[s.variant_id];
    if (!variant) continue;
    const muscles = Array.isArray(variant.muscles) ? variant.muscles : [];
    for (const m of muscles) {
      const weight = ROLE_WEIGHT[m.role] ?? 0;
      if (!weight) continue;
      counts[m.name] = (counts[m.name] || 0) + weight;
    }
  }
  return counts;
}
