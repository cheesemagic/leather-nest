import { titleCase, populateSelect } from './vocab.js';

// The one list of cuts -- which part of the animal a hide came from. Its own
// file rather than an addition to species.js, which opens by calling itself
// the one list of species; two vocabularies in a file named for one of them
// is a worse home than a second file.
//
// Taken from the supplier's swatch charts
// (docs/reference/leather-swatches.json): nine of 39 charts name a cut,
// across these five values. `whole` is the remaining thirty -- a skin that is
// not a cut at all -- and leads the list because it is by far the common case.
//
// `multispine` appears in the charts' cut field and is deliberately absent
// here. A multispine stingray grew two spine rows instead of one: a trait of
// that individual animal, not a part of the body. Listing it as a cut would
// assert it came from somewhere else on the animal, and would stop it pairing
// with any other stingray on that false basis. See
// docs/superpowers/specs/2026-09-25-hide-cut-design.md.
//
// There is no 'unknown' value: null already means that, and two
// representations of one state is how they drift apart.
//
// Not enforced server-side, for the reason species.js gives for the same
// choice: the catalogue is the supplier's and will grow. The <select> steers;
// the API should not refuse a hide because a cut arrived before this list was
// updated.
export const CUTS = ['whole', 'belly', 'full quill', 'hornback', 'leg', 'tail'];

export const cutLabel = titleCase;

// Fills a <select> with the canonical list, keeping the element's existing
// placeholder option if it has one.
export function populateCutSelect(select, selected = '') {
  populateSelect(select, CUTS, selected);
}
