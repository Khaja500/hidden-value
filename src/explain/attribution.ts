/**
 * Attribution of the gap between the player's estimate and the market maker's mid (spec §5.5). Each part is
 * computed by recomputing the player's estimate with one piece of information removed, so the parts add up to the
 * total gap exactly:
 *   gap = μ_player − mid
 *       = (μ_player − μ_without_private)          private card(s)
 *       + (μ_without_private − μ_public_cards)     order flow, as the player reads it
 *       + (μ_public_cards − mid)                   the market maker's own positioning ("other")
 * Public cards move both estimates equally, so they contribute nothing to the gap; their effect relative to the
 * 35 prior is reported separately as context.
 */
import { PRIOR_MEAN } from '../engine/cards';

export interface Attribution {
  mid: number | null;
  gap: number;
  privateCard: number;
  orderFlow: number;
  other: number;
  /** Context only: how far the revealed cards moved the public expected value from the prior. */
  publicCards: number;
}

export function attribute(
  muPlayer: number,
  muWithoutPrivate: number,
  muPublic: number,
  mid: number | null,
): Attribution {
  const ref = mid ?? muPublic;
  return {
    mid,
    gap: muPlayer - ref,
    privateCard: muPlayer - muWithoutPrivate,
    orderFlow: muWithoutPrivate - muPublic,
    other: muPublic - ref,
    publicCards: muPublic - PRIOR_MEAN,
  };
}
