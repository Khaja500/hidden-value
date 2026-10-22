/**
 * Plain-language rendering of quote explanations. Every number comes from the explanation object; the text is a
 * template around it.
 */
import { rankName, rankOf } from '../engine/cards';
import type { FairValueReason, QuoteExplanation } from '../engine/types';
import { spreadParts } from './quoteExplanation';

const MINUS = '−';

export function fmt(x: number | null, digits = 1): string {
  if (x === null) return '—';
  const s = Math.abs(x).toFixed(digits);
  return x < 0 && Number(s) !== 0 ? `${MINUS}${s}` : s;
}

export function signed(x: number, digits = 1): string {
  const s = Math.abs(x).toFixed(digits);
  if (Number(s) === 0) return `±${s}`;
  return x > 0 ? `+${s}` : `${MINUS}${s}`;
}

export function article(word: string): string {
  return /^[AEIOU8]/i.test(word) ? `an ${word}` : `a ${word}`;
}

function reasonText(r: FairValueReason): string {
  const d = signed(r.delta);
  switch (r.cause) {
    case 'reveal':
      return `${article(rankName(rankOf(r.card!)))} was revealed (${d})`;
    case 'orderFlow':
      if (r.delta > 0.05) return `recent buying suggests informed buyers (${d}; ${r.detail})`;
      if (r.delta < -0.05) return `recent selling suggests informed sellers (${d}; ${r.detail})`;
      return `order flow told me little (${d}; ${r.detail})`;
    case 'playerFlow':
      return r.delta >= 0
        ? `your buying suggests you hold good cards (${d})`
        : `your selling suggests you hold poor cards (${d})`;
  }
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export interface RenderedExplanation {
  headline: string;
  bullets: string[];
  counterfactuals: string[];
}

export function renderExplanation(e: QuoteExplanation): RenderedExplanation {
  const headline = `Bid ${fmt(e.bid)} / Ask ${fmt(e.ask)}`;
  const bullets: string[] = [];
  const change = e.fairValue - e.fairValueChange.from;
  const dir =
    Math.abs(change) < 0.05 ? 'unchanged' : change > 0 ? `up ${fmt(change)}` : `down ${fmt(-change)}`;
  const reasons = e.fairValueChange.reasons.filter((r) => Math.abs(r.delta) >= 0.05 || r.cause === 'reveal');
  const since = e.round === 1 ? ' from the 35.0 starting estimate' : ' this round';

  if (e.mmKind === 'naive') {
    bullets.push(`Center ${fmt(e.fairValue)} = the average of what is left in the deck; fixed spread of 6.`);
    const rev = e.fairValueChange.reasons.find((r) => r.cause === 'reveal');
    if (rev)
      bullets.push(
        `The center moved ${signed(rev.delta)} because ${reasonText(rev).replace(/ \(.*\)$/, '')}.`,
      );
    bullets.push('I ignore order flow and my own inventory.');
  } else {
    const why = reasons.length ? `: ${joinList(reasons.map(reasonText))}` : '';
    bullets.push(`Fair value ${fmt(e.fairValue)}, ${dir}${dir === 'unchanged' ? '' : since}${why}.`);
    const q = e.inventory.position;
    if (e.mmKind === 'learned') {
      bullets.push(
        `My trained policy shifts the center ${signed(e.learnedOffset)} from the public-card value and sets a half-spread of ${fmt(e.fixedHalfSpread)}.`,
      );
    } else if (q > 0) {
      bullets.push(
        `I hold ${q} unit${q > 1 ? 's' : ''}, so I lowered both prices by ${fmt(-e.inventory.skew)} to attract buyers.`,
      );
    } else if (q < 0) {
      bullets.push(
        `I am short ${-q} unit${q < -1 ? 's' : ''}, so I raised both prices by ${fmt(e.inventory.skew)} to attract sellers.`,
      );
    } else {
      bullets.push('I hold no inventory, so there is no skew.');
    }
    if (e.bid === null || e.ask === null) {
      bullets.push(`I am at my position limit, so I only quote the ${e.bid === null ? 'ask' : 'bid'}.`);
    } else if (e.mmKind === 'analytical') {
      const p = spreadParts(e);
      const spread = e.ask - e.bid;
      const as = Number(p.adverseSelection.toFixed(1));
      const risk = Number(p.risk.toFixed(1));
      const rounding = Number((spread - as - risk).toFixed(1));
      const tail =
        Math.abs(rounding) < 0.05
          ? ''
          : ` ${rounding > 0 ? '+' : MINUS} ${fmt(Math.abs(rounding))} rounding to the tick`;
      bullets.push(
        `Spread ${fmt(spread)} = ${fmt(as)} for protection against informed traders + ${fmt(risk)} for risk${tail}.`,
      );
    }
  }
  const counterfactuals = e.counterfactuals.map((c) => `If ${c.if}: bid ${fmt(c.bid)} / ask ${fmt(c.ask)}.`);
  return { headline, bullets, counterfactuals };
}
