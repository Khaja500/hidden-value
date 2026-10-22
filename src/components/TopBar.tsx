import { DIFFICULTIES } from '../engine/rules';
import type { PublicView } from '../engine/types';

interface Props {
  view: PublicView;
  modeLabel: string;
  pacingLabel: string;
  secondsLeft?: number | null;
  stepSeconds?: number;
}

export function TopBar({ view, modeLabel, pacingLabel, secondsLeft, stepSeconds }: Props) {
  const { rounds, stepsPerRound } = view.config;
  const settled = view.phase === 'settled';
  return (
    <div className="topbar" role="status">
      <div
        className="topbar__progress"
        aria-label={
          settled ? 'Game over' : `Round ${view.round} of ${rounds}, step ${view.step} of ${stepsPerRound}`
        }
      >
        <span className="topbar__round">
          {settled ? (
            'Settled'
          ) : (
            <>
              Round <span className="mono">{view.round}</span>/<span className="mono">{rounds}</span>
            </>
          )}
        </span>
        <span className="pips" aria-hidden="true">
          {Array.from({ length: rounds * stepsPerRound }, (_, i) => {
            const r = Math.floor(i / stepsPerRound) + 1;
            const s = (i % stepsPerRound) + 1;
            const done = settled || r < view.round || (r === view.round && s < view.step);
            const now = !settled && r === view.round && s === view.step;
            return (
              <span
                key={i}
                className={`pip ${done ? 'pip--done' : ''} ${now ? 'pip--now' : ''} ${s === 1 ? 'pip--round' : ''}`}
              />
            );
          })}
        </span>
        {!settled && (
          <span className="topbar__step">
            Step <span className="mono">{view.step}</span>/<span className="mono">{stepsPerRound}</span>
          </span>
        )}
      </div>
      <div className="topbar__tags">
        <span className="tag">{DIFFICULTIES[view.config.difficulty].label}</span>
        <span className="tag">{modeLabel}</span>
        <span className="tag">{pacingLabel}</span>
        <span className="tag" title="Share of bot traders who are informed">
          α {Math.round(view.config.alpha * 100)}%
        </span>
        {secondsLeft != null && stepSeconds ? (
          <span
            className={`countdown ${secondsLeft <= 3 ? 'countdown--low' : ''}`}
            aria-label={`${secondsLeft} seconds left in this step`}
          >
            <span className="countdown__bar" style={{ width: `${(secondsLeft / stepSeconds) * 100}%` }} />
            <span className="mono">{secondsLeft}s</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
