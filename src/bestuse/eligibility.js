// Decides which components could be cut from a given hide, and records what
// could not be checked rather than guessing.

export function filterEligible(hide, components) {
  if (!hide || hide.outlinePolygon == null) {
    return { eligible: [], excluded: [], hideRejection: 'no-outline' };
  }

  // A partially-cut hide still carries its ORIGINAL outline — nothing
  // records where the cuts went — so any layout on it would place parts over
  // leather that is already gone. Re-photographing the offcut as a new hide
  // is the real fix, and is what the operator would physically do anyway.
  // A missing key means the record predates the Jobs feature: treat as uncut.
  if ((hide.remainingAreaPct ?? 100) < 100) {
    return { eligible: [], excluded: [], hideRejection: 'partially-cut' };
  }

  const eligible = [];
  const excluded = [];

  for (const component of components) {
    if (
      component.allowedSpecies != null &&
      !component.allowedSpecies.includes(hide.species)
    ) {
      excluded.push({ componentId: component.id, reason: 'species' });
      continue;
    }

    const unverified = [];
    const min = component.thicknessMinMm;
    const max = component.thicknessMaxMm;

    if (min != null || max != null) {
      if (hide.thicknessMm == null) {
        // Eligible, but the operator is told exactly which constraint went
        // unchecked so a later confirm step can demand the measurement.
        unverified.push('thicknessMm');
      } else if (
        (min != null && hide.thicknessMm < min) ||
        (max != null && hide.thicknessMm > max)
      ) {
        excluded.push({ componentId: component.id, reason: 'thickness' });
        continue;
      }
    }

    eligible.push({ component, unverified });
  }

  return { eligible, excluded, hideRejection: null };
}
