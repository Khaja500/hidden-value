/** Calibration summaries: do predicted means / probabilities match realized outcomes? */

export interface CalibrationBucket {
  n: number;
  meanPredicted: number;
  meanRealized: number;
  /** Half-width of the 95% confidence interval for the realized mean. */
  ci95: number;
  ok: boolean;
}

/** Equal-count buckets of (prediction, realized value) pairs, sorted by prediction. */
export function quantileBuckets(pred: number[], real: number[], buckets: number): CalibrationBucket[] {
  const idx = pred.map((_, i) => i).sort((a, b) => pred[a] - pred[b]);
  const out: CalibrationBucket[] = [];
  for (let b = 0; b < buckets; b++) {
    const slice = idx.slice(
      Math.floor((b * idx.length) / buckets),
      Math.floor(((b + 1) * idx.length) / buckets),
    );
    out.push(
      summarize(
        slice.map((i) => pred[i]),
        slice.map((i) => real[i]),
        false,
      ),
    );
  }
  return out;
}

/** Fixed-width probability buckets [0, 0.1), …, [0.9, 1] of (probability, 0/1 outcome) pairs. */
export function probabilityBuckets(
  prob: number[],
  hit: number[],
  buckets = 10,
  minCount = 30,
): CalibrationBucket[] {
  const groups: number[][] = Array.from({ length: buckets }, () => []);
  prob.forEach((p, i) => groups[Math.min(buckets - 1, Math.floor(p * buckets))].push(i));
  return groups
    .filter((g) => g.length >= minCount)
    .map((g) =>
      summarize(
        g.map((i) => prob[i]),
        g.map((i) => hit[i]),
        true,
      ),
    );
}

function summarize(pred: number[], real: number[], binary: boolean): CalibrationBucket {
  const n = pred.length;
  const mp = pred.reduce((a, b) => a + b, 0) / n;
  const mr = real.reduce((a, b) => a + b, 0) / n;
  let se: number;
  if (binary) {
    // Binomial SE at the predicted rate (the null hypothesis), floored so near-certain buckets are not knife-edge.
    se = Math.sqrt(Math.max(mp * (1 - mp), 0.25 / n) / n);
  } else {
    const v = real.reduce((a, x) => a + (x - mr) ** 2, 0) / Math.max(1, n - 1);
    se = Math.sqrt(v / n);
  }
  const ci95 = 1.96 * se;
  return { n, meanPredicted: mp, meanRealized: mr, ci95, ok: Math.abs(mr - mp) <= ci95 };
}
