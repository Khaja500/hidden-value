/**
 * Plain-language rendering of quote explanations. Every number comes from the explanation object; the text is a
 * template around it.
 */
import type { Advice } from '../agents/advisor';
import { rankName, rankOf } from '../engine/cards';
import { PLAYER_POSITION_LIMIT } from '../engine/rules';
import type { FairValueReason, PlayerAction, QuoteExplanation } from '../engine/types';
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
    const label = e.mmKind === 'learned' ? 'Public-card value' : 'Fair value';
    bullets.push(`${label} ${fmt(e.fairValue)}, ${dir}${dir === 'unchanged' ? '' : since}${why}.`);
    const q = e.inventory.position;
    if (e.mmKind === 'learned' && e.learned) {
      const L = e.learned;
      bullets.push(
        `My trained policy moves the centre ${signed(e.learnedOffset)} from the public-card value and quotes a half-spread of ${fmt(e.fixedHalfSpread)}.`,
      );
      const top = L.contributions
        .filter((c) => Math.abs(c.offset) >= 0.05)
        .sort((a, b) => Math.abs(b.offset) - Math.abs(a.offset))
        .slice(0, 3)
        .map((c) => `${c.feature.toLowerCase()} ${signed(c.offset)}`);
      if (top.length) bullets.push(`Biggest pushes on the centre: ${joinList(top)}.`);
      const topH = L.contributions
        .filter((c) => Math.abs(c.halfSpread) >= 0.05)
        .sort((a, b) => Math.abs(b.halfSpread) - Math.abs(a.halfSpread))
        .slice(0, 2)
        .map((c) => `${c.feature.toLowerCase()} ${signed(c.halfSpread)}`);
      if (topH.length) bullets.push(`Biggest effects on the half-spread: ${joinList(topH)}.`);
      bullets.push(
        `Each unit of inventory moves my prices by ${signed(L.inventoryPerUnit, 2)} right now${q !== 0 ? ` (I hold ${q > 0 ? '+' : ''}${q})` : ''}. These reasons come from a linear model distilled from the policy (fidelity R² ${L.fidelity.toFixed(2)}).`,
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

// ---- Advisor ----------------------------------------------------------------------------------------------------

export interface RenderedAdvice {
  /** e.g. "▲ BUY 2 at the ask (39.0)" or "■ HOLD". */
  headline: string;
  estimate: string;
  edge: string | null;
  why: string[];
  risk: string | null;
  position: string | null;
  warning: string | null;
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function privateCardLabel(cards: readonly { card: number }[]): string {
  return cards.map((c) => rankName(rankOf(c.card))).join(' and ');
}

export function renderAdvice(a: Advice, privateCards: readonly { card: number }[]): RenderedAdvice {
  const est = `Your estimate: ${fmt(a.estimate.mean)} ± ${fmt(a.estimate.sd)}`;
  const why: string[] = [];
  const at = a.attribution;
  const label = privateCardLabel(privateCards);
  const plural = privateCards.length > 1;
  if (Math.abs(at.privateCard) >= 0.05) {
    why.push(
      `Your private ${label} ${at.privateCard > 0 ? 'lift' : 'lower'}${plural ? '' : 's'} your estimate ${fmt(Math.abs(at.privateCard))} ${at.privateCard > 0 ? 'above' : 'below'} what the public information says.`,
    );
  } else {
    why.push(
      `Your private ${label} ${plural ? 'are' : 'is'} about average, so ${plural ? 'they barely move' : 'it barely moves'} your estimate.`,
    );
  }
  if (Math.abs(at.publicCards) < 1) why.push('Revealed cards so far are about average.');
  else
    why.push(
      `Revealed cards so far are ${at.publicCards > 0 ? 'high' : 'low'}: they moved the public value ${signed(at.publicCards)} from 35.`,
    );
  const f = a.flow;
  const counts = [];
  if (f.buys) counts.push(`${f.buys} buy${f.buys === 1 ? '' : 's'}`);
  if (f.sells) counts.push(`${f.sells} sell${f.sells === 1 ? '' : 's'}`);
  if (f.passes) counts.push(`${f.passes} pass${f.passes === 1 ? '' : 'es'}`);
  const flowCount = counts.join(', ');
  if (Math.abs(at.orderFlow) >= 0.15) {
    why.push(
      `The trade feed (${flowCount}) suggests informed ${at.orderFlow > 0 ? 'buying' : 'selling'}: ${signed(at.orderFlow)}.`,
    );
  } else if (counts.length > 0) {
    why.push(`The trade feed so far (${flowCount}) tells you little.`);
  }
  if (at.mid !== null && Math.abs(at.other) >= 0.3) {
    const above = at.other < 0;
    const q = a.mmPosition;
    const invReason =
      q < 0 && above
        ? `: it reacts to the order flow, and it is short ${-q} unit${q < -1 ? 's' : ''} (from the trade feed), which pushes its prices up`
        : q > 0 && !above
          ? `: it reacts to the order flow, and it is long ${q} unit${q > 1 ? 's' : ''} (from the trade feed), which pushes its prices down`
          : ', from its own reading of the order flow';
    why.push(
      `The market maker's mid (${fmt(at.mid)}) is ${fmt(Math.abs(at.other))} ${above ? 'above' : 'below'} the public-card value${invReason}.`,
    );
  }

  if (a.action === 'hold') {
    const parts: string[] = [];
    if (a.buyEdge !== null) {
      const e = a.buyEdge;
      const ask = a.estimate.mean - e;
      if (e <= 0) {
        parts.push(
          `Ask ${fmt(ask)} vs your estimate ${fmt(a.estimate.mean)}: buying loses ${fmt(-e)} per unit on average.`,
        );
      } else if (e <= a.minEdge) {
        parts.push(
          `Ask ${fmt(ask)}: buying gains only ${fmt(e)} per unit, less than the ${fmt(a.minEdge)} needed at this level of uncertainty.`,
        );
      } else if (a.buyProb !== null && a.buyProb < a.pMin) {
        parts.push(
          `Ask ${fmt(ask)}: buying gains ${fmt(e)} per unit on average, but there is only a ${pct(a.buyProb)} chance V ends above the ask (the Advisor wants ${pct(a.pMin)}).`,
        );
      }
    }
    if (a.sellEdge !== null) {
      const e = a.sellEdge;
      const bid = a.estimate.mean + e;
      if (e <= 0) {
        parts.push(`Bid ${fmt(bid)}: selling gives up ${fmt(-e)} per unit.`);
      } else if (e <= a.minEdge) {
        parts.push(
          `Bid ${fmt(bid)}: selling gains only ${fmt(e)} per unit, less than the ${fmt(a.minEdge)} needed.`,
        );
      } else if (a.sellProb !== null && a.sellProb < a.pMin) {
        parts.push(
          `Bid ${fmt(bid)}: selling gains ${fmt(e)} per unit on average, but there is only a ${pct(a.sellProb)} chance V ends below the bid (the Advisor wants ${pct(a.pMin)}).`,
        );
      }
    }
    if (a.maxBuy === 0 && a.buyEdge !== null && a.buyEdge > a.minEdge)
      parts.push('You cannot buy more: position limit.');
    if (a.maxSell === 0 && a.sellEdge !== null && a.sellEdge > a.minEdge)
      parts.push('You cannot sell more: position limit.');
    parts.push('No good trade right now.');
    return {
      headline: '■ HOLD',
      estimate: est,
      edge: parts.join(' '),
      why,
      risk: null,
      position: null,
      warning: renderWarning(a),
    };
  }

  const buy = a.action === 'buy';
  const edge = buy ? a.buyEdge! : a.sellEdge!;
  const prob = buy ? a.buyProb! : a.sellProb!;
  const headline = `${buy ? '▲ BUY' : '▼ SELL'} ${a.size} at the ${buy ? 'ask' : 'bid'} (${fmt(a.price)})${a.closing ? ' to close' : ''}`;
  const edgeLine = `Edge: ${signed(edge)} per unit, ${pct(prob)} chance V ends ${buy ? 'above' : 'below'} ${fmt(a.price)}`;
  const risk = a.risk
    ? a.risk.lossPerUnit > 0
      ? `Risk: if V ends at ${a.risk.value}, you lose ${fmt(a.risk.lossPerUnit)} per unit.`
      : `Risk: even if V ends at ${a.risk.value}, you still make ${fmt(-a.risk.lossPerUnit)} per unit.`
    : null;
  const pos = a.positionAfter;
  return {
    headline,
    estimate: est,
    edge: edgeLine,
    why,
    risk,
    position: `Position after trade: ${pos > 0 ? '+' : ''}${pos} (limit ${PLAYER_POSITION_LIMIT})`,
    warning: renderWarning(a),
  };
}

function renderWarning(a: Advice): string | null {
  const w = a.warning;
  if (!w) return null;
  const dir = w.midMove >= 0 ? 'rose' : 'fell';
  return `After your last ${w.count} ${w.side}s the market maker's mid ${dir} ${fmt(Math.abs(w.midMove))}. It is adjusting to your trades: trade too eagerly and its prices move against you.`;
}

/** One-line verdict on a trade, using only what the player knew at that moment (spec §5.7). */
export function tradeVerdict(a: Advice, action: PlayerAction): string | null {
  if (action.side === 'pass') return null;
  const edge = action.side === 'buy' ? a.buyEdge : a.sellEdge;
  if (edge === null) return null;
  const total = edge * action.size;
  if (edge >= a.minEdge && edge > 0)
    return `Good trade: ${signed(edge)} expected edge per unit (${signed(total)} total).`;
  if (edge > 0) return `Small edge: ${signed(edge)} per unit, within the noise of your estimate.`;
  return action.side === 'buy'
    ? `Negative edge: you paid ${fmt(-edge)} more than your estimate per unit.`
    : `Negative edge: you sold ${fmt(-edge)} below your estimate per unit.`;
}
