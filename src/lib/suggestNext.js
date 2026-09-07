// What to add next, and why. The list this replaces ranked by lifetime use count — a fact
// about the whole history, not the session in front of you, giving the same six lifts on a
// push day and a leg day. This ranks by what actually follows what, in three tiers, least
// speculative first: the template remainder, then co-occurrence weighted by slot distance
// and recency, then a recency fallback so the list is never empty or silent about why.
// Pure — everything is passed in, and `now` is injectable so the reasons are testable.
import { canonicalLabel } from './resolver.js';

/** 1st, 2nd, 3rd… for "usually 3rd". */
function ordinal(n) {
  const suffix = ['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4)] || 'th';
  return `${n}${suffix}`;
}

/** Human gap, matching the prototype's wording. */
export function ago(ts, now = Date.now()) {
  const days = Math.round((now - ts) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

// Takes the registry, all sessions (completed ones inform the ranking), all sets, all
// templates, the ids already in the session, the template it was started from, and `now`.
// Returns [{ variant, reason }].
export function suggestNext({
  variants = [],
  sessions = [],
  sets = [],
  templates = [],
  currentOrder = [],
  templateId = null,
  now = Date.now(),
} = {}) {
  const byId = new Map(variants.map((v) => [v.id, v]));
  const done = new Set(currentOrder);
  const slot = currentOrder.length;

  const out = [];
  const seen = new Set();
  const push = (id, reason) => {
    if (done.has(id) || seen.has(id)) return;
    const variant = byId.get(id);
    if (!variant) return;
    seen.add(id);
    out.push({ variant, reason });
  };

  // canonicalLabel, not a second title-caser. The local copy this replaces had already
  // drifted: it lacked the 'ab' exception, so "ab wheel" rendered as "ab Wheel" in a reason
  // string sitting next to the same lift shown as "Ab Wheel" everywhere else.
  const nameOf = (id) => {
    const v = byId.get(id);
    return v ? canonicalLabel(v.base) : 'that lift';
  };

  // ---- 1. template remainder ---------------------------------------------------------
  // The least speculative answer there is: the session was started from a plan that says
  // what comes next. No inference, so it outranks everything below it.
  const tpl = templateId ? templates.find((t) => t.id === templateId) : null;
  if (tpl) {
    (tpl.exercise_order || []).forEach((id) => push(id, `next in ${tpl.name}`));
  }

  // ---- 2. co-occurrence ---------------------------------------------------------------
  const past = sessions.filter((s) => s.status === 'completed');
  const score = {};
  const why = {};
  const shared = {};

  past.forEach((p) => {
    const ids = p.exercise_order || [];
    // How much this past session looks like the one being built right now.
    const overlap = currentOrder.filter((id) => ids.includes(id)).length;
    const when = new Date(p.ended_at || p.started_at).getTime();
    const weeksAgo = (now - when) / 6048e5;
    // Floors at 0.15 rather than zero: a lift from four months ago is weak evidence, not no
    // evidence, and zeroing it would drop lifts that only ever appear in a training block.
    const recency = Math.max(0.15, 1 - weeksAgo / 14);

    ids.forEach((id, pos) => {
      if (done.has(id)) return;
      // Sitting near the slot being filled counts for more than merely co-occurring — third
      // exercise on past push days is better evidence for the third slot than the eighth is.
      const near = 1 / (1 + Math.abs(pos - slot));
      score[id] = (score[id] || 0) + (overlap * 2 + 0.25) * near * recency;
      shared[id] = Math.max(shared[id] || 0, overlap);

      if (!why[id]) {
        const prev = pos > 0 ? ids[pos - 1] : null;
        if (prev && done.has(prev)) why[id] = `usually after ${nameOf(prev)}`;
        else if (overlap > 0) why[id] = `usually ${ordinal(pos + 1)}`;
      }
    });
  });

  // Only claim session membership where the history shows it: a leg press has zero overlap
  // with a push session, so "often in this session" would contradict the app's own data.
  // Those fall through to tier 3. At slot 0 there is no session shape to contradict yet.
  Object.keys(score)
    .filter((id) => shared[id] > 0 || slot === 0)
    .sort((a, b) => score[b] - score[a])
    .forEach((id) => push(id, why[id] || (slot === 0 ? 'often trained' : 'often in this session')));

  // ---- 3. recency fallback ------------------------------------------------------------
  const sessionById = new Map(past.map((p) => [p.id, p]));
  const lastSeen = {};
  sets.forEach((s) => {
    const p = sessionById.get(s.session_id);
    if (!p) return;
    const t = new Date(p.ended_at || p.started_at).getTime();
    if (!lastSeen[s.variant_id] || t > lastSeen[s.variant_id]) lastSeen[s.variant_id] = t;
  });

  [...variants]
    .sort((a, b) => (lastSeen[b.id] || 0) - (lastSeen[a.id] || 0))
    .forEach((v) => push(v.id, lastSeen[v.id] ? `last trained ${ago(lastSeen[v.id], now)}` : 'not logged yet'));

  return out;
}
