/**
 * The learned market maker's policy (spec §6.1): features → (centre offset from the public expected value,
 * half-spread). Two variants: a linear policy and a one-hidden-layer MLP (16 tanh units). Pure functions, shared by
 * the in-game market maker and the Node training script.
 */

export type LearnedVariant = 'linear' | 'mlp';

export const FEATURE_NAMES = [
  'Public expected value',
  'Cards revealed',
  'Inventory',
  'Inventory × public variance',
  'Order-flow imbalance (last 3)',
  'Order-flow imbalance (last 8)',
  'Round',
  'Step',
] as const;

export const N_FEATURES = FEATURE_NAMES.length;
export const HIDDEN = 16;

export interface FeatureInputs {
  publicEV: number;
  nRevealed: number;
  publicVariance: number;
  inventory: number;
  imbalance3: number;
  imbalance8: number;
  round: number;
  step: number;
}

/** Normalised features, each roughly in [−1, 1]. */
export function features(f: FeatureInputs): number[] {
  return [
    (f.publicEV - 35) / 8,
    f.nRevealed / 3,
    f.inventory / 10,
    (f.inventory * f.publicVariance) / 650,
    f.imbalance3 / 3,
    f.imbalance8 / 8,
    (f.round - 1) / 3,
    (f.step - 1) / 7,
  ];
}

export function paramCount(variant: LearnedVariant): number {
  return variant === 'linear' ? 2 * (N_FEATURES + 1) : HIDDEN * N_FEATURES + HIDDEN + 2 * HIDDEN + 2;
}

export function softplus(x: number): number {
  return x > 20 ? x : Math.log1p(Math.exp(x));
}

export function inverseSoftplus(y: number): number {
  return Math.log(Math.expm1(y));
}

/** Raw outputs: centre offset and pre-softplus half-spread. */
export function forwardRaw(
  variant: LearnedVariant,
  p: readonly number[],
  x: readonly number[],
): [number, number] {
  const n = N_FEATURES;
  if (variant === 'linear') {
    let a = p[n];
    let b = p[2 * n + 1];
    for (let i = 0; i < n; i++) {
      a += p[i] * x[i];
      b += p[n + 1 + i] * x[i];
    }
    return [a, b];
  }
  const w2 = HIDDEN * n + HIDDEN;
  const b2 = w2 + 2 * HIDDEN;
  let o0 = p[b2];
  let o1 = p[b2 + 1];
  for (let h = 0; h < HIDDEN; h++) {
    let z = p[HIDDEN * n + h];
    for (let i = 0; i < n; i++) z += p[h * n + i] * x[i];
    const t = Math.tanh(z);
    o0 += p[w2 + h] * t;
    o1 += p[w2 + HIDDEN + h] * t;
  }
  return [o0, o1];
}

/** Minimum half-spread the policy can quote before rounding (the 1.0 minimum spread applies after rounding). */
export const MIN_HALF_SPREAD = 0.25;

export function forward(
  variant: LearnedVariant,
  p: readonly number[],
  x: readonly number[],
): { offset: number; halfSpread: number } {
  const [o, h] = forwardRaw(variant, p, x);
  return { offset: o, halfSpread: MIN_HALF_SPREAD + softplus(h) };
}

/** A linear model distilled from the policy: offset ≈ a·x + a0, half-spread ≈ b·x + b0, with fidelity R². */
export interface Distilled {
  offset: number[];
  offsetIntercept: number;
  halfSpread: number[];
  halfSpreadIntercept: number;
  r2Offset: number;
  r2HalfSpread: number;
}

/** The deployable model: policy weights plus its distilled linear explanation. */
export interface LearnedModel {
  variant: LearnedVariant;
  params: number[];
  distilled: Distilled;
  /** Mean fidelity R² of the distilled model, shown next to every explanation. */
  fidelity: number;
  trainedAt: string;
}
