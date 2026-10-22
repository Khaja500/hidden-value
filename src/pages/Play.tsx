import { useEffect, useState } from 'react';
import { GameScreen } from '../components/GameScreen';
import { seedFromString } from '../engine/rng';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../engine/rules';
import type { Difficulty } from '../engine/types';
import { href } from '../router';
import { useGame, useGameVisible } from '../store/gameStore';
import { useSettings } from '../store/settings';

export function Play({ query }: { query: URLSearchParams }) {
  const status = useGame((s) => s.status);
  const mode = useGame((s) => s.mode);
  const difficulty = useGame((s) => s.difficulty);
  const round = useGame((s) => s.view?.round ?? 0);
  const [hardTipSeen, setHardTipSeen] = useState(false);
  const [show, markStarted] = useGameVisible('practice');
  const start = useGame((s) => s.start);
  const settings = useSettings();
  const sharedSeed = seedFromString(query.get('seed') ?? '');
  const sharedDiff = query.get('d') as Difficulty | null;
  const validShared = sharedSeed !== null && sharedDiff !== null && sharedDiff in DIFFICULTIES;

  useEffect(() => {
    document.title = 'Play · Hidden Value';
  }, []);

  if (show) {
    // Spec §4.3: the Hard-mode market maker learns from the player's own trades.
    const hardTip =
      difficulty === 'hard' && status === 'playing' && round === 1 && !hardTipSeen ? (
        <div className="tip" role="note">
          <h2 className="tip__title">Hard mode</h2>
          <p className="tip__body">
            Your trades reveal information. Trade too eagerly and the market maker’s prices move against you.
          </p>
          <button type="button" className="btn btn--small" onClick={() => setHardTipSeen(true)}>
            Got it
          </button>
        </div>
      ) : null;
    return (
      <main id="main" className="page page--play">
        <GameScreen
          overlay={hardTip}
          onPlayAgain={() =>
            start({ difficulty: settings.difficulty, mode: 'practice', pacing: settings.pacing })
          }
        />
      </main>
    );
  }

  const begin = (difficulty: Difficulty, seed?: number) => {
    markStarted();
    settings.update({ difficulty });
    start({ difficulty, mode: 'practice', pacing: settings.pacing, seed });
  };

  return (
    <main id="main" className="page">
      <header className="pick__head">
        <h1>Choose your table</h1>
        <p className="lede">
          The asset is worth the sum of five hidden cards. You see one; the market maker sees none. Buy at its
          ask when you think V is higher, sell at its bid when you think it is lower.
        </p>
        {status === 'playing' && mode !== 'practice' && (
          <p className="callout">
            You have a {mode} game in progress.{' '}
            <a href={href(mode === 'daily' ? '/daily' : '/tutorial')}>Go back to it</a>, or start a new
            practice game below (that abandons it).
          </p>
        )}
      </header>

      {validShared && (
        <section className="ticket ticket--perf pick__shared">
          <h2 className="stamp">Shared deal</h2>
          <p>
            A friend sent you deal <span className="mono">{query.get('seed')}</span> on{' '}
            <strong>{DIFFICULTIES[sharedDiff!].label}</strong>. You get the same cards and the same bots they
            did.
          </p>
          <button type="button" className="btn btn--primary" onClick={() => begin(sharedDiff!, sharedSeed!)}>
            Play this deal
          </button>
        </section>
      )}

      <fieldset className="pick__pacing">
        <legend className="stamp">Pacing</legend>
        <label className="radio">
          <input
            type="radio"
            name="pacing"
            checked={settings.pacing === 'turn'}
            onChange={() => settings.update({ pacing: 'turn' })}
          />
          Turn-based <span className="muted">(waits for you each step)</span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="pacing"
            checked={settings.pacing === 'timed'}
            onChange={() => settings.update({ pacing: 'timed' })}
          />
          Timed <span className="muted">({settings.stepSeconds}s per step; no action counts as a pass)</span>
        </label>
        {settings.pacing === 'timed' && (
          <label className="pick__seconds">
            Seconds per step{' '}
            <input
              type="number"
              min={3}
              max={30}
              value={settings.stepSeconds}
              onChange={(e) =>
                settings.update({ stepSeconds: Math.max(3, Math.min(30, Number(e.target.value) || 8)) })
              }
            />
          </label>
        )}
      </fieldset>

      <div className="pick__grid">
        {DIFFICULTY_ORDER.map((d) => {
          const p = DIFFICULTIES[d];
          return (
            <article
              key={d}
              className={`ticket pick__card ${settings.difficulty === d ? 'pick__card--last' : ''}`}
            >
              <h2>{p.label}</h2>
              <p>{p.blurb}</p>
              <ul className="pick__facts">
                <li>
                  Your cards: <span className="mono">{p.playerCards}</span>
                </li>
                <li>
                  Informed traders: <span className="mono">{Math.round(p.alpha * 100)}%</span>
                </li>
                <li>
                  Market maker:{' '}
                  <span>
                    {p.mmKind === 'naive' ? 'naive' : p.mmKind === 'analytical' ? 'analytical' : 'learned'}
                  </span>
                </li>
              </ul>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => begin(d)}
                data-testid={`start-${d}`}
              >
                Play {p.label}
              </button>
            </article>
          );
        })}
      </div>
      <p className="muted pick__more">
        New here? Start with the <a href={href('/tutorial')}>tutorial</a>. Want a ranked game? Try the{' '}
        <a href={href('/daily')}>daily challenge</a>.
      </p>
    </main>
  );
}
