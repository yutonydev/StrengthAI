import { describe, it, expect } from 'vitest';
import {
  normalizePhrase, canonicalLabel, isPlausibleExercise, suggest, findLocal,
  muscleSetCounts, ROLE_WEIGHT,
} from './resolver.js';

// A registry shaped the way the AI resolver stores things.
const VARIANTS = [
  {
    id: 'v1', base: 'bench press', mods: ['feet up', 'narrow grip'], uses: 8,
    source_text: 'feet up narrow grip bench press', muscle: 'pectorals',
    muscles: [
      { name: 'pectorals', role: 'primary' },
      { name: 'triceps', role: 'secondary' },
      { name: 'front delts', role: 'secondary' },
    ],
  },
  {
    id: 'v2', base: 'bench press', mods: [], uses: 3, source_text: 'bench press',
    muscle: 'pectorals',
    muscles: [{ name: 'pectorals', role: 'primary' }, { name: 'triceps', role: 'secondary' }],
  },
  {
    id: 'v3', base: 'tricep extension', mods: ['cable', 'cuff', 'single arm'], uses: 6,
    source_text: 'single arm cuff tricep extension', muscle: 'triceps',
    muscles: [{ name: 'triceps', role: 'primary' }],
  },
];

describe('normalizePhrase', () => {
  it('collapses casing, punctuation and whitespace to one cache key', () => {
    expect(normalizePhrase('  Feet-Up,   NARROW grip Bench Press! ')).toBe('feet-up narrow grip bench press');
  });
  it('is stable for the same phrase typed twice', () => {
    expect(normalizePhrase('Zercher Squat')).toBe(normalizePhrase('zercher   squat'));
  });
});

describe('isPlausibleExercise', () => {
  it('lets anything plausible through — the model is the real judge', () => {
    for (const p of ['zercher barbell squat', 'jm press', 'sldl', 'zottman curl', 'seal row']) {
      expect(isPlausibleExercise(p).ok).toBe(true);
    }
  });

  it('rejects keyboard mashing before it costs money', () => {
    expect(isPlausibleExercise('asdfgh').ok).toBe(false);
    expect(isPlausibleExercise('xzcvbnm').ok).toBe(false);
    expect(isPlausibleExercise('aaaaaaa').ok).toBe(false);
  });

  it('rejects empty and absurdly long input', () => {
    expect(isPlausibleExercise('').ok).toBe(false);
    expect(isPlausibleExercise('a'.repeat(200)).ok).toBe(false);
  });

  it('does NOT try to judge whether a real phrase is an exercise', () => {
    // "chicken parmesan" is perfectly well-formed text. Rejecting it is the model's job —
    // a local wordlist would also reject legitimate obscure movements.
    expect(isPlausibleExercise('chicken parmesan').ok).toBe(true);
  });
});

describe('findLocal', () => {
  it('matches a phrase this lifter has typed before, ignoring punctuation and case', () => {
    expect(findLocal('Feet-up, narrow grip bench press!', VARIANTS)?.id).toBe('v1');
  });

  it('keeps a plain bench separate from the feet-up variant', () => {
    // The guarantee the whole rebuild exists to protect: never silently merge two lifts.
    expect(findLocal('bench press', VARIANTS)?.id).toBe('v2');
  });

  it('returns null for anything not logged before, rather than guessing', () => {
    expect(findLocal('zercher barbell squat', VARIANTS)).toBeNull();
    expect(findLocal('bench', VARIANTS)).toBeNull();
  });
});

describe('suggest', () => {
  it('orders by how often the lifter uses them', () => {
    expect(suggest('', VARIANTS)[0].id).toBe('v1');
  });
  it('matches on partial words across name, mods and original phrasing', () => {
    expect(suggest('tricep', VARIANTS).map((v) => v.id)).toEqual(['v3']);
    expect(suggest('cuff', VARIANTS).map((v) => v.id)).toEqual(['v3']);
  });
  it('puts an exact phrase match first', () => {
    expect(suggest('bench press', VARIANTS)[0].id).toBe('v2');
  });
});

describe('canonicalLabel', () => {
  it('title-cases the movement for display', () => {
    expect(canonicalLabel('romanian deadlift')).toBe('Romanian Deadlift');
  });
});

describe('muscleSetCounts', () => {
  const byId = Object.fromEntries(VARIANTS.map((v) => [v.id, v]));

  it('counts a primary muscle as a full set and a secondary as half', () => {
    const counts = muscleSetCounts([{ variant_id: 'v2' }], byId);
    expect(counts.pectorals).toBe(ROLE_WEIGHT.primary);
    expect(counts.triceps).toBe(ROLE_WEIGHT.secondary);
  });

  it('accumulates triceps across different movements — the point of the whole thing', () => {
    // Three bench sets and two pushdown sets is not "bench volume" and "tricep volume";
    // it is 3.5 sets of triceps. Per-exercise analysis can never see that.
    const counts = muscleSetCounts(
      [{ variant_id: 'v2' }, { variant_id: 'v2' }, { variant_id: 'v3' }, { variant_id: 'v3' }],
      byId
    );
    expect(counts.triceps).toBe(0.5 + 0.5 + 1 + 1);
  });

  it('ignores sets whose variant is missing rather than throwing', () => {
    expect(muscleSetCounts([{ variant_id: 'gone' }], byId)).toEqual({});
  });

  it('returns nothing for variants with no muscle data yet', () => {
    const counts = muscleSetCounts([{ variant_id: 'v4' }], { v4: { id: 'v4', muscles: [] } });
    expect(counts).toEqual({});
  });
});
