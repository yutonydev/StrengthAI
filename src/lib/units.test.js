import { describe, it, expect } from 'vitest';
import {
  KG_TO_LB, kgToLb, lbToKg, display, toKg, step,
  volumeK, formatVolume, rirToRpe, readinessScore,
} from './units.js';

describe('round trip', () => {
  it('survives what the lifter typed in pounds', () => {
    for (const lb of [45, 95, 100, 135, 137.5, 185, 225, 315]) {
      expect(display(toKg(lb, 'lb'), 'lb')).toBe(lb);
    }
  });

  it('survives kilograms untouched', () => {
    for (const kg of [20, 42.5, 60, 100, 152.5]) {
      expect(display(toKg(kg, 'kg'), 'kg')).toBe(kg);
    }
  });

  it('stores pounds at two decimals, which is what makes the trip reversible', () => {
    expect(lbToKg(135)).toBe(61.23);
    expect(kgToLb(61.23)).toBe(135);
  });
});

describe('display', () => {
  it('shows kilograms to one decimal without converting', () => {
    expect(display(61.234, 'kg')).toBe(61.2);
  });

  it('converts to pounds for lb', () => {
    expect(display(100, 'lb')).toBe(220.5);
  });

  it('treats a missing weight as zero rather than NaN', () => {
    expect(display(null, 'lb')).toBe(0);
    expect(display(undefined, 'kg')).toBe(0);
  });

  it('defaults to kilograms for any unit that is not lb', () => {
    expect(display(50, undefined)).toBe(50);
  });
});

describe('toKg', () => {
  it('reads a typed string', () => {
    expect(toKg('135', 'lb')).toBe(61.23);
    expect(toKg('62.5', 'kg')).toBe(62.5);
  });

  it('never yields NaN from junk, which would poison stored weight', () => {
    expect(toKg('', 'lb')).toBe(0);
    expect(toKg('abc', 'kg')).toBe(0);
    expect(toKg(null, 'lb')).toBe(0);
  });
});

describe('step', () => {
  it('is plate-friendly in each unit', () => {
    expect(step('lb')).toBe(5);
    expect(step('kg')).toBe(2.5);
  });
});

describe('volume formatting', () => {
  it('carries the unit, which three hand-rolled copies used to drop', () => {
    expect(formatVolume(2500, 'kg')).toBe('2.5k kg');
    expect(formatVolume(2500, 'lb')).toBe('5.5k lb');
  });

  it('converts before dividing, so lb volume is not kg volume relabelled', () => {
    expect(volumeK(2500, 'kg')).toBe(2.5);
    expect(volumeK(2500, 'lb')).toBe(5.5);
    expect(volumeK(2500, 'lb')).toBeCloseTo(volumeK(2500, 'kg') * KG_TO_LB, 1);
  });

  it('handles an empty log without printing NaN', () => {
    expect(formatVolume(0, 'lb')).toBe('0k lb');
    expect(formatVolume(null, 'kg')).toBe('0k kg');
  });
});

describe('rirToRpe', () => {
  it('maps reps in reserve onto the RPE scale', () => {
    expect(rirToRpe(0)).toBe(10);
    expect(rirToRpe(1)).toBe(9);
    expect(rirToRpe(2)).toBe(8);
  });

  it('keeps half points, which the RIR chips offer', () => {
    expect(rirToRpe(1.5)).toBe(8.5);
    expect(rirToRpe(2.5)).toBe(7.5);
  });

  it('stays null when effort was not rated, rather than reading as maximal', () => {
    expect(rirToRpe(null)).toBeNull();
    expect(rirToRpe(undefined)).toBeNull();
  });
});

describe('readinessScore', () => {
  it('matches the sheet defaults', () => {
    expect(readinessScore({ sleep_hours: 7, energy: 6, soreness: 3, stress: 3 })).toBe(7.5);
  });

  it('matches a good day', () => {
    expect(readinessScore({ sleep_hours: 8, energy: 8, soreness: 2, stress: 3 })).toBe(8.3);
  });

  it('saturates sleep at seven hours instead of rewarding ten', () => {
    const seven = readinessScore({ sleep_hours: 7, energy: 5, soreness: 5, stress: 5 });
    expect(readinessScore({ sleep_hours: 10, energy: 5, soreness: 5, stress: 5 })).toBe(seven);
  });

  it('counts soreness and stress as costs, not as credit', () => {
    const calm = readinessScore({ sleep_hours: 7, energy: 7, soreness: 0, stress: 0 });
    const wrecked = readinessScore({ sleep_hours: 7, energy: 7, soreness: 10, stress: 10 });
    expect(calm).toBeGreaterThan(wrecked);
  });

  it('treats an untouched sheet as the floor, not as a crash', () => {
    expect(readinessScore({})).toBe(5);
  });
});
