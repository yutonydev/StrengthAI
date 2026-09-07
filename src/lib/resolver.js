// Exercise vocabulary and input hygiene — NOT a matching engine. It used to be, and every
// serious resolver bug came from hand-written aliases outranking the model. DO NOT add
// alias lists or matching logic; fix the prompt or the vocabulary instead. The lists live
// in supabase/functions/_shared/vocab.ts — the only place the Deno edge function can import
// from — and are re-exported so `from '@/lib/resolver'` still works.
import { normalizePhrase } from '../../supabase/functions/_shared/vocab.ts';

export {
  VOCAB_BASES,
  VOCAB_MODS,
  MUSCLES,
  BODY_PARTS,
  JOINT_ACTIONS,
  normalizePhrase,
} from '../../supabase/functions/_shared/vocab.ts';

// Set-counting weight per role. Half for secondary: real but partial stimulus, and a full
// set would make every press look like shoulder volume.
export const ROLE_WEIGHT = { primary: 1, secondary: 0.5 };

// Looser key for comparing two phrases — NOT for the cache. normalizePhrase keeps hyphens
// because canonical names contain them, but "feet-up bench" and "feet up bench" are the
// same lift; folding them here fixes the comparison without touching the key.
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

// Free junk filter, before anything costs money. Rejects only what CANNOT be an exercise —
// the model is the real filter, this just stops keyboard mashing from being billable.
export function isPlausibleExercise(text) {
  const t = normalizePhrase(text);
  if (!t) return { ok: false, reason: 'Type what you did.' };
  if (t.length < 3) return { ok: false, reason: 'A bit more detail — name the movement.' };
  if (t.length > 120) return { ok: false, reason: 'Too long. Just name the movement and how you did it.' };
  // Five, not six: "asdfgh" is a home-row smash whose "sdfgh" is exactly five. There is
  // deliberately no "must contain a vowel" rule — SLDL, RDL, OHP and BSS are all vowel-free,
  // and vowel-free mashing is caught by the consonant run anyway.
  if (/[bcdfghjklmnpqrstvwxz]{5,}/.test(t)) {
    return { ok: false, reason: "That does not look like an exercise." };
  }
  if (/^(.)\1+$/.test(t.replace(/\s/g, ''))) {
    return { ok: false, reason: "That does not look like an exercise." };
  }
  return { ok: true };
}

// Autocomplete from the lifter's own history. Free, offline, and the fastest path for
// anything trained regularly — most logging should never reach the model.
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
      // Exactness is judged against what identifies the variant, never the whole haystack —
      // that also carries the muscle, so it could never equal the query and this tie-break
      // was silently dead, letting a more-used near-match outrank an exact one.
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

// Has this lifter logged this exact phrase before? Zero-cost and offline, matched on
// `source_text` — what they originally typed — so describing it the same way twice hits.
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
