/**
 * Coaching analysis. Pure functions over logged sets — no network, no model calls.
 *
 * Everything here is deliberately conservative: it only claims something when the
 * data supports it, and it says why. That was the strongest part of the Base44
 * version and it survives the rebuild intact.
 */
import { canonicalLabel, muscleSetCounts } from './resolver.js';
import { display } from './units.js';

/** Epley estimated 1RM. Fine up to ~10 reps, drifts optimistic beyond that. */
export const e1rm = (weightKg, reps) => (weightKg || 0) * (1 + (reps || 0) / 30);

/** How many recent sets count as "now" for a goal. Roughly the last two or three sessions. */
const CURRENT_WINDOW = 9;

/**
 * Where a lift stands today: the best estimated 1RM across the last few sets.
 *
 * Best-of-a-window rather than the single latest set, because the newest set is often a
 * back-off or a warmup and would report a lifter as having gone backwards on a day they
 * hit a PR earlier in the session.
 *
 * This existed in four places — the goal card, both goal paths in the Insights screen, and
 * the facts payload — each re-deriving `.slice(-9)` and `Math.max(...map(e1rm))` by hand.
 * They agreed, but the number drives a progress bar, a projection, the "target reached"
 * flip that writes to the database, and what the chat coach quotes back. Four copies of the
 * definition of "where you are now" is four chances for those to start disagreeing.
 *
 * @param {Array} sets rows for ONE variant, in any order
 * @returns {number} kilograms, 0 when there is no history
 */
export function currentE1rm(sets = []) {
  const recent = [...sets]
    .sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
    .slice(-CURRENT_WINDOW);
  return recent.length ? Math.max(...recent.map((s) => e1rm(s.weight_kg, s.reps))) : 0;
}

/**
 * The back-off fraction applied to a plateaued lift's matched load.
 *
 * Shared because it is quoted and then acted on in two different files: PlateauCard renders
 * "drop to N" and Coach.jsx writes that target into coach_plans. If those two drifted the
 * app would promise one weight and program another — and the lifter would only find out at
 * the rack, with the card no longer on screen to compare against.
 */
export const BACKOFF_FACTOR = 0.88;

/**
 * RIR at matched load, one point per session.
 *
 * The signal: hold weight × reps constant and watch effort. If RIR falls while the
 * load is unchanged, the same work is costing more — fatigue, not weakness. Comparing
 * raw RIR across different loads tells you nothing, which is why this only uses the
 * lifter's most-repeated weight × reps combination for that variant.
 *
 * @param {Array} sets     rows for ONE variant: { session_id, weight_kg, reps, rir }
 * @param {Object} dates   { [session_id]: ISO date string }
 * @param {Set}   excluded session ids the lifter excluded from analysis
 * @returns {{ series: Array<{sessionId,date,rir}>, modal: {weightKg,reps}|null }}
 *
 * `series` is chronological and empty when there is nothing honest to say.
 *
 * `modal` is the weight × reps the series was measured at, and callers need it. The load a
 * plateau refers to is the modal one, NOT the most recently logged set — those differ every
 * time the lifter deloads, takes a back-off set, or changes rep scheme. Reporting the latest
 * set as "the load you stalled at" also propagates into the back-off recommendation, which is
 * computed as a percentage of it, so the wrong number becomes wrong programming advice.
 */
export function matchedRirSeries(sets = [], dates = {}, excluded = new Set()) {
  const nothing = { series: [], modal: null };
  const usable = sets.filter((s) => s.rir != null && !excluded.has(s.session_id));
  if (!usable.length) return nothing;

  const counts = {};
  for (const s of usable) {
    const key = `${s.weight_kg}|${s.reps}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  let modalKey = null, modalCount = 0;
  for (const [key, n] of Object.entries(counts)) {
    if (n > modalCount) { modalCount = n; modalKey = key; }
  }
  // one occurrence is a data point, not a trend
  if (!modalKey || modalCount < 2) return nothing;

  const [weightKg, reps] = modalKey.split('|').map(Number);

  const bySession = {};
  for (const s of usable) {
    if (`${s.weight_kg}|${s.reps}` !== modalKey) continue;
    (bySession[s.session_id] = bySession[s.session_id] || []).push(s);
  }

  const series = Object.keys(bySession)
    .sort((a, b) => new Date(dates[a] || 0) - new Date(dates[b] || 0))
    .map((sessionId) => {
      const group = bySession[sessionId];
      const rir = group.reduce((a, s) => a + s.rir, 0) / group.length;
      return { sessionId, date: dates[sessionId], rir: Math.round(rir * 10) / 10 };
    });

  return { series, modal: { weightKg, reps } };
}

/**
 * Is this lift stalled?
 * Needs at least three matched sessions and a full point of RIR lost. A single bad
 * session is not a plateau, and half a point is inside the noise of self-reported RIR.
 */
export function detectPlateau(series = []) {
  // Every key the full verdict carries is present here too, valued null where there is
  // genuinely nothing to say. The short branch used to return {stalled, reason} alone, and
  // `buildCoachFacts` ships this object straight to the chat coach — which then saw a
  // verdict missing `stability`, `drop` and `watch` entirely, and had to guess whether the
  // absence meant "stable" or "unknown". A stated null is a fact it can read; a missing key
  // is a gap it fills in.
  if (series.length < 3) {
    return {
      stalled: false,
      watch: false,
      drop: null,
      sessions: series.length,
      stability: null,
      reason: 'not enough matched sessions',
    };
  }
  const drop = series[0].rir - series[series.length - 1].rir;
  const rirs = series.slice(-5).map((p) => p.rir);
  const mean = rirs.reduce((a, b) => a + b, 0) / rirs.length;
  const sd = Math.sqrt(rirs.reduce((a, b) => a + (b - mean) ** 2, 0) / rirs.length);

  return {
    stalled: drop >= 1,
    watch: drop >= 0.5 && drop < 1,
    drop: Math.round(drop * 10) / 10,
    sessions: series.length,
    stability: drop >= 1 ? 'declining' : sd >= 0.75 ? 'volatile' : 'stable',
  };
}

/**
 * Program-level check.
 *
 * The Base44 version diagnosed each exercise alone, so four lifts stalling in the same
 * fortnight became four unrelated plateaus. Across different movement patterns that is
 * almost never four problems — it's recovery. This looks for that.
 *
 * @param {Array} perVariant [{ variantId, name, series }]
 * @param {Array} readiness  [{ created_at, score }] chronological
 */
export function detectProgramPattern(perVariant = [], readiness = []) {
  const stalled = perVariant
    .map((v) => ({ ...v, verdict: detectPlateau(v.series) }))
    .filter((v) => v.verdict.stalled);

  if (stalled.length < 2) return { detected: false, stalled };

  // Readiness moving the same way turns a coincidence into a diagnosis. Over the WHOLE
  // series rather than readinessTrend's default recent window: a program-level pattern is a
  // claim about the block, so the comparison has to span the block. The half-split maths
  // itself is shared rather than repeated inline, which is what it used to be.
  const trend = readinessTrend(readiness, readiness.length);

  return {
    detected: true,
    stalled,
    readinessTrend: trend,
    confidence: stalled.length >= 3 && trend != null && trend < -0.5 ? 'high' : 'moderate',
  };
}

/**
 * Goal projection.
 *
 * Straight-line extrapolation says "+2 lb/week forever", which is false — gains
 * decelerate as you approach your ceiling. So this returns the linear number AND a
 * decay-adjusted range, and refuses to project at all when the rate isn't positive.
 *
 * The decay multipliers (1.4×–2.1×) are a deliberate blunt instrument. A per-lifter
 * model would be better, and needs more data than a new user has.
 */
export function projectGoal({ currentKg, targetKg, history = [], weeksObserved = 8 }) {
  if (!history.length) return { projectable: false, reason: 'no history' };

  const earlyWindow = history.slice(0, Math.max(1, Math.floor(history.length / 3)));
  const earlyBest = Math.max(...earlyWindow.map((s) => e1rm(s.weight_kg, s.reps)));
  const ratePerWeek = (currentKg - earlyBest) / weeksObserved;
  const gap = targetKg - currentKg;

  if (gap <= 0) return { projectable: false, achieved: true, ratePerWeek };
  if (ratePerWeek <= 0.1) {
    return {
      projectable: false,
      achieved: false,
      ratePerWeek: Math.round(ratePerWeek * 100) / 100,
      reason: 'no positive rate over the observed window — a projection here would be fiction',
    };
  }

  const linearWeeks = Math.ceil(gap / ratePerWeek);
  return {
    projectable: true,
    achieved: false,
    ratePerWeek: Math.round(ratePerWeek * 100) / 100,
    linearWeeks,
    decayWeeks: [Math.ceil(linearWeeks * 1.4), Math.ceil(linearWeeks * 2.1)],
    caveat: 'Linear pace assumes a constant rate forever. Strength decelerates near your ceiling, so treat the decay-adjusted range as the honest answer.',
  };
}

/** Sunday-start week containing `d`. */
export function weekRange(d = new Date()) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  start.setDate(d.getDate() - d.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return [start, end];
}

export function sessionVolumeKg(sets = []) {
  return sets.reduce((a, s) => a + (s.weight_kg || 0) * (s.reps || 0), 0);
}

/* --------------------------------------------------------- muscle aggregation */

const DAY = 864e5;

/**
 * The muscles a variant trains, tolerating the pre-004 row shape.
 *
 * Variants resolved before migration 004 carry a single `muscle` string instead of the
 * `muscles` array. Treating those as untagged would silently drop the lifts someone has
 * been training longest out of every per-muscle total — exactly the rows that matter most.
 */
function musclesOf(variant) {
  if (Array.isArray(variant?.muscles) && variant.muscles.length) return variant.muscles;
  return variant?.muscle ? [{ name: variant.muscle, role: 'primary' }] : [];
}

/** variantsById in the shape `muscleSetCounts` wants, with legacy rows normalized. */
function normalizedById(variants) {
  const out = {};
  for (const v of variants) out[v.id] = { ...v, muscles: musclesOf(v) };
  return out;
}

/**
 * Per-muscle volume for the last 7 days against the 4 weeks before it.
 *
 * Rolling 7 days rather than the calendar week, deliberately: fatigue does not reset on
 * Sunday, and a calendar window shows an empty map every Monday morning.
 *
 * The point of tagging muscles at resolve time is this function. Bench, dips and pushdowns
 * all bill the triceps, and no per-exercise view can see that — which is why a bench press
 * can stall for reasons that have nothing to do with the bench press.
 *
 * @param {object} input
 * @param {Array}  input.variants
 * @param {Array}  input.sets              every logged set
 * @param {Array}  input.sessions          for set → date
 * @param {Array}  input.stalledVariantIds variants whose effort is climbing at matched load
 * @param {number} input.now               injectable so the window is testable
 */
export function muscleVolume({
  variants = [],
  sets = [],
  sessions = [],
  stalledVariantIds = [],
  now = Date.now(),
} = {}) {
  const byId = normalizedById(variants);
  const wkStart = now - 7 * DAY;
  const baseFrom = wkStart - 28 * DAY;

  const sessionTime = new Map(sessions.map((s) => [s.id, new Date(s.started_at).getTime()]));
  const between = (from, to) =>
    sets.filter((s) => {
      const t = sessionTime.get(s.session_id);
      return t != null && t >= from && t < to;
    });

  const round = (o, f) => {
    const out = {};
    for (const k of Object.keys(o)) out[k] = f(o[k]);
    return out;
  };

  const curSets = between(wkStart, now);
  const trainedNow = new Set(curSets.map((s) => s.variant_id));
  const thisWeek = round(muscleSetCounts(curSets, byId), (n) => Math.round(n * 2) / 2);
  // Divided by 4 because the baseline window is four times as long as the current one.
  const baseline = round(muscleSetCounts(between(baseFrom, wkStart), byId), (n) => Math.round((n / 4) * 10) / 10);

  // Which muscles are being trained by a lift whose effort is climbing. Primary only —
  // a secondary contribution is too small to explain why a lift stopped moving.
  const hotMuscles = {};
  for (const id of new Set(stalledVariantIds)) {
    const v = byId[id];
    if (!v) continue;
    for (const m of musclesOf(v).filter((x) => x.role === 'primary')) {
      (hotMuscles[m.name] = hotMuscles[m.name] || []).push(canonicalLabel(v.base));
    }
  }

  const names = [...new Set([...Object.keys(thisWeek), ...Object.keys(baseline)])];
  const rows = names
    .map((name) => {
      const setsNow = thisWeek[name] || 0;
      const avg = baseline[name] || 0;
      const ratio = avg > 0 ? setsNow / avg : setsNow > 0 ? 1 : 0;
      const climbing = !!hotMuscles[name];

      let tag = 'steady';
      if (climbing && ratio >= 1.15) tag = 'overreaching';
      else if (climbing) tag = 'effort up';
      else if (ratio >= 1.35) tag = 'ramping';
      else if (setsNow === 0 && avg >= 3) tag = 'untrained';
      else if (ratio < 0.6) tag = 'backed off';

      const sources = variants
        .filter((v) => trainedNow.has(v.id) && musclesOf(v).some((m) => m.name === name))
        .slice(0, 5)
        .map((v) => canonicalLabel(v.base));

      return {
        name,
        sets: setsNow,
        baseline: avg,
        ratio: Math.round(ratio * 100) / 100,
        climbing,
        climbingLifts: hotMuscles[name] ?? [],
        tag,
        sources,
      };
    })
    .filter((r) => r.sets > 0 || r.tag === 'untrained')
    .sort((a, b) => Number(b.climbing) - Number(a.climbing) || b.ratio - a.ratio);

  // Rank by how many stalling lifts share the muscle, not by set count. Three lifts
  // converging on one muscle is the finding; a high-volume muscle with one stalled lift
  // is just a busy muscle.
  const candidates = rows
    .filter((r) => r.climbingLifts.length >= 2)
    .sort((a, b) => b.climbingLifts.length - a.climbingLifts.length || b.sets - a.sets);

  // Only call it a concentration when volume is ACTUALLY elevated. Shared stalls on a
  // muscle doing LESS work than usual is the opposite finding, and telling someone to cut
  // volume that is already down would be actively wrong.
  const shared = candidates.find((r) => r.ratio >= 1.15) ?? null;
  const sharedLow = shared ? null : candidates[0] ?? null;

  return {
    windowStart: new Date(wkStart).toISOString(),
    windowEnd: new Date(now).toISOString(),
    rows,
    hotMuscles,
    shared,
    sharedLow,
  };
}

/** Half-split trend over the most recent readiness entries. Null until there are four. */
export function readinessTrend(readiness = [], window = 8) {
  const rows = readiness.slice(-window);
  if (rows.length < 4) return null;
  const half = Math.floor(rows.length / 2);
  const mean = (a) => a.reduce((x, r) => x + (r.score || 0), 0) / (a.length || 1);
  return Math.round((mean(rows.slice(half)) - mean(rows.slice(0, half))) * 10) / 10;
}

/* ------------------------------------------------------------- facts payload */

/** A note the model reads verbatim is a note that can be long. Cap it. */
const NOTE_CAP = 400;

/**
 * Which variants reach the model.
 *
 * Every chat turn ships this payload, so a registry that only ever grows would make every
 * question slowly more expensive for exercises the lifter abandoned years ago. But trimming
 * is the more dangerous direction: an exercise the model cannot see is one it will confidently
 * say the lifter does not have. So the rule is generous, and whatever it drops is counted.
 */
const RECENT_DAYS = 90;
const TOP_BY_USES = 30;

/**
 * Everything the chat coach is allowed to know, computed here rather than queried there.
 *
 * The model never touches the database. It gets this object and nothing else, which is
 * what makes "cite the numbers you used" enforceable — every figure it can quote was
 * computed by a tested function above, so a fabricated number is one the lifter can catch
 * by looking at the same screens.
 *
 * Weights are carried in both kg (storage truth) and the lifter's display unit, because
 * asking a model to convert is asking it to do arithmetic it is bad at, and a wrong number
 * in a coaching answer is worse than no answer.
 */
export function buildCoachFacts({
  variants = [],
  sets = [],
  sessions = [],
  readiness = [],
  goals = [],
  excludedSessionIds = new Set(),
  profile = null,
  now = Date.now(),
} = {}) {
  const unit = profile?.unit ?? 'lb';
  const datesBySession = {};
  for (const s of sessions) datesBySession[s.id] = s.started_at;

  // Built once rather than a `variants.find(...)` inside the goals map below, which was a
  // linear scan of the whole registry per goal.
  const variantsById = new Map(variants.map((v) => [v.id, v]));

  const setsByVariant = new Map();
  for (const s of sets) {
    if (!setsByVariant.has(s.variant_id)) setsByVariant.set(s.variant_id, []);
    setsByVariant.get(s.variant_id).push(s);
  }

  const chrono = (rows) => [...rows].sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at));

  // Analysis runs over the whole history, not the trimmed list below. The cap is about how
  // much is worth sending, and a plateau is still a plateau whether or not its lift made the
  // cut — detectProgramPattern in particular needs every stalling lift to see a program.
  const analysed = variants
    .filter((v) => setsByVariant.has(v.id))
    .map((v) => {
      const rows = setsByVariant.get(v.id);
      const { series, modal } = matchedRirSeries(rows, datesBySession, excludedSessionIds);
      const last = chrono(rows).at(-1);
      return {
        variantId: v.id,
        name: canonicalLabel(v.base),
        mods: v.mods ?? [],
        muscles: musclesOf(v),
        jointActions: v.joint_actions ?? [],
        sets: rows.length,
        matchedSessions: series.length,
        plateau: detectPlateau(series),
        // The load the plateau verdict refers to. Distinct from lastSet, which is simply the
        // newest set and is often at a different weight.
        matchedLoad: modal
          ? { weightKg: modal.weightKg, weight: display(modal.weightKg, unit), reps: modal.reps }
          : null,
        lastSet: {
          weightKg: last.weight_kg,
          weight: display(last.weight_kg, unit),
          reps: last.reps,
          rir: last.rir ?? null,
          loggedAt: last.logged_at,
        },
        // Same row as `lastSet` above — chrono() sorts a copy, so calling it twice sorted
        // the identical array twice for one field.
        lastTrainedAt: last.logged_at,
        // kept out of the payload — the model gets the verdict, not 40 raw points
        series,
      };
    })
    .sort((a, b) => b.sets - a.sets);

  const program = detectProgramPattern(
    analysed.map(({ variantId, name, series }) => ({ variantId, name, series })),
    readiness
  );

  const muscles = muscleVolume({
    variants,
    sets,
    sessions,
    stalledVariantIds: analysed.filter((a) => a.plateau.stalled).map((a) => a.variantId),
    now,
  });

  const activeGoals = goals
    .filter((g) => g.status === 'active')
    .map((g) => {
      const rows = chrono(setsByVariant.get(g.variant_id) ?? []);
      const currentKg = currentE1rm(rows);
      const variant = variantsById.get(g.variant_id);
      return {
        variantId: g.variant_id,
        name: variant ? canonicalLabel(variant.base) : 'Unknown exercise',
        targetKg: g.target_kg,
        target: display(g.target_kg, unit),
        targetReps: g.target_reps,
        currentKg: Math.round(currentKg * 10) / 10,
        current: display(currentKg, unit),
        projection: projectGoal({ currentKg, targetKg: g.target_kg, history: rows }),
      };
    });

  // Verbatim, because a note is the only place the lifter says something the numbers
  // cannot. Truncated rather than summarised — a paraphrase here would be the model
  // inventing context and then reasoning from it.
  const notes = [...sessions]
    .filter((s) => s.notes?.trim())
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
    .slice(0, 5)
    .map((s) => ({
      date: s.started_at,
      note: s.notes.trim().slice(0, NOTE_CAP),
      truncated: s.notes.trim().length > NOTE_CAP,
    }));

  const weekAgo = now - 7 * DAY;
  const sessionsThisWeek = sessions.filter(
    (s) => new Date(s.started_at).getTime() >= weekAgo && new Date(s.started_at).getTime() <= now
  ).length;

  // ---- which variants reach the model ------------------------------------------------
  const analysedById = new Map(analysed.map((a) => [a.variantId, a]));
  const cutoff = now - RECENT_DAYS * DAY;
  const trainedAt = (v) => {
    const at = analysedById.get(v.id)?.lastTrainedAt;
    return at ? new Date(at).getTime() : -Infinity;
  };

  const recent = variants.filter((v) => trainedAt(v) >= cutoff);
  const topUsed = [...variants]
    .sort((a, b) => (b.uses || 0) - (a.uses || 0) || trainedAt(b) - trainedAt(a))
    .slice(0, TOP_BY_USES);

  // Union, rather than strictly whichever set is larger. Picking one outright can drop a lift
  // trained last week purely because it is rare — the same blindness this change exists to
  // fix. A union is never smaller than either candidate, so the "whichever is larger" floor
  // still holds.
  const keep = new Set([...recent, ...topUsed].map((v) => v.id));

  const exercises = variants
    .filter((v) => keep.has(v.id))
    .map((v) => {
      const a = analysedById.get(v.id);
      // `series` is dropped on purpose: the model gets the plateau verdict, not 40 raw RIR
      // points it would be tempted to re-interpret.
      if (a) {
        const { series: _series, ...rest } = a;
        return rest;
      }
      // In the registry, never logged. Every history-derived field is present and null rather
      // than absent, so "no data" is a fact the model reads instead of a gap it fills in.
      return {
        variantId: v.id,
        name: canonicalLabel(v.base),
        mods: v.mods ?? [],
        muscles: musclesOf(v),
        jointActions: v.joint_actions ?? [],
        sets: 0,
        matchedSessions: null,
        plateau: null,
        matchedLoad: null,
        lastSet: null,
        lastTrainedAt: null,
      };
    })
    .sort((a, b) => b.sets - a.sets);

  return {
    generatedAt: new Date(now).toISOString(),
    unit,
    dietPhase: profile?.diet_phase ?? null,
    totals: {
      sessions: sessions.length,
      sets: sets.length,
      variants: variants.length,
      variantsWithHistory: analysed.length,
      sessionsThisWeek,
    },
    exercises,
    // Stated explicitly so the model never presents a trimmed list as the whole registry —
    // the exact mistake this change fixes, reintroduced one level up.
    exercisesOmitted: variants.length - exercises.length,
    program: {
      detected: program.detected,
      confidence: program.confidence ?? null,
      stalledNames: (program.stalled ?? []).map((s) => s.name),
      readinessTrend: program.readinessTrend ?? null,
    },
    muscles: {
      windowStart: muscles.windowStart,
      windowEnd: muscles.windowEnd,
      rows: muscles.rows,
      shared: muscles.shared,
      sharedLow: muscles.sharedLow,
    },
    readiness: {
      latest: readiness.at(-1)?.score ?? null,
      trend: readinessTrend(readiness),
      entries: readiness.length,
    },
    goals: activeGoals,
    notes,
  };
}
