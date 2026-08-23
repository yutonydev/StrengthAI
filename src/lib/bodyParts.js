/**
 * Body-part ordering and display labels for the weekly-goals UI.
 *
 * Derived from the resolver's vocabulary rather than listed again here, so a variant can
 * never come back tagged with a body part the goals UI has no row for. Migration 004 added
 * shoulders and core — delts used to be filed under arms, and core had nowhere to go.
 *
 * These lived in Home.jsx and were imported by Settings.jsx, which meant one screen reached
 * into another for constants and Home exported non-components (the one thing that breaks
 * React Fast Refresh for a file). Neither page owns this list; the vocabulary does.
 */
import { BODY_PARTS } from './resolver.js';

export const PART_ORDER = BODY_PARTS;

export const PART_LABELS = Object.fromEntries(
  PART_ORDER.map((p) => [p, p.charAt(0).toUpperCase() + p.slice(1)])
);
