import { useEffect, useRef, useState } from 'react';
import { AdvisorPanel } from '../components/AdvisorPanel';
import { PlayingCard } from '../components/PlayingCard';
import { PositionPanel } from '../components/PositionPanel';
import { QuoteBoard } from '../components/QuoteBoard';
import { TopBar } from '../components/TopBar';
import { TradeFeed } from '../components/TradeFeed';
import { cardLabel, cardName } from '../engine/cards';
import { MAX_SEATS, MIN_SEATS, type MultiPublicView } from '../engine/multiGame';
import { DIFFICULTIES, DIFFICULTY_ORDER, PLAYER_POSITION_LIMIT } from '../engine/rules';
import type { Difficulty } from '../engine/types';
import { fmt, signed } from '../explain/render';
import { href } from '../router';
import { useParty, type PartyOptions, type PartyResult } from '../store/partyStore';
import { load, save } from '../store/storage';

/** What each table means when several players share it (everyone holds one card). */
const TABLE_BLURB: Record<Difficulty, string> = {
  easy: 'A naive market maker with a fixed spread of 6 around the public-card average.',
  medium: 'An analytical market maker that reads the bots’ order flow but ignores yours.',
  hard: 'An analytical market maker that also learns from every player’s trades.',
  expert: 'A market maker trained by simulation instead of designed by hand.',
};

interface SavedSetup {
  count: number;
  names: string[];
  difficulty: Difficulty;
  advisorOn: boolean;
}

const DEFAULT_SETUP: SavedSetup = {
  count: 2,
  names: ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
  difficulty: 'medium',
  advisorOn: true,
};

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  );
}

function cleanNames(names: string[], count: number): string[] {
  const out = names.slice(0, count).map((n, i) => n.trim().slice(0, 16) || `Player ${i + 1}`);
  // Duplicate names would make the feed ambiguous: number the repeats.
  return out.map((n, i) => (out.indexOf(n) === i ? n : `${n} (${i + 1})`));
}

export function Party() {
  const status = useParty((s) => s.status);
  const quit = useParty((s) => s.quit);
  useEffect(() => {
    document.title = 'Multiplayer · Hidden Value';
  }, []);
  // The table stays up (including the results) until the players choose a new setup.
  if (status !== 'idle') {
    return (
      <main id="main" className="page page--play">
        <PartyGame onSetup={quit} />
      </main>
    );
  }
  return <PartySetup />;
}

// ---- Setup ----------------------------------------------------------------------------------------------------

function PartySetup() {
  const [setup, setSetup] = useState<SavedSetup>(() => ({
    ...DEFAULT_SETUP,
    ...load<Partial<SavedSetup>>('party:setup', {}),
  }));
  const start = useParty((s) => s.start);
  const update = (patch: Partial<SavedSetup>) => setSetup((s) => ({ ...s, ...patch }));

  const begin = () => {
    const names = cleanNames(setup.names, setup.count);
    save('party:setup', { ...setup, names: [...names, ...setup.names.slice(setup.count)] });
    const o: PartyOptions = { names, difficulty: setup.difficulty, advisorOn: setup.advisorOn };
    start(o);
  };

  return (
    <main id="main" className="page party-setup">
      <header className="pick__head">
        <p className="stamp">Multiplayer · one screen</p>
        <h1>Trade against the market maker, and each other</h1>
        <p className="lede">
          Two to four players share this screen. Each of you holds a different one of the five hidden cards.
          You take turns trading with the same market maker, and the best P&amp;L at settlement wins.
        </p>
        {status === 'playing' && <p className="callout">Starting a new game abandons the one in progress.</p>}
      </header>

      <div className="party-setup__grid">
        <section className="ticket ticket--perf" aria-labelledby="who-title">
          <h2 className="stamp" id="who-title">
            Players
          </h2>
          <div className="seg" role="radiogroup" aria-label="Number of players">
            {Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, i) => MIN_SEATS + i).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={setup.count === n}
                className={`seg__btn ${setup.count === n ? 'seg__btn--on' : ''}`}
                onClick={() => update({ count: n })}
                data-testid={`players-${n}`}
              >
                {n} players
              </button>
            ))}
          </div>
          <ol className="party-setup__names">
            {Array.from({ length: setup.count }, (_, i) => (
              <li key={i}>
                <label>
                  <span className="party-setup__seat mono">P{i + 1}</span>
                  <input
                    type="text"
                    value={setup.names[i] ?? ''}
                    maxLength={16}
                    placeholder={`Player ${i + 1}`}
                    aria-label={`Name of player ${i + 1}`}
                    onChange={(e) => {
                      const names = setup.names.slice();
                      names[i] = e.target.value;
                      update({ names });
                    }}
                  />
                </label>
              </li>
            ))}
          </ol>
          <label className="check">
            <input
              type="checkbox"
              checked={setup.advisorOn}
              onChange={(e) => update({ advisorOn: e.target.checked })}
            />
            <span>
              Allow the Advisor{' '}
              <span className="muted">(each ask counts as a hint and shows in the results)</span>
            </span>
          </label>
        </section>

        <section className="ticket" aria-labelledby="rules-title">
          <h2 className="stamp" id="rules-title">
            How a turn works
          </h2>
          <ol className="party-setup__rules">
            <li>Each step, one computer trader arrives and trades. Then each of you trades once, in turn.</li>
            <li>
              When it is your turn, take the screen and tap <strong>Show my card</strong>. Everyone else looks
              away.
            </li>
            <li>
              Buy at the ask, sell at the bid (1–3 units, up to ±{PLAYER_POSITION_LIMIT}), or pass. Your card
              hides again as soon as you act.
            </li>
            <li>
              Every trade appears in the feed with the player’s name. Reading the others’ trades is part of
              the game; the Advisor reads only the bots.
            </li>
            <li>The first player rotates every step, so nobody always gets the freshest price.</li>
          </ol>
          {setup.count >= 3 && (
            <p className="callout party-setup__warn">
              With {setup.count} players there are not enough unheld cards for all three reveals, so{' '}
              {setup.count === 3 ? 'in round 4 one player’s card' : 'in rounds 3 and 4 two players’ cards'}{' '}
              will be turned face up for everyone. You won’t know whose until it happens.
            </p>
          )}
        </section>
      </div>

      <h2 className="party-setup__tables-title">Choose a table</h2>
      <div className="pick__grid" role="radiogroup" aria-label="Table">
        {DIFFICULTY_ORDER.map((d) => {
          const p = DIFFICULTIES[d];
          const on = setup.difficulty === d;
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={on}
              className={`ticket pick__card party-setup__table ${on ? 'party-setup__table--on' : ''}`}
              onClick={() => update({ difficulty: d })}
              data-testid={`table-${d}`}
            >
              <span className="party-setup__table-name">{p.label}</span>
              <span>{TABLE_BLURB[d]}</span>
              <span className="muted">
                Informed bots: <span className="mono">{Math.round(p.alpha * 100)}%</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="row party-setup__go">
        <button type="button" className="btn btn--primary btn--big" onClick={begin} data-testid="party-start">
          Deal {setup.count} hands at {DIFFICULTIES[setup.difficulty].label}
        </button>
        <span className="muted">
          New to the game? Play the <a href={href('/tutorial')}>tutorial</a> first.
        </span>
      </div>
    </main>
  );
}

// ---- The table ------------------------------------------------------------------------------------------------

function PartyGame({ onSetup }: { onSetup: () => void }) {
  const st = useParty();
  const pub = st.pub!;
  const o = st.options!;
  const settled = st.status === 'settled';
  const seat = pub.turn.seat;

  // Keyboard: Enter/Space shows the next player's card; during a turn B/S/1/2/3/Space/A as in single-player,
  // Escape hides the card again.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const s = useParty.getState();
      if (s.status !== 'playing') return;
      const k = e.key.toLowerCase();
      const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
      if (s.stage === 'handoff') {
        if ((k === 'enter' || k === ' ') && !onButton) {
          e.preventDefault();
          s.showTurn();
        }
        return;
      }
      const v = s.seatView;
      if (!v) return;
      if (k === 'b' && v.maxBuy >= s.size) s.act({ side: 'buy', size: s.size });
      else if (k === 's' && v.maxSell >= s.size) s.act({ side: 'sell', size: s.size });
      else if (k === '1' || k === '2' || k === '3') s.setSize(Number(k));
      else if (k === ' ' && !onButton) {
        e.preventDefault();
        s.act({ side: 'pass', size: 0 });
      } else if (k === 'a') s.askAdvisor();
      else if (k === 'escape') s.hideTurn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Start at the top of the table; afterwards, keep the hand-off or turn panel in view as the stage changes (on
  // phones the panels are stacked, and the order buttons sit lower than the next hand-off).
  const main = useRef<HTMLDivElement>(null);
  const stageKey = `${st.stage}-${pub.events.length}-${st.status}`;
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) el.scrollIntoView({ block: 'start' });
  }, [stageKey]);

  const owner = (position: number) => (position < o.names.length ? o.names[position] : null);
  return (
    <div className="party" data-testid="party">
      <div className="party__top">
        <TopBar view={pub} modeLabel="Multiplayer" pacingLabel={`${o.names.length} players`} />
      </div>
      <div className="party__seats">
        <Seats pub={pub} names={o.names} hints={o.advisorOn ? st.hints : null} />
      </div>
      <div className="party__cards">
        <TableCards pub={pub} names={o.names} result={st.result} />
      </div>
      <div className="party__main" ref={main}>
        {settled && st.result ? (
          <Results result={st.result} names={o.names} onSetup={onSetup} />
        ) : st.stage === 'handoff' || seat === null ? (
          <HandOff pub={pub} name={o.names[seat ?? 0]} />
        ) : (
          <Turn name={o.names[seat]} />
        )}
      </div>
      <div className="party__feed">
        <TradeFeed
          events={pub.events}
          names={o.names}
          cardOwner={owner}
          newFrom={st.stage === 'turn' && seat !== null ? st.lastSeen[seat] : undefined}
          limit={60}
        />
      </div>
    </div>
  );
}

function Seats({ pub, names, hints }: { pub: MultiPublicView; names: string[]; hints: number[] | null }) {
  const { seat: now, order, acted } = pub.turn;
  const settled = pub.phase === 'settled';
  return (
    <section aria-label="Players" className="seats">
      <ol className="seats__list">
        {pub.seats.map((s) => {
          const isNow = !settled && s.seat === now;
          const done = acted.includes(s.seat);
          const pos = order.indexOf(s.seat) - order.indexOf(now ?? order[0]);
          const status = settled
            ? 'Settled'
            : isNow
              ? 'To act'
              : done
                ? 'Acted'
                : pos === 1
                  ? 'Next'
                  : 'Waiting';
          return (
            <li
              key={s.seat}
              className={`seat ticket ${isNow ? 'seat--now' : ''} ${done ? 'seat--done' : ''}`}
              aria-current={isNow ? 'step' : undefined}
              data-testid={`seat-${s.seat}`}
            >
              <span className="seat__name">{names[s.seat]}</span>
              <span className={`seat__status ${isNow ? 'tag tag--brass' : 'tag'}`}>{status}</span>
              <span className="seat__units num" title="Units held (public: the sum of their trades)">
                {s.units > 0 ? '+' : ''}
                {s.units}
                <span className="muted"> units</span>
              </span>
              <span className="seat__meta muted">
                {s.trades} trade{s.trades === 1 ? '' : 's'}
                {hints ? ` · ${hints[s.seat]} hint${hints[s.seat] === 1 ? '' : 's'}` : ''}
                {s.cardRevealed ? ' · card public' : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TableCards({
  pub,
  names,
  result,
}: {
  pub: MultiPublicView;
  names: string[];
  result: PartyResult | null;
}) {
  const revealed = new Map(pub.revealed.map((r) => [r.position, r]));
  return (
    <section className="cards ticket" aria-labelledby="table-cards-title">
      <h2 className="stamp" id="table-cards-title">
        The five cards
      </h2>
      <div className="cards__row">
        {[0, 1, 2, 3, 4].map((p) => {
          const holder = p < names.length ? names[p] : null;
          const r = revealed.get(p);
          const caption = holder
            ? r
              ? `${holder}’s · revealed R${r.round}`
              : `${holder}’s`
            : r
              ? `Revealed R${r.round}`
              : 'Nobody’s';
          if (r) return <PlayingCard key={p} card={r.card} role="public" caption={caption} size="sm" />;
          if (result)
            return (
              <PlayingCard
                key={p}
                card={result.settlement.cards[p]}
                role="settled"
                caption={caption}
                size="sm"
              />
            );
          return <PlayingCard key={p} role="hidden" caption={caption} size="sm" />;
        })}
      </div>
      <p className="cards__note">
        {result ? (
          <>
            Value <strong className="mono">V = {result.settlement.value}</strong>
          </>
        ) : (
          <>Each player holds the card with their name. V is the sum of all five.</>
        )}
      </p>
    </section>
  );
}

function HandOff({ pub, name }: { pub: MultiPublicView; name: string }) {
  const showTurn = useParty((s) => s.showTurn);
  const btn = useRef<HTMLButtonElement>(null);
  const key = `${pub.events.length}`;
  useEffect(() => {
    btn.current?.focus({ preventScroll: true });
  }, [key]);
  return (
    <section className="handoff ticket ticket--perf" aria-live="polite" data-testid="handoff">
      <p className="stamp">
        Round {pub.round} · step {pub.step}
      </p>
      <h2 className="handoff__title">
        Pass the screen to <span className="handoff__name">{name}</span>
      </h2>
      <p className="handoff__note">Everyone else, look away. Your card stays hidden until you tap.</p>
      <button
        ref={btn}
        type="button"
        className="btn btn--primary btn--big"
        onClick={showTurn}
        data-testid="show-turn"
      >
        I’m {name}: show my card <kbd aria-hidden="true">Enter</kbd>
      </button>
      <p className="muted handoff__last">The trade feed shows every trade so far, with names.</p>
    </section>
  );
}

function Turn({ name }: { name: string }) {
  const st = useParty();
  const view = st.seatView!;
  const mine = view.privateCards[0];
  const revealed = view.revealed.some((r) => r.position === mine.position);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section className="turn" aria-labelledby="turn-title" data-testid="turn">
      <div className="turn__head">
        <h2 id="turn-title" ref={heading} tabIndex={-1}>
          {name}’s turn
        </h2>
        <button type="button" className="btn btn--small btn--ghost" onClick={st.hideTurn}>
          Hide my card <kbd aria-hidden="true">Esc</kbd>
        </button>
      </div>
      <div className="turn__grid">
        <div className="turn__left">
          <div className="turn__mine ticket">
            <PlayingCard
              card={mine.card}
              role="private"
              caption={revealed ? 'Yours (now public)' : 'Yours'}
            />
            <p>
              Your card is the <strong>{cardName(mine.card)}</strong>.{' '}
              {revealed
                ? 'It has been revealed, so everyone knows it now.'
                : 'Only you know it. The market maker and the other players do not.'}
            </p>
          </div>
          <QuoteBoard view={view} size={st.size} onSize={st.setSize} onAct={st.act} />
          <PositionPanel view={view} estimate={st.belief?.mean ?? null} />
        </div>
        <div className="turn__right">
          {st.options!.advisorOn ? (
            <AdvisorPanel
              view={view}
              belief={st.belief}
              advice={st.advice}
              onAsk={st.askAdvisor}
              hintsUsed={st.hints[view.seat ?? 0]}
              intro="The Advisor uses your card, the reveals and the bots’ trades. It does not try to read the other players: that part is up to you."
            />
          ) : (
            <section className="advisor ticket">
              <h2 className="stamp">Advisor off</h2>
              <p className="muted">
                This table plays without the Advisor. You have your card ({cardLabel(mine.card)}), the reveals
                and the feed.
              </p>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}

// ---- Results --------------------------------------------------------------------------------------------------

function Results({ result, names, onSetup }: { result: PartyResult; names: string[]; onSetup: () => void }) {
  const rematch = useParty((s) => s.rematch);
  const s = result.settlement;
  const winner = result.standings[0];
  const tied = result.standings.filter((x) => Math.abs(x.pnl - winner.pnl) < 1e-9);
  return (
    <section
      className="results ticket ticket--perf"
      aria-labelledby="results-title"
      data-testid="party-results"
    >
      <p className="stamp">Settlement</p>
      <h2 id="results-title" className="results__title">
        {tied.length > 1 ? `A tie between ${tied.map((t) => t.name).join(' and ')}` : `${winner.name} wins`}
        <span className="results__v">
          {' '}
          · V = <span className="mono">{s.value}</span>
        </span>
      </h2>
      <div className="table-wrap">
        <table className="data results__table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Player</th>
              <th scope="col">Card</th>
              <th scope="col" className="num">
                P&amp;L
              </th>
              <th
                scope="col"
                className="num"
                title="Sum of each trade's expected profit, from the player's own estimate when they traded"
              >
                Expected
              </th>
              <th scope="col" className="num" title="P&L minus expected: what the cards did">
                Luck
              </th>
              <th scope="col" className="num">
                Trades
              </th>
              <th scope="col" className="num">
                Hints
              </th>
            </tr>
          </thead>
          <tbody>
            {result.standings.map((p, i) => (
              <tr key={p.seat} className={i === 0 ? 'results__first' : ''} data-testid={`standing-${i}`}>
                <td className="mono">{i + 1}</td>
                <th scope="row">{p.name}</th>
                <td className="mono">{cardLabel(p.card)}</td>
                <td className={`num ${p.pnl > 0 ? 'pos' : p.pnl < 0 ? 'neg' : ''}`}>{signed(p.pnl)}</td>
                <td className="num">{signed(p.expected)}</td>
                <td className="num">{signed(p.pnl - p.expected)}</td>
                <td className="num">{p.trades}</td>
                <td className="num">{p.hints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted results__note">
        “Expected” adds up each trade’s edge at the moment it was made, using that player’s own estimate
        (their card, the reveals and the bots’ flow). It is the skill part of the score; “luck” is the rest.
        The market maker made {signed(s.pnl.mm)}; noise traders {signed(s.pnl.noise)}; informed traders{' '}
        {signed(s.pnl.informed)}. Everyone’s P&amp;L sums to zero.
      </p>
      {result.trades.length > 0 && (
        <details className="results__trades">
          <summary>Every player trade, graded</summary>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Player</th>
                  <th scope="col">Trade</th>
                  <th scope="col" className="num">
                    Their estimate
                  </th>
                  <th scope="col" className="num">
                    Expected
                  </th>
                  <th scope="col" className="num">
                    Actual
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.trades.map((t, i) => (
                  <tr key={i}>
                    <td className="mono">
                      {t.round}·{t.step}
                    </td>
                    <td>{names[t.seat]}</td>
                    <td>
                      {t.side === 'buy' ? '▲ Bought' : '▼ Sold'} <span className="mono">{t.size}</span> at{' '}
                      <span className="mono">{fmt(t.price)}</span>
                    </td>
                    <td className="num">{fmt(t.estimate)}</td>
                    <td className="num">{signed(t.expected)}</td>
                    <td className={`num ${t.actual > 0 ? 'pos' : t.actual < 0 ? 'neg' : ''}`}>
                      {signed(t.actual)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => rematch()} data-testid="rematch">
          Rematch: new deal
        </button>
        <button type="button" className="btn" onClick={() => rematch(true)}>
          Replay this deal
        </button>
        <button type="button" className="btn btn--ghost" onClick={onSetup}>
          Change players or table
        </button>
      </div>
    </section>
  );
}
