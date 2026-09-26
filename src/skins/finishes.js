import { titleCase, populateSelect } from './vocab.js';

// The one list of finishes -- how a hide's surface was treated. Its own file
// beside cuts.js and species.js, for the same reason each of those has one.
//
// Taken from the supplier's swatch charts
// (docs/reference/leather-swatches.json): twenty of 39 charts state a finish,
// across these seven values. Ordered commonest first, unlike CUTS where
// `whole` leads because it is the default rather than the most frequent.
//
// ONE AXIS ON PURPOSE. Taxonomically these are three different kinds of
// thing: glossy and matte are gloss levels, suede and hand-painted and nappa
// are treatments, pebble grain is a grain. Splitting them into three fields
// was considered and rejected, because every chart carries exactly one value
// in this slot -- "Ostrich Leg Suede" is suede, "Ostrich Leg Glossy" is
// glossy, and no chart states both. The supplier treats surface as one axis,
// and inventing structure the source does not have would buy three dropdowns
// and three gates for a distinction nobody has needed yet. A chart stating
// both a gloss and a treatment is what would reopen it.
//
// `semi-gloss` is deliberately ABSENT. The app offered it for months; it
// appears in no chart, and the operator confirmed (2026-09-26) it was
// invented on our side. A hide labelled with a word the supplier has no
// equivalent for cannot be ordered against their catalogue or matched to it.
//
// `hand-painted` and `hand-painted two-tone` stay two values rather than one,
// per the catalogue's rule that names are recorded as printed -- normalising
// them is the supplier's call, not ours.
//
// Null means unknown, and there is no 'unknown' value: nineteen charts state
// no finish at all. Not enforced server-side, same as species and cuts -- the
// <select> steers, the API does not refuse a finish that arrived before this
// list was updated.
//
// See docs/superpowers/specs/2026-09-26-hide-finish-design.md.
export const FINISHES = [
  'matte',
  'glossy',
  'suede',
  'hand-painted',
  'pebble grain',
  'hand-painted two-tone',
  'nappa',
];

export const finishLabel = titleCase;

export function populateFinishSelect(select, selected = '') {
  populateSelect(select, FINISHES, selected);
}
