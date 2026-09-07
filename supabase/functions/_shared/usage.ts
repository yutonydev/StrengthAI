// Usage-cap arithmetic, shared by both functions and tested. The previous cap read a
// column that did not exist, so count was undefined, `undefined >= 400` was false, and
// every call was permitted for months. checkCap therefore fails CLOSED.

export type UsageRow = { calls?: number | null };

export type CapCheck = {
  /** Safe to make the model call. */
  allow: boolean;
  /** Refused because the budget is spent — a normal, explainable state. */
  capped: boolean;
  /** Refused because the counter could not be read — a fault, not a budget. */
  failed: boolean;
};

// Parsed rather than Number(): a typo'd secret becomes NaN, and `sum >= NaN` is false
// for every sum, silently disabling the cap.
export function capFromEnv(raw: string | undefined | null, fallback: number, name: string): number {
  if (raw == null || raw.trim() === '') return fallback;

  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    // Loud, because the symptom otherwise is an unbounded bill nobody notices.
    console.warn(
      `[usage] ${name}=${JSON.stringify(raw)} is not a valid cap. Falling back to ${fallback}.`
    );
    return fallback;
  }
  return n;
}

/** UTC day key, matching the `day` column on both counter tables. */
export function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** First day of the UTC month containing `d`, as a day key. */
export function monthStartKey(d: Date = new Date()): string {
  return `${d.toISOString().slice(0, 7)}-01`;
}

// Total calls across daily counter rows. A monthly cap is a sum over at most 31 rows, not a
// row count — counting rows would cap a heavy user at 31 and let a light one run forever.
export function sumCalls(rows: UsageRow[] | null | undefined): number {
  return (rows ?? []).reduce((total, r) => total + (Number(r?.calls) || 0), 0);
}

// May this user make a billable call? `error` is whatever the usage read returned; passing
// it in keeps the decision and the failure mode together, so an unreadable counter can
// never be mistaken for an empty one.
export function checkCap(
  rows: UsageRow[] | null | undefined,
  error: unknown,
  cap: number
): CapCheck {
  if (error) return { allow: false, capped: false, failed: true };
  // Defence in depth behind `capFromEnv`. A non-finite cap means we do not know the limit,
  // and "unknown limit" must never resolve to "no limit" — that is exactly the bug this
  // module exists to prevent. Callers should use capFromEnv so this never fires.
  if (!Number.isFinite(cap)) {
    console.error(`[usage] refusing to bill against a non-numeric cap (${cap}).`);
    return { allow: false, capped: false, failed: true };
  }
  if (sumCalls(rows) >= cap) return { allow: false, capped: true, failed: false };
  return { allow: true, capped: false, failed: false };
}
