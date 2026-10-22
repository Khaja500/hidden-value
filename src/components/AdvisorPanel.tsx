import type { Advice } from '../agents/advisor';
import type { PlayerView } from '../engine/types';
import { renderAdvice } from '../explain/render';
import type { Belief } from '../store/gameStore';
import { BeliefHistogram } from './BeliefHistogram';

interface Props {
  view: PlayerView;
  belief: Belief | null;
  advice: Advice | null;
  onAsk?: () => void;
  hintsUsed?: number;
  /** Tutorial: advice is always shown and asking is not needed. */
  alwaysOn?: boolean;
  disabled?: boolean;
}

export function AdviceCard({
  advice,
  privateCards,
}: {
  advice: Advice;
  privateCards: readonly { card: number }[];
}) {
  const r = renderAdvice(advice, privateCards);
  const tone = advice.action === 'buy' ? 'buy' : advice.action === 'sell' ? 'sell' : 'hold';
  return (
    <div className={`advice advice--${tone}`} data-testid="advice">
      <p className="advice__headline">{r.headline}</p>
      <p className="advice__estimate mono">{r.estimate}</p>
      {r.edge && <p className="advice__edge">{r.edge}</p>}
      <p className="advice__why-title">Why</p>
      <ul className="advice__why">
        {r.why.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      {r.risk && <p className="advice__risk">{r.risk}</p>}
      {r.position && <p className="advice__position mono">{r.position}</p>}
      {r.warning && (
        <p className="advice__warning" role="note">
          ⚠ {r.warning}
        </p>
      )}
    </div>
  );
}

export function AdvisorPanel({ view, belief, advice, onAsk, hintsUsed = 0, alwaysOn, disabled }: Props) {
  return (
    <section className="advisor ticket" aria-labelledby="advisor-title">
      <h2 className="stamp" id="advisor-title">
        Advisor
      </h2>
      {advice ? (
        <AdviceCard advice={advice} privateCards={view.privateCards} />
      ) : view.phase === 'settled' ? (
        <p className="muted">
          Game over. The Review shows what the Advisor recommended at every step, and how each of your trades
          turned out.
        </p>
      ) : (
        <div className="advisor__ask">
          <p className="muted">
            The Advisor uses only what you can see (your card, the reveals and the trade feed) to say whether
            to buy, sell or hold, and why.
          </p>
          {!alwaysOn && onAsk && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={(e) => {
                onAsk();
                if (e.detail > 0) e.currentTarget.blur();
              }}
              disabled={disabled}
            >
              Ask the Advisor <kbd aria-hidden="true">A</kbd>
            </button>
          )}
          {hintsUsed > 0 && (
            <p className="advisor__hints muted">
              Hints used this game: <span className="mono">{hintsUsed}</span>
            </p>
          )}
        </div>
      )}
      {belief && (
        <div className="advisor__belief">
          <h3 className="stamp">Your belief about V</h3>
          <BeliefHistogram
            distribution={belief.distribution}
            mean={belief.mean}
            sd={belief.sd}
            bid={view.quote.bid}
            ask={view.quote.ask}
          />
        </div>
      )}
    </section>
  );
}
