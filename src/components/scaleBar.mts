/**
 * Length of the canvas scale bar, in floor units: the largest "round"
 * length (1, 2 or 5 times a power of ten -- 0.1, 0.2, 0.5, 1, 2, ...)
 * that is no more than `maxLength`. Round numbers make the bar easy to
 * read at a glance ("that step is about half a bar"), and capping it at
 * a fraction of the view keeps it from dominating small sequences.
 *
 * Returns 0 for a non-positive or non-finite input.
 */
export function niceScaleLength(maxLength: number): number {
  if (!(maxLength > 0) || !Number.isFinite(maxLength)) return 0;
  const power = 10 ** Math.floor(Math.log10(maxLength));
  for (const multiple of [5, 2, 1]) {
    const candidate = multiple * power;
    // Small tolerance so floating-point noise (e.g. 0.30000000000000004)
    // doesn't push an exact round value down a step.
    if (candidate <= maxLength * (1 + 1e-9)) return candidate;
  }
  return power;
}

/** Label for a scale bar length. Floor units are metres in the current
 *  data (see the Units section of src/libs/dance/AGENTS.md); under a
 *  metre the label switches to centimetres. */
export function formatScaleLength(length: number): string {
  if (length >= 1) return `${Number(length.toPrecision(3))} m`;
  return `${Math.round(length * 100)} cm`;
}
