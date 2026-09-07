// Coaching analysis. Pure functions over logged sets — no network, no model calls.
// Deliberately conservative: it only claims something when the data supports it.
import { canonicalLabel, muscleSetCounts } from './resolver.js';
import { display } from './units.js';

/** Epley estimated 1RM. Fine up to ~10 reps, drifts optimistic beyond that. */
export const e1rm = (weightKg, reps) => (weightKg || 0) * (1 + (reps || 0) / 30);

/** How many recent sets count as "now" for a goal. Roughly the last two or three sessions. */
const CURRENT_WINDOW = 9;

// Where a lift stands today: best e1RM across the last few sets, not the latest set —
// the newest set is often a back-off and would report a PR day as going backwards.
// Shared because four screens derived it by hand and it drives a database write.
export function currentE1rm(sets = []) {
  const recent = [...sets]
    .sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
    .slice(-CURRENT_WINDOW);
  return recent.length ? Math.max(...recent.map((s) => e1rm(s.weight_kg, s.reps))) : 0;
}

// Back-off fraction for a plateaued lift. Shared: PlateauCard renders it and Coach.jsx
// writes it into coach_plans, so drift would promise one weight and program another.
export const BACKOFF_FACTOR = 0.88;

// RIR at matched load, one point per session. Holding weight × reps constant is what
// makes effort comparable — raw RIR across different loads says nothing. `modal` is the
// weight × reps measured at, NOT the latest set; the back-off recommendation is a
// percentage of it, so the wrong load becomes wrong programming advice.
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

// Is this lift stalled? Needs 3+ matched sessions and a full RIR point lost; half a
// point is inside the noise of self-reported RIR.
export function detectPlateau(series = []) {
  // Every key of the full verdict, valued null. buildCoachFacts ships this straight to the
  // chat coach; a missing key is a gap it guesses at, a stated null is a fact it reads.
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

// Program-level check. Four lifts stalling in a fortnight across different movement
// patterns is almost never four problems — it is recovery. Base44 missed this.
export function detectProgramPattern(perVariant = [], readiness = []) {
  const stalled = perVariant
    .map((v) => ({ ...v, verdict: detectPlateau(v.series) }))
    .filter((v) => v.verdict.stalled);

  if (stalled.length < 2) return { detected: false, stalled };

  // Readiness moving the same way turns a coincidence into a diagnosis. Whole series, not
  // the recent window: a claim about the block has to span the block.
  const trend = readinessTrend(readiness, readiness.length);

  return {
    detected: true,
    stalled,
    readinessTrend: trend,
    confidence: stalled.length >= 3 && trend != null && trend < -0.5 ? 'high' : 'moderate',
  };
}

// Goal projection. Straight-line extrapolation is false — gains decelerate near a
// ceiling — so this returns the linear number AND a decay-adjusted range, and refuses to
// project when the rate is not positive. The 1.4×–2.1× multipliers are a blunt
// instrument; a per-lifter model needs more data than a new user has.
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

// The muscles a variant trains, tolerating pre-004 rows that carry a single `muscle`
// string. Treating those as untagged would drop the longest-trained lifts from every total.
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

// Per-muscle volume, last 7 days against the 4 weeks before. Rolling, not calendar:
// fatigue does not reset on Sunday. This is why muscles are tagged at resolve time —
// bench, dips and pushdowns all bill the triceps, and no per-exercise view sees that.
// `now` is injectable so the window is testable.
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

  // Muscles trained by a lift whose effort is climbing. Primary only — a secondary
  // contribution is too small to explain a stall.
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

  // Ranked by how many stalling lifts share the muscle, not by set count: three lifts
  // converging is the finding, one stalled lift on a high-volume muscle is not.
  const candidates = rows
    .filter((r) => r.climbingLifts.length >= 2)
    .sort((a, b) => b.climbingLifts.length - a.climbingLifts.length || b.sets - a.sets);

  // Only a concentration when volume is actually elevated. Shared stalls on a muscle doing
  // less work is the opposite finding, and cutting volume that is already down is wrong.
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

// Which variants reach the model. A registry that only grows makes every question more
// expensive, but trimming is the more dangerous direction: an exercise the model cannot
// see is one it will confidently say the lifter does not have. Generous, and it counts
// whatever it drops.
const RECENT_DAYS = 90;
const TOP_BY_USES = 30;

// Everything the chat coach is allowed to know. The model never touches the database, so
// every figure it quotes came from a tested function above and the lifter can check it on
// their own screens. Weights carry both kg and display unit — asking a model to convert is
// asking it to do arithmetic it is bad at.
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

  // Built once; a `variants.find()` per goal was a linear scan of the whole registry.
  const variantsById = new Map(variants.map((v) => [v.id, v]));

  const setsByVariant = new Map();
  for (const s of sets) {
    if (!setsByVariant.has(s.variant_id)) setsByVariant.set(s.variant_id, []);
    setsByVariant.get(s.variant_id).push(s);
  }

  const chrono = (rows) => [...rows].sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at));

  // Runs over the whole history, not the trimmed list below: the cap is about what is worth
  // sending, and detectProgramPattern needs every stalling lift to see a program.
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
        // The load the verdict refers to — often a different weight than lastSet.
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
        // Same row as lastSet; chrono() sorts a copy, so calling it twice sorted twice.
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

  // Verbatim: a note is the only place the lifter says what the numbers cannot. Truncated,
  // never summarised — a paraphrase is the model inventing context and reasoning from it.
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

  // Union, not whichever set is larger: picking one can drop a lift trained last week just
  // for being rare — the same blindness this exists to fix.
  const keep = new Set([...recent, ...topUsed].map((v) => v.id));

  const exercises = variants
    .filter((v) => keep.has(v.id))
    .map((v) => {
      const a = analysedById.get(v.id);
      // `series` dropped: the model gets the verdict, not 40 raw points to re-interpret.
      if (a) {
        const { series: _series, ...rest } = a;
        return rest;
      }
      // In the registry, never logged. Fields present and null, so "no data" is a fact.
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
    // Stated, so the model never presents a trimmed list as the whole registry.
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
