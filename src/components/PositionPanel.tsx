import { quoteMid } from '../engine/events';
import { PLAYER_POSITION_LIMIT } from '../engine/rules';
import type { PlayerView, SettledView } from '../engine/types';
import { fmt, signed } from '../explain/render';

interface Props {
  view: PlayerView;
  /** Your estimate of V, when the Advisor is available; otherwise positions are marked at the mid. */
  estimate: number | null;
  settled?: SettledView | null;
}

export function PositionPanel({ view, estimate, settled }: Props) {
  const p = view.player;
  const mid = quoteMid(view.quote);
  const mark = settled ? settled.settlement.value : (estimate ?? mid);
  const markLabel = settled ? 'final value V' : estimate !== null ? 'your estimate' : 'the mid price';
  const pnl = mark === null ? null : p.cash + p.position * mark;
  return (
    <section className="position ticket" aria-labelledby="pos-title">
      <h2 className="stamp" id="pos-title">
        Your position
      </h2>
      <dl className="position__grid">
        <div>
          <dt>Position</dt>
          <dd className="num">
            {p.position > 0 ? '+' : ''}
            {p.position}
            <span className="muted"> / ±{PLAYER_POSITION_LIMIT}</span>
          </dd>
        </div>
        <div>
          <dt>Avg price</dt>
          <dd className="num">{fmt(p.avgPrice)}</dd>
        </div>
        <div>
          <dt>Cash</dt>
          <dd className="num">{fmt(p.cash)}</dd>
        </div>
        <div>
          <dt>{settled ? 'Final P&L' : 'P&L'}</dt>
          <dd className={`num ${pnl !== null && pnl > 0 ? 'pos' : pnl !== null && pnl < 0 ? 'neg' : ''}`}>
            {pnl === null ? '—' : signed(pnl)}
          </dd>
        </div>
      </dl>
      <p className="position__note muted">
        {settled ? 'Settled' : 'Marked'} at {markLabel}
        {mark !== null ? (
          <>
            {' '}
            (<span className="mono">{fmt(mark)}</span>)
          </>
        ) : null}
        .
      </p>
    </section>
  );
}
