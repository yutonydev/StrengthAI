/** Weight conversion. Everything is stored in kilograms; the unit is a display choice. */
export const KG_TO_LB = 2.20462262;

export const kgToLb = (kg) => Math.round(kg * KG_TO_LB * 10) / 10;
export const lbToKg = (lb) => Math.round((lb / KG_TO_LB) * 100) / 100;

/** kg in the database -> number to show, in the user's unit. */
export const display = (kg, unit) =>
  unit === 'lb' ? kgToLb(kg || 0) : Math.round((kg || 0) * 10) / 10;

/** What the user typed, in their unit -> kg for storage. */
export const toKg = (value, unit) => {
  const n = parseFloat(value) || 0;
  return unit === 'lb' ? lbToKg(n) : n;
};

/** Plate-friendly increment for the +/- buttons. */
export const step = (unit) => (unit === 'lb' ? 5 : 2.5);

export const rirToRpe = (rir) => (rir == null ? null : Math.round((10 - rir) * 2) / 2);

/**
 * Readiness score, 0–10. Sleep saturates at 7 hours — more than that doesn't keep
 * raising the score, it just stops being a problem.
 */
export function readinessScore({ sleep_hours = 0, energy = 0, soreness = 0, stress = 0 }) {
  const sleep = Math.min(sleep_hours / 7, 1) * 10;
  return Math.round(((sleep + energy + (10 - soreness) + (10 - stress)) / 4) * 10) / 10;
}
