import { useEffect, useMemo, useState } from 'react';
import { AdviceCard } from '../components/AdvisorPanel';
import { PlayingCard } from '../components/PlayingCard';
import { Timeline } from '../components/Timeline';
import { cardLabel } from '../engine/cards';
import { seedToString } from '../engine/rng';
import { DIFFICULTIES } from '../engine/rules';
import type { QuoteExplanation } from '../engine/types';
import { composeAsk, composeBid } from '../explain/quoteExplanation';
import { fmt, signed } from '../explain/render';
import type { ReviewData, ReviewStep } from '../explain/review';
import { href } from '../router';
import { findLog, loadLogs, type GameLog } from '../store/gameStore';
import { callWorker } from '../workers/client';

export function Review({ gameId }: { gameId?: string }) {
  useEffect(() => {
    document.title = 'Review · Hidden Value';
  }, []);
  if (!gameId) return <ReviewList />;
  return <ReviewGame key={gameId} gameId={gameId} />;
}

function ReviewList() {
  const logs = loadLogs();
  return (
    <main id="main" className="page page--narrow">
      <h1>Your recent games</h1>
      <p className="lede">
        This browser keeps your last 20 games. Open one to see the market maker’s reasoning step by step.
      </p>
      {logs.length === 0 ? (
        <p className="empty">
          No games yet. <a href={href('/play')}>Play a game</a> and its review will appear here.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Table</th>
                <th className="num">V</th>
                <th className="num">Your P&amp;L</th>
                <th className="num">Skill</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {logs.map((g) => (
                <tr key={g.id}>
                  <td>{new Date(g.createdAt).toLocaleString()}</td>
                  <td>
                    {DIFFICULTIES[g.difficulty].label} · {g.mode}
                  </td>
                  <td className="num">{g.result.value}</td>
                  <td className="num">{signed(g.result.pnl)}</td>
                  <td className="num">{g.skill === null ? '—' : signed(g.skill)}</td>
                  <td>
                    <a href={href(`/review/${g.id}`)}>Review</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function ReviewGame({ gameId }: { gameId: string }) {
  const log = useMemo(() => findLog(gameId), [gameId]);
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!log) return;
    let live = true;
    callWorker<ReviewData>('review', { config: log.config, actions: log.actions }, (d, t) => {
      if (live) setProgress(d / t);
    })
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [log]);

  if (!log) {
    return (
      <main id="main" className="page page--narrow">
        <h1>Game not found</h1>
        <p className="empty">
          This game is not in this browser’s history (it keeps the last 20 games).{' '}
          <a href={href('/review')}>See your recent games</a>.
        </p>
      </main>
    );
  }
  if (error) {
    return (
      <main id="main" className="page page--narrow">
        <h1>Review</h1>
        <p className="empty">The review could not be built: {error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main id="main" className="page page--narrow">
        <h1>Review</h1>
        <p className="muted" role="status">
          Replaying your game and explaining every quote… {Math.round(progress * 100)}%
        </p>
        <div className="progress" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      </main>
    );
  }
  return <ReviewBody log={log} data={data} current={current} setCurrent={setCurrent} />;
}

function ReviewBody({
  log,
  data,
  current,
  setCurrent,
}: {
  log: GameLog;
  data: ReviewData;
  current: number;
  setCurrent: (i: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const o = data.outcome;
  const step = data.steps[current];
  const privateCards = o.privatePositions.map((p) => ({ position: p, card: o.cards[p] }));
  const share = () => {
    const url = `${window.location.origin}${window.location.pathname}#/play?seed=${seedToString(log.config.seed)}&d=${log.difficulty}`;
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this link', url));
    } else window.prompt('Copy this link', url);
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ log, review: data }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hidden-value-${log.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const pnl = o.pnl.player;

  return (
    <main id="main" className="page review">
      <header className="review__head">
        <div>
          <p className="stamp">
            Review · {DIFFICULTIES[log.difficulty].label} · {log.mode}
          </p>
          <h1>
            {pnl > 0 ? 'You made ' : pnl < 0 ? 'You lost ' : 'You broke even '}
            <span className={pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : ''}>
              {pnl === 0 ? '' : fmt(Math.abs(pnl))}
            </span>
          </h1>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={share}>
            {copied ? 'Link copied' : 'Share this deal'}
          </button>
          <button type="button" className="btn" onClick={exportJson}>
            Download game log (JSON)
          </button>
          <a className="btn btn--primary" href={href('/play')}>
            Play again
          </a>
        </div>
      </header>

      <section className="ticket review__outcome" aria-labelledby="outcome-title">
        <h2 className="stamp" id="outcome-title">
          Outcome
        </h2>
        <div className="review__outcome-grid">
          <div className="cards__row">
            {o.cards.map((c, p) => (
              <PlayingCard
                key={p}
                card={c}
                role={o.privatePositions.includes(p) ? 'private' : 'public'}
                caption={o.privatePositions.includes(p) ? 'Yours' : ''}
                size="sm"
              />
            ))}
          </div>
          <dl className="settle__grid">
            <div>
              <dt>True value V</dt>
              <dd className="num">{o.value}</dd>
            </div>
            <div>
              <dt>Your P&amp;L</dt>
              <dd className="num">{signed(pnl)}</dd>
            </div>
            <div>
              <dt>Skill score</dt>
              <dd className="num">{log.skill === null ? '—' : signed(log.skill)}</dd>
            </div>
            <div>
              <dt>Market maker P&amp;L</dt>
              <dd className="num">{signed(o.pnl.mm)}</dd>
            </div>
            <div>
              <dt>Followed the Advisor</dt>
              <dd className="num">
                {data.followRate === null ? '—' : `${Math.round(data.followRate * 100)}%`}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="ticket" aria-labelledby="timeline-title">
        <h2 className="stamp" id="timeline-title">
          Timeline
        </h2>
        <Timeline steps={data.steps} value={o.value} current={current} onSelect={setCurrent} />
      </section>

      {step && <StepDetail step={step} privateCards={privateCards} />}

      <div className="review__cols">
        <section className="ticket" aria-labelledby="trades-title">
          <h2 className="stamp" id="trades-title">
            Your trades, graded
          </h2>
          {data.trades.length === 0 ? (
            <p className="empty">You did not trade in this game.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Trade</th>
                    <th>Advisor</th>
                    <th className="num">Expected</th>
                    <th className="num">Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trades.map((t) => (
                    <tr key={t.index}>
                      <td>
                        <button type="button" className="linkish" onClick={() => setCurrent(t.index)}>
                          R{t.round}·S{t.step}
                        </button>
                      </td>
                      <td>
                        {t.side === 'buy' ? '▲ Bought' : '▼ Sold'} {t.size} at{' '}
                        <span className="mono">{fmt(t.price)}</span>
                      </td>
                      <td>{t.followed ? 'followed' : `ignored (${t.advised})`}</td>
                      <td className={`num ${t.expectedTotal >= 0 ? 'pos' : 'neg'}`}>
                        {signed(t.expectedTotal)}
                      </td>
                      <td className={`num ${t.realized >= 0 ? 'pos' : 'neg'}`}>{signed(t.realized)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted review__note">
            “Expected” uses only what you knew at the time (the Advisor’s estimate); “actual” uses the true
            value.
          </p>
        </section>

        <section className="ticket" aria-labelledby="moments-title">
          <h2 className="stamp" id="moments-title">
            Key moments
          </h2>
          <h3 className="review__sub">Biggest missed opportunities</h3>
          {data.missed.length === 0 ? (
            <p className="muted">None: you never passed on a trade the Advisor recommended.</p>
          ) : (
            <MomentList items={data.missed} onSelect={setCurrent} />
          )}
          <h3 className="review__sub">Worst trades (by expected edge at the time)</h3>
          {data.worst.length === 0 ? (
            <p className="muted">No trades.</p>
          ) : (
            <MomentList items={data.worst} onSelect={setCurrent} />
          )}
        </section>
      </div>

      <section className="ticket review__lessons" aria-labelledby="lessons-title">
        <h2 className="stamp" id="lessons-title">
          Lessons
        </h2>
        <ul>
          {data.lessons.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function MomentList({ items, onSelect }: { items: ReviewData['missed']; onSelect: (i: number) => void }) {
  return (
    <ol className="moments">
      {items.map((m) => (
        <li key={m.index}>
          <button type="button" className="linkish" onClick={() => onSelect(m.index)}>
            R{m.round}·S{m.step}
          </button>{' '}
          {m.text}
        </li>
      ))}
    </ol>
  );
}

function botText(step: ReviewStep): string {
  const b = step.bot;
  const who =
    b.type === 'informed'
      ? `An informed trader who knew ${b.knew.map(cardLabel).join(' and ')}`
      : 'A noise trader';
  if (b.side === 'pass') return `${who} passed.`;
  return `${who} ${b.side === 'buy' ? 'bought' : 'sold'} ${b.size} at ${fmt(b.price)}.`;
}

function StepDetail({ step, privateCards }: { step: ReviewStep; privateCards: { card: number }[] }) {
  const e = step.explanation;
  const did =
    step.action.side === 'pass'
      ? 'You passed.'
      : `You ${step.action.side === 'buy' ? 'bought' : 'sold'} ${step.action.size} at ${fmt(step.action.side === 'buy' ? step.quote.ask : step.quote.bid)}.`;
  return (
    <section className="review__step" aria-live="polite">
      <div className="ticket">
        <h2 className="stamp">
          Round {step.round}, step {step.step}: the market maker’s brain
        </h2>
        {step.reveal !== null && (
          <p className="callout">
            Round {step.round} opened with <strong>{cardLabel(step.reveal)}</strong> revealed.
          </p>
        )}
        <p className="review__bot">{botText(step)} Then it quoted:</p>
        <p className="review__quote-head mono">{step.explanationText.headline}</p>
        <ul className="review__bullets">
          {step.explanationText.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <Components e={e} />
        {step.explanationText.counterfactuals.length > 0 && (
          <>
            <h3 className="review__sub">What would have changed the quote</h3>
            <ul className="review__bullets">
              {step.explanationText.counterfactuals.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        )}
        {e.learned && (
          <p className="muted review__note">
            The learned market maker is shown through a linear model distilled from its policy; the distilled
            model matches the policy with fidelity R² = {e.learned.fidelity.toFixed(2)}.
          </p>
        )}
      </div>
      <div className="ticket">
        <h2 className="stamp">What the Advisor said, and what you did</h2>
        <AdviceCard advice={step.advice} privateCards={privateCards} />
        <p className="review__did">
          <strong>{did}</strong> {step.followed ? '(Same as the Advisor.)' : '(Different from the Advisor.)'}
        </p>
        {step.verdict && <p className="muted">{step.verdict}</p>}
        {step.realized !== null && (
          <p>
            At settlement this trade made{' '}
            <strong className={step.realized >= 0 ? 'pos' : 'neg'}>{signed(step.realized)}</strong>.
          </p>
        )}
      </div>
    </section>
  );
}

function Components({ e }: { e: QuoteExplanation }) {
  const rows: [string, number, number][] = [['Fair value μ', e.fairValue, e.fairValue]];
  if (e.mmKind === 'analytical') {
    rows.push([
      'Adverse selection (Glosten–Milgrom)',
      e.adverseSelection.bidOffset,
      e.adverseSelection.askOffset,
    ]);
  }
  if (e.mmKind === 'learned') rows.push(['Learned center offset', e.learnedOffset, e.learnedOffset]);
  if (e.mmKind === 'analytical') rows.push(['Inventory skew', e.inventory.skew, e.inventory.skew]);
  if (e.mmKind === 'analytical') rows.push(['Risk half-spread', -e.riskHalfSpread, e.riskHalfSpread]);
  if (e.fixedHalfSpread) {
    rows.push([
      e.mmKind === 'naive' ? 'Fixed half-spread' : 'Learned half-spread',
      -e.fixedHalfSpread,
      e.fixedHalfSpread,
    ]);
  }
  rows.push(['Rounding to the 0.5 tick', e.rounding.bid, e.rounding.ask]);
  return (
    <div className="table-wrap">
      <table className="data components">
        <caption className="sr-only">How the bid and ask are built</caption>
        <thead>
          <tr>
            <th>Component</th>
            <th className="num">Bid</th>
            <th className="num">Ask</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, b, a], i) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="num">{e.bid === null ? '—' : i === 0 ? fmt(b, 2) : signed(b, 2)}</td>
              <td className="num">{e.ask === null ? '—' : i === 0 ? fmt(a, 2) : signed(a, 2)}</td>
            </tr>
          ))}
          <tr className="components__total">
            <td>Posted quote</td>
            <td className="num">{e.bid === null ? '—' : fmt(composeBid(e), 1)}</td>
            <td className="num">{e.ask === null ? '—' : fmt(composeAsk(e), 1)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
