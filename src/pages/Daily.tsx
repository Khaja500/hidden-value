import { useEffect, useState } from 'react';
import { GameScreen } from '../components/GameScreen';
import { PRIOR_MEAN, PRIOR_VARIANCE } from '../engine/cards';
import { DIFFICULTIES } from '../engine/rules';
import type { Difficulty } from '../engine/types';
import { fmt, signed } from '../explain/render';
import { href } from '../router';
import { loadLeaderboard, todayUTC, useGame, useGameVisible } from '../store/gameStore';
import { useSettings } from '../store/settings';

/** Everyone gets the same deal on the same UTC date (seed derived from the date) at this table. */
export const DAILY_DIFFICULTY: Difficulty = 'medium';

function RankedNote() {
  return (
    <div className="ranked">
      <p>Ranked play: no Advisor and no hints. You are on your own.</p>
      <p className="muted">
        Reminder: before any card is shown, V averages {PRIOR_MEAN} (SD about {fmt(Math.sqrt(PRIOR_VARIANCE))}
        ). Each card is worth 7 on average, so a card above 7 pushes V up and one below 7 pushes it down.
      </p>
    </div>
  );
}

export function Daily() {
  const status = useGame((s) => s.status);
  const mode = useGame((s) => s.mode);
  const log = useGame((s) => s.log);
  const start = useGame((s) => s.start);
  const pacing = useSettings((s) => s.pacing);
  const date = todayUTC();
  const [board, setBoard] = useState(() => loadLeaderboard(date));

  useEffect(() => {
    document.title = 'Daily challenge · Hidden Value';
  }, []);
  // Refresh the leaderboard when a game finishes or its skill score arrives.
  useEffect(() => {
    setBoard(loadLeaderboard(date));
  }, [date, status, log?.skill]);

  const [show, markStarted] = useGameVisible('daily');
  const begin = () => {
    markStarted();
    start({ difficulty: DAILY_DIFFICULTY, mode: 'daily', pacing });
  };

  if (show) {
    return (
      <main id="main" className="page page--play">
        <GameScreen rankedNote={<RankedNote />} onPlayAgain={begin} />
      </main>
    );
  }

  const attempts = board.slice().sort((a, b) => a.createdAt - b.createdAt);
  const first = attempts[0];
  return (
    <main id="main" className="page page--narrow">
      <p className="stamp">Daily challenge · {date} (UTC)</p>
      <h1>Today’s deal</h1>
      <p className="lede">
        Everyone in the world gets the same five cards and the same bots today, on the{' '}
        {DIFFICULTIES[DAILY_DIFFICULTY].label} table. It is ranked: no Advisor. Your first attempt is your
        score; replays are listed too, but you already know the cards by then.
      </p>
      {status === 'playing' && mode !== 'daily' && (
        <p className="callout">
          You have a {mode} game in progress. Starting the daily challenge abandons it.
        </p>
      )}
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={begin} data-testid="start-daily">
          {first ? 'Replay today’s deal' : 'Play today’s deal'}
        </button>
        <a className="btn" href={href('/tutorial')}>
          Tutorial first
        </a>
      </div>

      <section className="ticket leaderboard" aria-labelledby="lb-title">
        <h2 className="stamp" id="lb-title">
          Your leaderboard for {date}
        </h2>
        {board.length === 0 ? (
          <p className="empty">No scores yet today. Your results are saved in this browser only.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Attempt</th>
                  <th className="num">P&amp;L</th>
                  <th className="num">Skill</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {board.map((e, i) => (
                  <tr key={e.id} className={first && e.id === first.id ? 'lb__first' : ''}>
                    <td className="num">{i + 1}</td>
                    <td>
                      {first && e.id === first.id
                        ? 'First attempt (ranked)'
                        : `Replay · ${new Date(e.createdAt).toLocaleTimeString()}`}
                    </td>
                    <td className="num">{signed(e.pnl)}</td>
                    <td className="num">{e.skill === null ? '…' : signed(e.skill)}</td>
                    <td>
                      <a href={href(`/review/${e.id}`)}>Review</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          Skill = your P&amp;L minus what the Advisor bot made on the same deal, so it cancels out the luck of
          the cards.
        </p>
      </section>
    </main>
  );
}
