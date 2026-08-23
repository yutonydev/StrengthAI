import { describe, it, expect } from 'vitest';
import {
  matchedRirSeries, detectPlateau, detectProgramPattern,
  projectGoal, e1rm, muscleVolume, readinessTrend, buildCoachFacts,
  currentE1rm, BACKOFF_FACTOR,
} from './coach.js';

const set = (session_id, weight_kg, reps, rir) => ({ session_id, weight_kg, reps, rir });

describe('matchedRirSeries', () => {
  const dates = { s1: '2026-01-01', s2: '2026-01-08', s3: '2026-01-15' };

  it('tracks effort at the most-repeated load', () => {
    const { series } = matchedRirSeries(
      [set('s1', 84, 8, 3), set('s2', 84, 8, 2), set('s3', 84, 8, 1)],
      dates
    );
    expect(series.map((p) => p.rir)).toEqual([3, 2, 1]);
  });

  it('ignores sets at other loads — mixing them would be meaningless', () => {
    const { series } = matchedRirSeries(
      [set('s1', 84, 8, 3), set('s1', 60, 12, 1), set('s2', 84, 8, 2)],
      dates
    );
    expect(series).toHaveLength(2);
  });

  it('averages multiple matching sets within one session', () => {
    const { series } = matchedRirSeries(
      [set('s1', 84, 8, 3), set('s1', 84, 8, 2), set('s2', 84, 8, 2), set('s2', 84, 8, 2)],
      dates
    );
    expect(series[0].rir).toBe(2.5);
  });

  it('says nothing when the load never repeats', () => {
    expect(matchedRirSeries([set('s1', 84, 8, 3), set('s2', 86, 8, 3)], dates))
      .toEqual({ series: [], modal: null });
  });

  it('drops sessions the lifter excluded', () => {
    const { series } = matchedRirSeries(
      [set('s1', 84, 8, 3), set('s2', 84, 8, 1), set('s3', 84, 8, 2)],
      dates,
      new Set(['s2'])
    );
    expect(series.map((p) => p.sessionId)).toEqual(['s1', 's3']);
  });

  it('reports the load the series was measured at', () => {
    const { modal } = matchedRirSeries(
      [set('s1', 84, 8, 3), set('s2', 84, 8, 2), set('s3', 84, 8, 1)],
      dates
    );
    expect(modal).toEqual({ weightKg: 84, reps: 8 });
  });

  it('reports the SERIES load even when the newest set is at a different weight', () => {
    // The bug this exists to catch: a deload, back-off set or rep-scheme change makes the
    // most recent set unrepresentative. The plateau is at 102.06; the last set is at 65.77.
    const { series, modal } = matchedRirSeries(
      [
        set('s1', 102.06, 5, 3),
        set('s2', 102.06, 5, 2),
        set('s3', 102.06, 5, 1),
        set('s3', 65.77, 6, 1.5), // newest, lighter, not part of the matched series
      ],
      dates
    );
    expect(modal).toEqual({ weightKg: 102.06, reps: 5 });
    expect(modal.weightKg).not.toBe(65.77);
    expect(series).toHaveLength(3);
  });
});

describe('detectPlateau', () => {
  const series = (...rirs) => rirs.map((rir, i) => ({ sessionId: `s${i}`, rir, date: `2026-01-0${i + 1}` }));

  it('needs three sessions before saying anything', () => {
    expect(detectPlateau(series(3, 1)).stalled).toBe(false);
  });

  it('calls a full point of lost RIR a plateau', () => {
    expect(detectPlateau(series(3, 2, 1.5, 1)).stalled).toBe(true);
  });

  it('does not call half a point a plateau — that is noise', () => {
    const r = detectPlateau(series(3, 2.8, 2.5));
    expect(r.stalled).toBe(false);
    expect(r.watch).toBe(true);
  });

  it('separates volatile from declining', () => {
    expect(detectPlateau(series(3, 1, 3, 1, 3)).stability).toBe('volatile');
    expect(detectPlateau(series(3, 3, 3, 3)).stability).toBe('stable');
  });
});

describe('detectProgramPattern', () => {
  const stalledSeries = [{ rir: 3 }, { rir: 2 }, { rir: 1 }].map((p, i) => ({ ...p, sessionId: `s${i}` }));
  const flatSeries = [{ rir: 3 }, { rir: 3 }, { rir: 3 }].map((p, i) => ({ ...p, sessionId: `s${i}` }));

  it('one stalled lift is an exercise problem, not a program problem', () => {
    const r = detectProgramPattern([
      { variantId: 'a', series: stalledSeries },
      { variantId: 'b', series: flatSeries },
    ]);
    expect(r.detected).toBe(false);
  });

  it('several at once is a program problem', () => {
    const r = detectProgramPattern([
      { variantId: 'a', series: stalledSeries },
      { variantId: 'b', series: stalledSeries },
      { variantId: 'c', series: stalledSeries },
    ]);
    expect(r.detected).toBe(true);
    expect(r.stalled).toHaveLength(3);
  });

  it('falling readiness raises confidence', () => {
    const readiness = [{ score: 8 }, { score: 8 }, { score: 6 }, { score: 6 }];
    const r = detectProgramPattern(
      [{ variantId: 'a', series: stalledSeries }, { variantId: 'b', series: stalledSeries }, { variantId: 'c', series: stalledSeries }],
      readiness
    );
    expect(r.confidence).toBe('high');
    expect(r.readinessTrend).toBeLessThan(0);
  });
});

describe('projectGoal', () => {
  const history = [
    { weight_kg: 80, reps: 5 }, { weight_kg: 82, reps: 5 },
    { weight_kg: 85, reps: 5 }, { weight_kg: 88, reps: 5 },
  ];

  it('gives a decay range that is always longer than the linear guess', () => {
    const r = projectGoal({ currentKg: e1rm(88, 5), targetKg: 120, history });
    expect(r.projectable).toBe(true);
    expect(r.decayWeeks[0]).toBeGreaterThan(r.linearWeeks);
    expect(r.decayWeeks[1]).toBeGreaterThan(r.decayWeeks[0]);
  });

  it('refuses to project when progress has stopped', () => {
    const flat = [{ weight_kg: 100, reps: 5 }, { weight_kg: 100, reps: 5 }, { weight_kg: 100, reps: 5 }];
    const r = projectGoal({ currentKg: e1rm(100, 5), targetKg: 130, history: flat });
    expect(r.projectable).toBe(false);
    expect(r.reason).toMatch(/fiction/);
  });

  it('reports an already-passed target as achieved rather than stalled', () => {
    const r = projectGoal({ currentKg: 130, targetKg: 100, history });
    expect(r.achieved).toBe(true);
    expect(r.projectable).toBe(false);
  });
});

/* ------------------------------------------------------------ muscle volume */

// `now` is fixed so the 7-day window and the 4-week baseline are deterministic.
const NOW = new Date('2026-03-01T12:00:00Z').getTime();
const daysAgo = (n) => new Date(NOW - n * 864e5).toISOString();

const variant = (id, base, muscles, extra = {}) => ({ id, base, mods: [], muscles, ...extra });
const session = (id, days) => ({ id, started_at: daysAgo(days), status: 'completed' });
const vset = (session_id, variant_id, extra = {}) => ({
  session_id, variant_id, weight_kg: 80, reps: 8, rir: 2,
  logged_at: extra.logged_at ?? daysAgo(0), ...extra,
});

describe('muscleVolume', () => {
  const bench = variant('v1', 'bench press', [
    { name: 'pectorals', role: 'primary' },
    { name: 'triceps', role: 'secondary' },
  ]);
  const pushdown = variant('v2', 'pushdown', [{ name: 'triceps', role: 'primary' }]);

  it('bills a set fully to primaries and half to secondaries', () => {
    const r = muscleVolume({
      variants: [bench],
      sessions: [session('s1', 2)],
      sets: [vset('s1', 'v1'), vset('s1', 'v1')],
      now: NOW,
    });
    const by = Object.fromEntries(r.rows.map((x) => [x.name, x.sets]));
    expect(by.pectorals).toBe(2);
    expect(by.triceps).toBe(1);
  });

  it('counts a muscle across every movement that trains it', () => {
    // The reason muscle tagging exists: neither exercise looks overworked alone.
    const r = muscleVolume({
      variants: [bench, pushdown],
      sessions: [session('s1', 2)],
      sets: [vset('s1', 'v1'), vset('s1', 'v1'), vset('s1', 'v2'), vset('s1', 'v2')],
      now: NOW,
    });
    const triceps = r.rows.find((x) => x.name === 'triceps');
    expect(triceps.sets).toBe(3); // 2 secondary halves + 2 full primaries
  });

  it('divides the four-week window down to a per-week baseline', () => {
    const r = muscleVolume({
      variants: [pushdown],
      sessions: [session('old', 20), session('now', 2)],
      // 8 sets spread over the baseline window -> a 2-set weekly average
      sets: [
        ...Array.from({ length: 8 }, () => vset('old', 'v2')),
        vset('now', 'v2'),
      ],
      now: NOW,
    });
    const triceps = r.rows.find((x) => x.name === 'triceps');
    expect(triceps.baseline).toBe(2);
    expect(triceps.sets).toBe(1);
  });

  it('marks a muscle overreaching only when a stalled lift AND raised volume coincide', () => {
    const base = {
      variants: [pushdown],
      sessions: [session('old', 20), session('now', 2)],
      sets: [...Array.from({ length: 4 }, () => vset('old', 'v2')), ...Array.from({ length: 4 }, () => vset('now', 'v2'))],
      now: NOW,
    };
    // baseline 1/week, current 4 -> ratio 4
    expect(muscleVolume({ ...base, stalledVariantIds: ['v2'] }).rows[0].tag).toBe('overreaching');
    // same volume, nothing stalling -> ramping, not overreaching
    expect(muscleVolume(base).rows[0].tag).toBe('ramping');
  });

  it('refuses to call it a concentration when the shared muscle is doing less work', () => {
    // Two lifts stalling on one muscle, but volume is DOWN. Telling someone to cut volume
    // that has already fallen would be actively wrong — this is a recovery finding.
    const dip = variant('v3', 'dip', [{ name: 'triceps', role: 'primary' }]);
    const r = muscleVolume({
      variants: [pushdown, dip],
      sessions: [session('old', 20), session('now', 2)],
      sets: [...Array.from({ length: 16 }, () => vset('old', 'v2')), vset('now', 'v2')],
      stalledVariantIds: ['v2', 'v3'],
      now: NOW,
    });
    expect(r.shared).toBeNull();
    expect(r.sharedLow.name).toBe('triceps');
    expect(r.sharedLow.climbingLifts).toHaveLength(2);
  });

  it('names a concentration when two stalled lifts share an elevated muscle', () => {
    const dip = variant('v3', 'dip', [{ name: 'triceps', role: 'primary' }]);
    const r = muscleVolume({
      variants: [pushdown, dip],
      sessions: [session('old', 20), session('now', 2)],
      sets: [
        ...Array.from({ length: 4 }, () => vset('old', 'v2')),
        ...Array.from({ length: 6 }, () => vset('now', 'v2')),
      ],
      stalledVariantIds: ['v2', 'v3'],
      now: NOW,
    });
    expect(r.shared.name).toBe('triceps');
    expect(r.shared.ratio).toBeGreaterThanOrEqual(1.15);
  });

  it('still counts variants tagged before the muscles array existed', () => {
    // Pre-migration-004 rows carry a single `muscle` string. Dropping them would exclude
    // the lifts someone has trained longest from every total.
    const legacy = { id: 'v9', base: 'squat', mods: [], muscle: 'quads' };
    const r = muscleVolume({
      variants: [legacy],
      sessions: [session('s1', 2)],
      sets: [vset('s1', 'v9')],
      now: NOW,
    });
    expect(r.rows.find((x) => x.name === 'quads').sets).toBe(1);
  });

  it('flags a muscle that fell out of the program entirely', () => {
    const r = muscleVolume({
      variants: [pushdown],
      sessions: [session('old', 20)],
      sets: Array.from({ length: 16 }, () => vset('old', 'v2')),
      now: NOW,
    });
    const triceps = r.rows.find((x) => x.name === 'triceps');
    expect(triceps.sets).toBe(0);
    expect(triceps.tag).toBe('untrained');
  });
});

describe('readinessTrend', () => {
  it('says nothing until there are four entries', () => {
    expect(readinessTrend([{ score: 8 }, { score: 6 }, { score: 5 }])).toBeNull();
  });

  it('reports the direction of the second half against the first', () => {
    expect(readinessTrend([{ score: 8 }, { score: 8 }, { score: 6 }, { score: 6 }])).toBe(-2);
  });
});

/* ------------------------------------------------------------ facts payload */

describe('buildCoachFacts', () => {
  const bench = variant('v1', 'bench press', [{ name: 'pectorals', role: 'primary' }], {
    joint_actions: ['shoulder horizontal adduction', 'elbow extension'],
  });
  const sessions = [session('s1', 21), session('s2', 14), session('s3', 7)];
  // same load, effort climbing — a textbook fatigue plateau
  const sets = [
    vset('s1', 'v1', { rir: 3, logged_at: daysAgo(21) }),
    vset('s2', 'v1', { rir: 2, logged_at: daysAgo(14) }),
    vset('s3', 'v1', { rir: 1, logged_at: daysAgo(7) }),
  ];

  const facts = () =>
    buildCoachFacts({
      variants: [bench],
      sets,
      sessions,
      readiness: [{ score: 8 }, { score: 7 }, { score: 6 }, { score: 5 }],
      goals: [{ variant_id: 'v1', status: 'active', target_kg: 100, target_reps: 5 }],
      profile: { unit: 'kg', diet_phase: 'cutting' },
      now: NOW,
    });

  it('carries the plateau verdict and the last logged set for each exercise', () => {
    const f = facts();
    expect(f.exercises).toHaveLength(1);
    const [ex] = f.exercises;
    expect(ex.name).toBe('Bench Press');
    expect(ex.plateau.stalled).toBe(true);
    expect(ex.plateau.drop).toBe(2);
    expect(ex.lastSet.weightKg).toBe(80);
    expect(ex.lastSet.reps).toBe(8);
    expect(ex.lastSet.rir).toBe(1);
  });

  it('never ships the raw RIR series — the model gets the verdict, not 40 points', () => {
    expect(facts().exercises[0].series).toBeUndefined();
  });

  it('carries the matched-series load, distinct from the newest set', () => {
    // Regression. The plateau card prints this load and the back-off suggestion is 88% of it,
    // so taking the newest set instead reported "6 matched sessions at 145 lb" for a plateau
    // that is at 225 lb, and prescribed dropping to 128 lb rather than ~198 lb.
    const rows = [
      vset('s1', 'v1', { weight_kg: 102.06, reps: 5, rir: 3, logged_at: daysAgo(30) }),
      vset('s2', 'v1', { weight_kg: 102.06, reps: 5, rir: 2, logged_at: daysAgo(20) }),
      vset('s3', 'v1', { weight_kg: 102.06, reps: 5, rir: 1, logged_at: daysAgo(10) }),
      // newest set, lighter and at different reps — a back-off, not part of the series
      vset('s4', 'v1', { weight_kg: 65.77, reps: 6, rir: 1.5, logged_at: daysAgo(1) }),
    ];
    const f = buildCoachFacts({
      variants: [bench],
      sets: rows,
      sessions: [session('s1', 30), session('s2', 20), session('s3', 10), session('s4', 1)],
      profile: { unit: 'lb' },
      now: NOW,
    });
    const ex = f.exercises[0];

    expect(ex.plateau.stalled).toBe(true);
    expect(ex.matchedLoad).toEqual({ weightKg: 102.06, weight: 225, reps: 5 });
    // the newest set is deliberately NOT the plateau load
    expect(ex.lastSet.weightKg).toBe(65.77);
    expect(ex.lastSet.weight).toBe(145);
    // what the card would print, and what the back-off target is computed from
    expect(Math.round(ex.matchedLoad.weight * 0.88)).toBe(198);
    expect(Math.round(ex.lastSet.weight * 0.88)).toBe(128); // the wrong answer, for contrast
  });

  it('carries weight in the display unit as well as kg, so the model never converts', () => {
    const f = buildCoachFacts({
      variants: [bench], sets, sessions, profile: { unit: 'lb' }, now: NOW,
    });
    expect(f.unit).toBe('lb');
    expect(f.exercises[0].lastSet.weightKg).toBe(80);
    expect(f.exercises[0].lastSet.weight).toBeCloseTo(176.4, 1);
  });

  it('includes diet phase and readiness trend', () => {
    const f = facts();
    expect(f.dietPhase).toBe('cutting');
    expect(f.readiness.latest).toBe(5);
    expect(f.readiness.trend).toBeLessThan(0);
  });

  it('projects active goals and keeps projectGoal\'s refusal intact', () => {
    // Load never moved, so there is no positive rate — a projection here would be fiction.
    const [goal] = facts().goals;
    expect(goal.name).toBe('Bench Press');
    expect(goal.targetKg).toBe(100);
    expect(goal.projection.projectable).toBe(false);
  });

  it('passes session notes through verbatim, capped, newest first', () => {
    const long = 'a'.repeat(500);
    const f = buildCoachFacts({
      variants: [bench],
      sets,
      sessions: [
        { ...sessions[0], notes: 'shoulder felt tight' },
        { ...sessions[2], notes: long },
      ],
      now: NOW,
    });
    expect(f.notes[0].note).toHaveLength(400);
    expect(f.notes[0].truncated).toBe(true);
    expect(f.notes[1].note).toBe('shoulder felt tight');
  });

  it('includes a registry variant with no logged sets, with null history fields', () => {
    // The bug this replaces: an unlogged variant was omitted entirely, so the coach told a
    // lifter bench was their only chest exercise while chest press sat in their registry.
    const unused = variant('v2', 'leg press', [{ name: 'quads', role: 'primary' }]);
    const f = buildCoachFacts({ variants: [bench, unused], sets, sessions, now: NOW });

    expect(f.exercises.map((e) => e.name).sort()).toEqual(['Bench Press', 'Leg Press']);

    const legPress = f.exercises.find((e) => e.name === 'Leg Press');
    expect(legPress.sets).toBe(0);
    expect(legPress.plateau).toBeNull();
    expect(legPress.lastSet).toBeNull();
    expect(legPress.matchedSessions).toBeNull();
    expect(legPress.lastTrainedAt).toBeNull();
    // present-and-null, not absent — the model must read "no data", not infer it from a gap
    for (const k of ['plateau', 'lastSet', 'matchedSessions', 'lastTrainedAt']) {
      expect(Object.hasOwn(legPress, k)).toBe(true);
    }
    // the muscles are still there, so it can be reasoned about as a chest/leg option
    expect(legPress.muscles).toEqual([{ name: 'quads', role: 'primary' }]);
  });

  it('still carries real history for logged variants alongside unlogged ones', () => {
    const unused = variant('v2', 'leg press', [{ name: 'quads', role: 'primary' }]);
    const f = buildCoachFacts({ variants: [bench, unused], sets, sessions, now: NOW });
    const b = f.exercises.find((e) => e.name === 'Bench Press');
    expect(b.sets).toBe(3);
    expect(b.plateau.stalled).toBe(true);
    expect(b.lastSet.reps).toBe(8);
    expect(b.lastSet.weightKg).toBe(80);
    expect(b.lastTrainedAt).not.toBeNull();
  });

  it('trims a long-tailed registry but keeps everything trained recently', () => {
    // 60 variants: 2 trained inside the window, 58 abandoned. Only one of the abandoned ones
    // has a high use count, so a naive "top 30 by uses" would still be padded with junk.
    const recentA = { ...variant('recent-a', 'squat', [{ name: 'quads', role: 'primary' }]), uses: 1 };
    const recentB = { ...variant('recent-b', 'row', [{ name: 'lats', role: 'primary' }]), uses: 1 };
    const stale = Array.from({ length: 58 }, (_, i) => ({
      ...variant(`old-${i}`, `machine ${i}`, [{ name: 'quads', role: 'primary' }]),
      uses: 100 - i,
    }));

    const recentSession = session('rs', 3);
    const oldSession = session('os', 400);
    const allSets = [
      vset('rs', 'recent-a', { logged_at: daysAgo(3) }),
      vset('rs', 'recent-b', { logged_at: daysAgo(3) }),
      ...stale.map((v) => vset('os', v.id, { logged_at: daysAgo(400) })),
    ];

    const f = buildCoachFacts({
      variants: [recentA, recentB, ...stale],
      sets: allSets,
      sessions: [recentSession, oldSession],
      now: NOW,
    });

    expect(f.totals.variants).toBe(60);
    expect(f.exercises.length).toBeLessThan(60);
    expect(f.exercisesOmitted).toBe(60 - f.exercises.length);
    expect(f.exercisesOmitted).toBeGreaterThan(0);

    // both recently-trained lifts survive despite uses:1 — a strict top-30-by-uses would
    // have dropped them for machines abandoned over a year ago
    const names = f.exercises.map((e) => e.variantId);
    expect(names).toContain('recent-a');
    expect(names).toContain('recent-b');

    // the floor still holds: at least the top 30 by use count
    expect(f.exercises.length).toBeGreaterThanOrEqual(30);
  });

  it('keeps a small registry whole and omits nothing', () => {
    const unused = variant('v2', 'leg press', [{ name: 'quads', role: 'primary' }]);
    const f = buildCoachFacts({ variants: [bench, unused], sets, sessions, now: NOW });
    expect(f.exercisesOmitted).toBe(0);
    expect(f.totals.variants).toBe(2);
    expect(f.totals.variantsWithHistory).toBe(1);
  });

  it('stays coherent with nothing logged at all', () => {
    const f = buildCoachFacts({ now: NOW });
    expect(f.exercises).toEqual([]);
    expect(f.goals).toEqual([]);
    expect(f.notes).toEqual([]);
    expect(f.readiness.trend).toBeNull();
    expect(f.program.detected).toBe(false);
    expect(f.muscles.rows).toEqual([]);
  });
});


describe('currentE1rm', () => {
  const at = (weight_kg, reps, day) => ({
    weight_kg,
    reps,
    logged_at: new Date(2026, 0, day).toISOString(),
  });

  it('is 0 with no history rather than -Infinity', () => {
    // Math.max() of an empty list is -Infinity, which would render as a progress bar of
    // negative width and a projection from a load below zero.
    expect(currentE1rm([])).toBe(0);
    expect(currentE1rm()).toBe(0);
  });

  it('takes the best of the window, not the latest set', () => {
    // A back-off set is the newest row and the weakest. Reading "now" as the last set would
    // report someone as having gone backwards on the day they hit a PR.
    const sets = [at(100, 5, 1), at(120, 5, 2), at(60, 12, 3)];
    expect(currentE1rm(sets)).toBeCloseTo(e1rm(120, 5), 6);
  });

  it('sorts before windowing, so input order cannot change the answer', () => {
    const chrono = [at(100, 5, 1), at(110, 5, 2), at(105, 5, 3)];
    const shuffled = [chrono[2], chrono[0], chrono[1]];
    expect(currentE1rm(shuffled)).toBe(currentE1rm(chrono));
  });

  it('ignores sets older than the window', () => {
    // An all-time PR from twenty sessions ago is not where the lifter is now — that is the
    // whole reason this looks at a window rather than the whole history.
    const old = at(300, 5, 1);
    const recent = Array.from({ length: 9 }, (_, i) => at(100, 5, i + 2));
    expect(currentE1rm([old, ...recent])).toBeCloseTo(e1rm(100, 5), 6);
  });

  it('does not mutate the array it is given', () => {
    const sets = [at(110, 5, 3), at(100, 5, 1)];
    const before = sets.map((s) => s.logged_at);
    currentE1rm(sets);
    expect(sets.map((s) => s.logged_at)).toEqual(before);
  });
});

describe('detectPlateau shape', () => {
  const series = (n) => Array.from({ length: n }, (_, i) => ({ sessionId: `s${i}`, rir: 3 }));

  it('carries the same keys whether or not there is enough data', () => {
    // buildCoachFacts ships this object to the chat coach. A verdict that sometimes omits
    // `stability` and `drop` leaves the model guessing whether absence means "stable" or
    // "unknown"; a stated null is a fact it can read.
    const thin = detectPlateau(series(2));
    const full = detectPlateau(series(4));
    expect(Object.keys(full).every((k) => k in thin)).toBe(true);
    expect(thin.stability).toBeNull();
    expect(thin.drop).toBeNull();
    expect(thin.watch).toBe(false);
    expect(thin.sessions).toBe(2);
  });
});

describe('BACKOFF_FACTOR', () => {
  it('is the fraction the plateau card quotes and the plan writes', () => {
    // Shared so the card cannot promise one weight while coach_plans stores another.
    expect(BACKOFF_FACTOR).toBe(0.88);
  });
});
