/** Templated post-game tips, each triggered by a pattern in the player's own trades (spec §7.5). */
import { PLAYER_POSITION_LIMIT } from '../engine/rules';
import type { GameConfig } from '../engine/types';
import type { ReviewData } from './review';

interface Lesson {
  weight: number;
  text: string;
}

const spreadOf = (q: { bid: number | null; ask: number | null }) =>
  q.bid === null || q.ask === null ? null : q.ask - q.bid;

export function buildLessons(r: ReviewData, config: GameConfig): string[] {
  const out: Lesson[] = [];
  const steps = r.steps;
  const trades = steps.filter((s) => s.action.side !== 'pass');

  // Trading right after the spread widened.
  let widenedSells = 0;
  let widenedBuys = 0;
  for (let i = 1; i < steps.length; i++) {
    const now = spreadOf(steps[i].quote);
    const before = spreadOf(steps[i - 1].quote);
    if (now === null || before === null || now <= before + 0.25) continue;
    if (steps[i].action.side === 'sell') widenedSells++;
    if (steps[i].action.side === 'buy') widenedBuys++;
  }
  if (widenedSells >= 2) {
    out.push({
      weight: 3,
      text: `You often sold right after the market maker widened its spread (${widenedSells} times). A wide spread means it is uncertain, so its bid is less attractive.`,
    });
  }
  if (widenedBuys >= 2) {
    out.push({
      weight: 3,
      text: `You often bought right after the market maker widened its spread (${widenedBuys} times). A wide spread means it is uncertain, so its ask is less attractive.`,
    });
  }

  // Trading against the private card.
  const against = trades.filter(
    (s) =>
      (s.action.side === 'buy' && s.advice.attribution.privateCard < -1) ||
      (s.action.side === 'sell' && s.advice.attribution.privateCard > 1),
  );
  if (against.length >= 1) {
    out.push({
      weight: 4,
      text: `${against.length === 1 ? 'Once' : `${against.length} times`} you traded against your own private card: it pointed the other way. Start from your private card; it is the one thing the market maker cannot see.`,
    });
  }

  // Negative and too-small edges.
  const negative = trades.filter((s) => (s.expectedEdge ?? 0) < 0);
  if (negative.length >= 2) {
    out.push({
      weight: 5,
      text: `${negative.length} of your trades had negative expected edge: you paid more than your estimate, or sold below it. Compare the price with your estimate before every trade.`,
    });
  }
  const small = trades.filter((s) => (s.expectedEdge ?? 0) >= 0 && (s.expectedEdge ?? 0) < s.advice.minEdge);
  if (small.length >= 2) {
    out.push({
      weight: 2,
      text: `${small.length} trades had an edge smaller than the noise in your estimate. Waiting for bigger edges usually pays more than trading often.`,
    });
  }

  // Chasing prices.
  let chased = 0;
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i].quote.ask;
    const pa = steps[i - 1].quote.ask;
    if (steps[i].action.side === 'buy' && a !== null && pa !== null && a >= pa + 1) chased++;
  }
  if (chased >= 2) {
    out.push({
      weight: 2,
      text: `You bought ${chased} times just after the ask jumped. Rising prices often mean the market maker has already priced in what you know.`,
    });
  }

  // Strong opportunities passed up.
  const strongMissed = r.missed.filter((m) => m.value > 3);
  if (strongMissed.length >= 1) {
    out.push({
      weight: 3,
      text: `You passed on ${strongMissed.length === 1 ? 'a trade' : `${strongMissed.length} trades`} the Advisor rated strongly. With an extreme private card (A–3 or J–K), early rounds are usually when your edge is biggest.`,
    });
  }

  // Hard mode: the market maker learns from you.
  if (config.mmLearnsFromPlayer) {
    let run = 0;
    let maxRun = 0;
    let last = '';
    for (const s of trades) {
      run = s.action.side === last ? run + 1 : 1;
      last = s.action.side;
      maxRun = Math.max(maxRun, run);
    }
    if (maxRun >= 3) {
      out.push({
        weight: 4,
        text: `You traded the same way ${maxRun} times in a row. In Hard mode the market maker learns from your trades, so each one moved its prices against the next.`,
      });
    }
  }

  // Position limit.
  if (steps.some((s) => Math.abs(s.positionAfter) >= PLAYER_POSITION_LIMIT)) {
    out.push({
      weight: 2,
      text: 'You hit your position limit, so you could not act on later opportunities. Keeping some room is worth something.',
    });
  }

  // Ignored a last-round close.
  const closes = steps.filter((s) => s.advice.closing && !s.followed);
  if (closes.length >= 1) {
    out.push({
      weight: 2,
      text: 'In the last round the Advisor suggested closing a position whose edge had turned negative, and you held on.',
    });
  }

  // Encouragement when there is nothing to fix.
  if (trades.length > 0 && negative.length === 0 && against.length === 0) {
    out.push({
      weight: 1,
      text: 'Every trade you made had positive expected edge at the time. That habit wins over many deals, whatever the cards did in this one.',
    });
  }
  if (trades.length === 0 && r.missed.length === 0) {
    out.push({
      weight: 1,
      text: 'Neither you nor the Advisor found a trade worth making in this deal. Some deals simply have no edge, and not forcing one is right.',
    });
  }
  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map((l) => l.text);
}
