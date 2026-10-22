/**
 * Post-game review (spec §7). Replays a finished game from its config and the player's actions, capturing at
 * every player decision the MM's quote and full explanation, the Advisor's advice, and what the player did. All
 * of this is deterministic, so it matches what happened during play exactly.
 */
import { Advisor, type Advice } from '../agents/advisor';
import { createGame } from '../agents/factory';
import type { BotType, GameConfig, PlayerAction, Quote, QuoteExplanation } from '../engine/types';
import { buildLessons } from './lessons';
import {
  renderAdvice,
  renderExplanation,
  tradeVerdict,
  type RenderedAdvice,
  type RenderedExplanation,
} from './render';

export interface ReviewStep {
  index: number;
  round: number;
  step: number;
  /** Card revealed at the start of this step (first step of rounds 2–4). */
  reveal: number | null;
  /** The bot that arrived just before the player acted; its type is shown now that the game is over. */
  bot: { type: BotType; side: PlayerAction['side']; size: number; price: number | null; knew: number[] };
  quote: Quote;
  explanation: QuoteExplanation;
  explanationText: RenderedExplanation;
  advice: Advice;
  adviceText: RenderedAdvice;
  action: PlayerAction;
  followed: boolean;
  /** Per-unit expected edge of the player's trade at the time (null for passes). */
  expectedEdge: number | null;
  /** Realized P&L of this trade at settlement (null for passes). */
  realized: number | null;
  verdict: string | null;
  playerMu: number;
  playerSd: number;
  mmMu: number;
  positionAfter: number;
}

export interface GradedTrade {
  index: number;
  round: number;
  step: number;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  advised: Advice['action'];
  followed: boolean;
  expectedEdge: number;
  expectedTotal: number;
  realized: number;
}

export interface KeyMoment {
  index: number;
  round: number;
  step: number;
  text: string;
  value: number;
}

export interface ReviewData {
  difficulty: GameConfig['difficulty'];
  mmKind: GameConfig['mmKind'];
  outcome: {
    cards: number[];
    privatePositions: number[];
    value: number;
    pnl: { player: number; mm: number; noise: number; informed: number };
  };
  steps: ReviewStep[];
  trades: GradedTrade[];
  missed: KeyMoment[];
  worst: KeyMoment[];
  lessons: string[];
  followRate: number | null;
}

export function sameDirection(a: Advice['action'], b: PlayerAction['side']): boolean {
  return (a === 'hold' && b === 'pass') || a === b;
}

export function buildReview(
  config: GameConfig,
  actions: readonly PlayerAction[],
  onProgress?: (done: number, total: number) => void,
): ReviewData {
  const game = createGame(config);
  const advisor = new Advisor();
  const total = actions.length;
  const steps: ReviewStep[] = [];
  for (let i = 0; i < actions.length && game.phase !== 'settled'; i++) {
    const view = game.view();
    const st = game.fullState();
    const advice = advisor.advise(view);
    const explanation = game.marketMaker.explain({ counterfactuals: true });
    const botRec = st.botRecords[st.botRecords.length - 1];
    const botEv = st.events[botRec.seq];
    const revealEv = st.events.find((e) => e.kind === 'reveal' && e.round === view.round);
    const action = actions[i];
    const expectedEdge =
      action.side === 'buy' ? advice.buyEdge : action.side === 'sell' ? advice.sellEdge : null;
    steps.push({
      index: i,
      round: view.round,
      step: view.step,
      reveal: view.step === 1 && revealEv && revealEv.kind === 'reveal' ? revealEv.card : null,
      bot: {
        type: botRec.type,
        side: botEv.kind === 'action' ? botEv.side : 'pass',
        size: botEv.kind === 'action' ? botEv.size : 0,
        price: botEv.kind === 'action' ? botEv.price : null,
        knew: botRec.type === 'informed' ? botRec.positions.map((p) => st.cards[p]) : [],
      },
      quote: view.quote,
      explanation,
      explanationText: renderExplanation(explanation),
      advice,
      adviceText: renderAdvice(advice, view.privateCards),
      action,
      followed: sameDirection(advice.action, action.side),
      expectedEdge,
      realized: null,
      verdict: tradeVerdict(advice, action),
      playerMu: advice.estimate.mean,
      playerSd: advice.estimate.sd,
      mmMu: explanation.fairValue,
      positionAfter:
        view.player.position +
        (action.side === 'buy' ? action.size : action.side === 'sell' ? -action.size : 0),
    });
    game.act(action);
    onProgress?.(i + 1, total);
  }
  if (game.phase !== 'settled') throw new Error('The action list does not finish the game');

  const s = game.settlement();
  const V = s.value;
  for (const step of steps) {
    const a = step.action;
    if (a.side === 'buy') step.realized = (V - step.quote.ask!) * a.size;
    else if (a.side === 'sell') step.realized = (step.quote.bid! - V) * a.size;
  }

  const trades: GradedTrade[] = steps
    .filter((x) => x.action.side !== 'pass')
    .map((x) => ({
      index: x.index,
      round: x.round,
      step: x.step,
      side: x.action.side as 'buy' | 'sell',
      size: x.action.size,
      price: (x.action.side === 'buy' ? x.quote.ask : x.quote.bid)!,
      advised: x.advice.action,
      followed: x.followed,
      expectedEdge: x.expectedEdge ?? 0,
      expectedTotal: (x.expectedEdge ?? 0) * x.action.size,
      realized: x.realized ?? 0,
    }));

  const missed: KeyMoment[] = steps
    .filter((x) => x.advice.action !== 'hold' && !x.followed)
    .map((x) => {
      const edge = (x.advice.action === 'buy' ? x.advice.buyEdge : x.advice.sellEdge) ?? 0;
      const value = edge * x.advice.size;
      const did =
        x.action.side === 'pass'
          ? 'you passed'
          : `you ${x.action.side === 'buy' ? 'bought' : 'sold'} instead`;
      return {
        index: x.index,
        round: x.round,
        step: x.step,
        value,
        text: `The Advisor said ${x.advice.action.toUpperCase()} ${x.advice.size} at ${(x.advice.price ?? 0).toFixed(1)} (expected +${value.toFixed(1)}); ${did}.`,
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);

  const worst: KeyMoment[] = trades
    .slice()
    .sort((a, b) => a.expectedTotal - b.expectedTotal)
    .slice(0, 3)
    .map((t) => ({
      index: t.index,
      round: t.round,
      step: t.step,
      value: t.expectedTotal,
      text: `${t.side === 'buy' ? 'Bought' : 'Sold'} ${t.size} at ${t.price.toFixed(1)}: expected ${t.expectedTotal >= 0 ? '+' : '−'}${Math.abs(t.expectedTotal).toFixed(1)} at the time, actual ${t.realized >= 0 ? '+' : '−'}${Math.abs(t.realized).toFixed(1)}.`,
    }));

  const followRate = steps.length ? steps.filter((x) => x.followed).length / steps.length : null;
  const privatePositions = config.playerCards === 2 ? [0, 1] : [0];
  const data: ReviewData = {
    difficulty: config.difficulty,
    mmKind: config.mmKind,
    outcome: { cards: s.cards, privatePositions, value: V, pnl: s.pnl },
    steps,
    trades,
    missed,
    worst,
    lessons: [],
    followRate,
  };
  data.lessons = buildLessons(data, config);
  return data;
}
