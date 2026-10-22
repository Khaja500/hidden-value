import { cardLabel } from '../engine/cards';
import type { PublicEvent } from '../engine/types';
import { fmt } from '../explain/render';

interface Props {
  events: readonly PublicEvent[];
  limit?: number;
}

/** Newest first: bot trades (type hidden), your trades, passes and reveals. Quotes are on the board instead. */
export function TradeFeed({ events, limit = 40 }: Props) {
  const items = events
    .filter((e) => e.kind !== 'quote')
    .slice(-limit)
    .reverse();
  return (
    <section className="feed ticket" aria-labelledby="feed-title">
      <h2 className="stamp" id="feed-title">
        Trade feed
      </h2>
      {items.length === 0 ? (
        <p className="empty">Trades appear here as traders arrive.</p>
      ) : (
        <ol className="feed__list" aria-live="polite">
          {items.map((e) => {
            if (e.kind === 'reveal') {
              return (
                <li key={e.seq} className="feed__item feed__item--reveal">
                  <span className="feed__when mono">R{e.round}</span>
                  <span>
                    Round {e.round} starts: <strong>{cardLabel(e.card)}</strong> revealed
                  </span>
                </li>
              );
            }
            if (e.kind !== 'action') return null;
            const you = e.taker === 'player';
            const cls = `feed__item feed__item--${e.side} ${you ? 'feed__item--you' : ''}`;
            const who = you ? 'You' : 'A trader';
            return (
              <li key={e.seq} className={cls}>
                <span className="feed__when mono">
                  {e.round}·{e.step}
                </span>
                <span className="feed__icon" aria-hidden="true">
                  {e.side === 'buy' ? '▲' : e.side === 'sell' ? '▼' : '·'}
                </span>
                <span className="feed__text">
                  {e.side === 'pass' ? (
                    `${who} passed`
                  ) : (
                    <>
                      {who} {e.side === 'buy' ? 'bought' : 'sold'} <span className="mono">{e.size}</span> at{' '}
                      <span className="mono">{fmt(e.price)}</span>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
