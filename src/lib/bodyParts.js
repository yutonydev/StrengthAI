// Body-part ordering and display labels for the weekly-goals UI. Derived from the resolver's
// vocabulary rather than listed again, so a variant can never come back tagged with a body
// part the goals UI has no row for. Neither Home nor Settings owns this list; the
// vocabulary does — and exporting non-components from a page breaks Fast Refresh.
import { BODY_PARTS } from './resolver.js';

export const PART_ORDER = BODY_PARTS;

export const PART_LABELS = Object.fromEntries(
  PART_ORDER.map((p) => [p, p.charAt(0).toUpperCase() + p.slice(1)])
);
