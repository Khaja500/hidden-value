/** An automated player that always follows the Advisor (spec §5.6). Used for the skill score and for research. */
import type { Game, GameHooks } from '../engine/game';
import type { GameConfig, PlayerAction } from '../engine/types';
import { Advisor, type Advice, type AdvisorParams } from './advisor';
import { createGame } from './factory';

export function adviceToAction(a: Advice): PlayerAction {
  return a.action === 'hold' ? { side: 'pass', size: 0 } : { side: a.action, size: a.size };
}

export interface AdvisorBotResult {
  game: Game;
  pnl: number;
  actions: PlayerAction[];
  advice: Advice[];
}

export function playAdvisorBot(
  config: GameConfig,
  params: Partial<AdvisorParams> = {},
  hooks: GameHooks = {},
): AdvisorBotResult {
  const game = createGame(config, hooks);
  const advisor = new Advisor(params);
  const actions: PlayerAction[] = [];
  const advice: Advice[] = [];
  while (game.phase !== 'settled') {
    const a = advisor.advise(game.view());
    advice.push(a);
    const act = adviceToAction(a);
    actions.push(act);
    game.act(act);
  }
  return { game, pnl: game.settlement().pnl.player, actions, advice };
}
