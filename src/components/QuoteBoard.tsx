import { useState, type MouseEvent } from 'react';
import { quoteSpread } from '../engine/events';
import { PLAYER_POSITION_LIMIT } from '../engine/rules';
import type { PlayerAction, PlayerView } from '../engine/types';
import { fmt } from '../explain/render';

interface Props {
  view: PlayerView;
  size: number;
  onSize: (n: number) => void;
  onAct: (a: PlayerAction) => void;
  disabled?: boolean;
}

/** The value from the previous render where it was a different object (derived-state pattern). */
function usePrevious<T>(value: T): T | undefined {
  const [s, setS] = useState<{ cur: T; prev: T | undefined }>({ cur: value, prev: undefined });
  if (s.cur !== value) {
    setS({ cur: value, prev: s.cur });
    return s.cur;
  }
  return s.prev;
}

function Move({ now, before }: { now: number | null; before: number | null | undefined }) {
  if (now === null || before === null || before === undefined || now === before) return null;
  return (
    <span className={`qb__move ${now > before ? 'qb__move--up' : 'qb__move--down'}`}>
      {now > before ? '↑' : '↓'} {fmt(Math.abs(now - before))}
      <span className="sr-only"> since the last quote</span>
    </span>
  );
}

/**
 * After a mouse click, drop focus from the button so that Space (the pass shortcut) does not re-trigger it.
 * Keyboard activation (detail === 0) keeps focus, so Tab + Space/Enter behave normally.
 */
function clicked(fn: () => void) {
  return (e: MouseEvent<HTMLButtonElement>) => {
    fn();
    if (e.detail > 0) e.currentTarget.blur();
  };
}

/** The pit board: BID (you sell) on the left, ASK (you buy) on the right, with the order buttons beneath. */
export function QuoteBoard({ view, size, onSize, onAct, disabled }: Props) {
  const q = view.quote;
  const prevQuote = usePrevious(q);
  const prevBid = prevQuote?.bid;
  const prevAsk = prevQuote?.ask;
  const spread = quoteSpread(q);
  const canSell = !disabled && view.maxSell >= size;
  const canBuy = !disabled && view.maxBuy >= size;
  const pos = view.player.position;
  const sellReason =
    q.bid === null
      ? 'The market maker is not bidding (at its limit)'
      : pos - size < -PLAYER_POSITION_LIMIT
        ? `Position limit: you can be short at most ${PLAYER_POSITION_LIMIT}`
        : view.maxSell < size
          ? `Only ${view.maxSell} available`
          : null;
  const buyReason =
    q.ask === null
      ? 'The market maker is not offering (at its limit)'
      : pos + size > PLAYER_POSITION_LIMIT
        ? `Position limit: you can be long at most ${PLAYER_POSITION_LIMIT}`
        : view.maxBuy < size
          ? `Only ${view.maxBuy} available`
          : null;

  return (
    <section className="qb ticket ticket--perf" aria-labelledby="qb-title">
      <h2 className="stamp" id="qb-title">
        Market maker’s quote
      </h2>
      <div className="qb__board" aria-live="polite" aria-atomic="true">
        <div className="qb__side qb__side--bid">
          <span className="qb__label">
            BID <span className="qb__hint">it buys · you sell ▼</span>
          </span>
          <span
            key={`b${q.bid}`}
            className={`qb__price num ${prevBid !== undefined && prevBid !== q.bid ? 'flash' : ''}`}
          >
            {fmt(q.bid)}
          </span>
          <span className="qb__size">
            size <span className="mono">{q.bidSize}</span> <Move now={q.bid} before={prevBid} />
          </span>
        </div>
        <div
          className="qb__spread"
          aria-label={spread === null ? 'One-sided quote' : `Spread ${fmt(spread)}`}
        >
          <span className="qb__spread-label">spread</span>
          <span className="mono">{fmt(spread)}</span>
        </div>
        <div className="qb__side qb__side--ask">
          <span className="qb__label">
            ASK <span className="qb__hint">it sells · you buy ▲</span>
          </span>
          <span
            key={`a${q.ask}`}
            className={`qb__price num ${prevAsk !== undefined && prevAsk !== q.ask ? 'flash' : ''}`}
          >
            {fmt(q.ask)}
          </span>
          <span className="qb__size">
            size <span className="mono">{q.askSize}</span> <Move now={q.ask} before={prevAsk} />
          </span>
        </div>
      </div>

      <div className="qb__controls">
        <div className="qb__sizes" role="group" aria-label="Trade size">
          <span className="qb__sizes-label">Size</span>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              className="seg"
              aria-pressed={size === n}
              onClick={clicked(() => onSize(n))}
              disabled={disabled}
            >
              {n}
              <span className="sr-only"> unit{n > 1 ? 's' : ''}</span>
            </button>
          ))}
        </div>
        <div className="qb__actions">
          <button
            type="button"
            className="order order--sell"
            disabled={!canSell}
            onClick={clicked(() => onAct({ side: 'sell', size }))}
            title={sellReason ?? `Sell ${size} at ${fmt(q.bid)} (S)`}
          >
            <span className="order__icon" aria-hidden="true">
              ▼
            </span>
            <span className="order__text">
              <span className="order__verb">Sell {size}</span>
              <span className="order__at">at bid {fmt(q.bid)}</span>
            </span>
            <kbd aria-hidden="true">S</kbd>
          </button>
          <button
            type="button"
            className="btn qb__pass"
            disabled={disabled}
            onClick={clicked(() => onAct({ side: 'pass', size: 0 }))}
            title="Pass this step (Space)"
          >
            Pass <kbd aria-hidden="true">Space</kbd>
          </button>
          <button
            type="button"
            className="order order--buy"
            disabled={!canBuy}
            onClick={clicked(() => onAct({ side: 'buy', size }))}
            title={buyReason ?? `Buy ${size} at ${fmt(q.ask)} (B)`}
          >
            <span className="order__icon" aria-hidden="true">
              ▲
            </span>
            <span className="order__text">
              <span className="order__verb">Buy {size}</span>
              <span className="order__at">at ask {fmt(q.ask)}</span>
            </span>
            <kbd aria-hidden="true">B</kbd>
          </button>
        </div>
        {!disabled && (sellReason || buyReason) && (
          <p className="qb__reason muted">{[sellReason, buyReason].filter(Boolean).join(' · ')}</p>
        )}
      </div>
    </section>
  );
}
