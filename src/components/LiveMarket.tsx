import { useEffect, useRef, useState } from 'react';
import { AnalyticalMM, analyticalSettings } from '../agents/mmAnalytical';
import { cardLabel } from '../engine/cards';
import { Game } from '../engine/game';
import { randomSeed } from '../engine/rng';
import { makeConfig } from '../engine/rules';
import type { ActionEvent, PublicView, SettledView } from '../engine/types';
import { fmt } from '../explain/render';
import { PlayingCard } from './PlayingCard';

function newGame(): Game {
  const config = makeConfig('medium', randomSeed(), { mm: { particles: 1500 } });
  return new Game(config, new AnalyticalMM(analyticalSettings(config)));
}

interface Snapshot {
  view: PublicView;
  settled: SettledView | null;
  mids: number[];
}

function snapshot(g: Game, mids: number[]): Snapshot {
  const view = g.publicView();
  const q = view.quote;
  const mid = q.bid !== null && q.ask !== null ? (q.bid + q.ask) / 2 : null;
  return {
    view,
    settled: g.phase === 'settled' ? g.settledView() : null,
    mids: mid === null ? mids : [...mids, mid].slice(-40),
  };
}

/** The home-page hero: a market maker quoting against bots, one step at a time. Nobody here sees a hidden card. */
export function LiveMarket() {
  const gameRef = useRef<Game | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [paused, setPaused] = useState(false);
  const reduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    gameRef.current = newGame();
    setSnap(snapshot(gameRef.current, []));
  }, []);

  const midsRef = useRef<number[]>([]);
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(
      () => {
        let g = gameRef.current;
        if (!g) return;
        if (g.phase === 'settled') {
          g = gameRef.current = newGame();
          midsRef.current = [];
        } else {
          g.act({ side: 'pass', size: 0 });
        }
        const next = snapshot(g, midsRef.current);
        midsRef.current = next.mids;
        setSnap(next);
      },
      reduced ? 4000 : 1400,
    );
    return () => window.clearInterval(id);
  }, [paused, reduced]);

  if (!snap) return <div className="live ticket" aria-hidden="true" />;
  const { view, settled, mids } = snap;
  const q = view.quote;
  const trades = view.events
    .filter((e): e is ActionEvent => e.kind === 'action' && e.taker === 'bot')
    .slice(-5)
    .reverse();
  const revealed = new Map(view.revealed.map((r) => [r.position, r.card]));
  const lo = Math.min(...mids, 30);
  const hi = Math.max(...mids, 40);
  const path = mids
    .map((m, i) => `${i ? 'L' : 'M'}${(i / 39) * 300},${60 - ((m - lo) / (hi - lo || 1)) * 56 - 2}`)
    .join(' ');

  return (
    <div
      className="live ticket ticket--perf"
      aria-label="A live market: the market maker quoting against computer traders"
    >
      <div className="live__head">
        <span className="stamp live__stamp">
          <span className="live__dot" aria-hidden="true" /> Live market · round {view.round}, step {view.step}
        </span>
        <button
          type="button"
          className="btn btn--small btn--ghost"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
      <div className="live__cards" aria-label="The five cards">
        {[0, 1, 2, 3, 4].map((p) =>
          settled ? (
            <PlayingCard key={p} card={settled.settlement.cards[p]} role="public" size="sm" />
          ) : revealed.has(p) ? (
            <PlayingCard key={p} card={revealed.get(p)} role="public" size="sm" />
          ) : (
            <PlayingCard key={p} role="hidden" size="sm" />
          ),
        )}
        <span className="live__value">
          {settled ? (
            <>
              V = <span className="mono">{settled.settlement.value}</span>
            </>
          ) : (
            'V = ?'
          )}
        </span>
      </div>
      <div className="live__board" aria-live="off">
        <div className="live__side live__side--bid">
          <span>BID ▼</span>
          <strong key={`b${q.bid}`} className="mono flash">
            {fmt(q.bid)}
          </strong>
        </div>
        <svg className="live__spark" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true">
          <path d={path} />
        </svg>
        <div className="live__side live__side--ask">
          <span>▲ ASK</span>
          <strong key={`a${q.ask}`} className="mono flash">
            {fmt(q.ask)}
          </strong>
        </div>
      </div>
      <ol className="live__tape" aria-hidden="true">
        {trades.map((e) => (
          <li key={e.seq} className={`live__trade live__trade--${e.side}`}>
            <span className="mono">
              {e.round}·{e.step}
            </span>{' '}
            {e.side === 'pass'
              ? 'pass'
              : `${e.side === 'buy' ? '▲ bought' : '▼ sold'} ${e.size} @ ${fmt(e.price)}`}
          </li>
        ))}
        {view.revealed.length > 0 && (
          <li className="live__trade live__trade--reveal">
            Last reveal: {cardLabel(view.revealed[view.revealed.length - 1].card)}
          </li>
        )}
      </ol>
    </div>
  );
}
