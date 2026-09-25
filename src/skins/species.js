import { titleCase, populateSelect } from './vocab.js';

// The one list of species, so the four places that ask for one cannot drift
// apart. They did drift: the Hides page offered "cayman" while every supplier
// chart says "caiman", and matching groups hides by their exact species
// string -- so the two spellings could never have paired with each other.
//
// Taken from the supplier's own swatch charts
// (docs/reference/leather-swatches.json, 39 charts). Three renames were the
// operator's call, 2026-09-24: buffalo -> bison (different animals; the
// charts sell American Bison), fish -> arapaima (the charts sell Arapaima
// Piracucu specifically), cow -> calf (the charts sell Italian Calf).
//
// Not enforced server-side on purpose. The catalogue is the supplier's and
// will grow; the UI should steer towards these spellings without the API
// refusing a hide because a new skin arrived before this list was updated.
export const SPECIES = [
  'alligator',
  'anaconda',
  'arapaima',
  'banded water snake',
  'bison',
  'caiman',
  'calf',
  'cobra',
  'elephant',
  'flower snake',
  'lizard',
  'ostrich',
  'python',
  'radiated snake',
  'saltwater crocodile',
  'shark',
  'stingray',
  'viper',
  'western diamond rattle snake',
];

export const speciesLabel = titleCase;

// Fills a <select> with the canonical list, keeping the element's existing
// "-- Choose species --" placeholder option if it has one.
export function populateSpeciesSelect(select, selected = '') {
  populateSelect(select, SPECIES, selected);
}
