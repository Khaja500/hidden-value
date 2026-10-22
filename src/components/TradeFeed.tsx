import { cardLabel } from '../engine/cards';
import type { PublicEvent } from '../engine/types';
import { fmt } from '../explain/render';

interface Props {
  events: readonly PublicEvent[];
  limit?: number;
  /** Multiplayer: player names by seat (player trades are labelled with the name instead of "You"). */
  names?: readonly string[];
  /** Multiplayer: who holds a card position, so a revealed player's card is labelled. */
  cardOwner?: (position: number) => string | null;
  /** Events with seq at or after this are marked as new (e.g. since the current player's last turn). */
  newFrom?: number;
}

/** Newest first: bot trades (type hidden), your trades, passes and reveals. Quotes are on the board instead. */
export function TradeFeed({ events, limit = 40, names, cardOwner, newFrom }: Props) {
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
            const fresh = newFrom !== undefined && e.seq >= newFrom ? 'feed__item--new' : '';
            if (e.kind === 'reveal') {
              const owner = cardOwner?.(e.position);
              return (
                <li key={e.seq} className={`feed__item feed__item--reveal ${fresh}`}>
                  <span className="feed__when mono">R{e.round}</span>
                  <span>
                    Round {e.round} starts: <strong>{cardLabel(e.card)}</strong> revealed
                    {owner ? ` (${owner}’s card)` : ''}
                  </span>
                </li>
              );
            }
            if (e.kind !== 'action') return null;
            const you = e.taker === 'player';
            const cls = `feed__item feed__item--${e.side} ${you ? 'feed__item--you' : ''} ${fresh}`;
            const who = you ? (names && e.seat !== undefined ? names[e.seat] : 'You') : 'A trader';
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
