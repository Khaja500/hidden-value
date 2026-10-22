/**
 * Per-state research checks (spec §8.3 and the calibration requirement in §3). Pure functions: the Node scripts
 * run them across many seeds in worker threads.
 */
import { Advisor } from '../agents/advisor';
import { createGame } from '../agents/factory';
import { ParticleFilter } from '../belief/particleFilter';
import { rankOf } from '../engine/cards';
import { hashSeed, Rng } from '../engine/rng';
import type { GameConfig, PlayerAction, PlayerView } from '../engine/types';
import { replayCounterfactual } from '../explain/counterfactual';

function randomLegal(view: PlayerView, rng: Rng): PlayerAction {
  const u = rng.next();
  if (u < 0.3 && view.maxBuy > 0) return { side: 'buy', size: 1 + rng.int(view.maxBuy) };
  if (u < 0.6 && view.maxSell > 0) return { side: 'sell', size: 1 + rng.int(view.maxSell) };
  return { side: 'pass', size: 0 };
}

/** Plays random legal actions for `steps` steps and returns the game. */
function playTo(config: GameConfig, steps: number, seed: number) {
  const game = createGame(config);
  const rng = new Rng(seed);
  for (let s = 0; s < steps && game.phase !== 'settled'; s++) game.act(randomLegal(game.view(), rng));
  return game;
}

export interface CounterfactualCheck {
  checked: number;
  matched: number;
  maxAbsDiff: number;
}

/** Do the counterfactual quotes listed in an explanation equal what a real replay produces? */
export function counterfactualCheck(task: {
  config: GameConfig;
  steps: number;
  seed: number;
}): CounterfactualCheck {
  const game = playTo(task.config, task.steps, task.seed);
  const view = game.view();
  const e = game.marketMaker.explain();
  let checked = 0;
  let matched = 0;
  let maxAbsDiff = 0;
  for (const cf of e.counterfactuals) {
    const q = replayCounterfactual(task.config, view.events, cf.change, view.round, view.step);
    checked++;
    if (q.bid === cf.bid && q.ask === cf.ask) matched++;
    for (const [a, b] of [
      [q.bid, cf.bid],
      [q.ask, cf.ask],
    ] as const) {
      if (a !== null && b !== null) maxAbsDiff = Math.max(maxAbsDiff, Math.abs(a - b));
    }
  }
  return { checked, matched, maxAbsDiff };
}

/** Feeds a fresh particle filter with the public information in a player view (and optionally the private cards). */
export function filterFromView(
  view: PlayerView,
  withPrivate: boolean,
  seed: number,
  particles?: number,
): ParticleFilter {
  const f = new ParticleFilter({
    alpha: view.config.alpha,
    seed,
    particles,
    known: withPrivate ? view.privateCards.map((c) => ({ position: c.position, rank: rankOf(c.card) })) : [],
  });
  for (const e of view.events) {
    if (e.kind === 'reveal') f.reveal(e.position, rankOf(e.card));
    else if (e.kind === 'action' && e.taker === 'bot') f.observe(e);
  }
  return f;
}

export interface AttributionCheck {
  claimed: number;
  independent: number;
}

/**
 * The Advisor claims "your private card moves your estimate by X". Recompute X independently: two fresh filters with
 * different seeds, one with and one without the private card.
 */
export function attributionCheck(task: {
  config: GameConfig;
  steps: number;
  seed: number;
}): AttributionCheck {
  const game = playTo(task.config, task.steps, task.seed);
  const view = game.view();
  const advice = new Advisor().advise(view);
  const s = hashSeed('attribution-check', task.seed);
  const withP = filterFromView(view, true, s);
  const without = filterFromView(view, false, s + 1);
  return { claimed: advice.attribution.privateCard, independent: withP.mean() - without.mean() };
}

export interface CalibrationSample {
  value: number;
  mm: { mu: number; x: number; p: number };
  player: { mu: number; x: number; p: number };
}

/**
 * One calibration sample per game: at a random bot step, the market maker's view (public cards + order flow) and the
 * player's view (plus their private card) each predict μ and a probability P(V > x) for a nearby x.
 */
export function calibrationSample(task: { config: GameConfig }): CalibrationSample {
  const game = createGame(task.config);
  while (game.phase !== 'settled') game.act({ side: 'pass', size: 0 });
  const st = game.fullState();
  const value = st.cards.reduce((a, c) => a + rankOf(c), 0);
  const rng = new Rng(hashSeed(task.config.seed, 'calibration-checkpoint'));
  const checkpoint = rng.int(task.config.rounds * task.config.stepsPerRound);
  const mmF = new ParticleFilter({ alpha: task.config.alpha, seed: hashSeed(task.config.seed, 'calib-mm') });
  const plF = new ParticleFilter({
    alpha: task.config.alpha,
    seed: hashSeed(task.config.seed, 'calib-player'),
    known: [{ position: 0, rank: rankOf(st.cards[0]) }],
  });
  let bots = 0;
  for (const e of st.events) {
    if (e.kind === 'reveal') {
      mmF.reveal(e.position, rankOf(e.card));
      plF.reveal(e.position, rankOf(e.card));
    } else if (e.kind === 'action' && e.taker === 'bot') {
      mmF.observe(e);
      plF.observe(e);
      if (bots++ === checkpoint) break;
    }
  }
  const pick = (f: ParticleFilter) => {
    const mu = f.mean();
    const x = Math.round(mu) + rng.int(9) - 4 + 0.5;
    return { mu, x, p: f.probAbove(x) };
  };
  return { value, mm: pick(mmF), player: pick(plF) };
}
