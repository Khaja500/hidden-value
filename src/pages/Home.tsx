import { useEffect } from 'react';
import { useJson } from '../components/chartUtils';
import { LiveMarket } from '../components/LiveMarket';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../engine/rules';
import type { Difficulty } from '../engine/types';
import { fmt, signed } from '../explain/render';
import { href } from '../router';

interface AdvisorFile {
  rows: { difficulty: Difficulty; meanPnl: number; ci95: number }[];
}
interface AlphaFile {
  rows: { mm: string; alpha: number; pnl: { mean: number }; spread: number }[];
}
interface FaithFile {
  counterfactual: { checked: number; matched: number };
}

function Highlights() {
  const adv = useJson<AdvisorFile>('research/advisor.json');
  const alpha = useJson<AlphaFile>('research/alpha-sweep.json');
  const faith = useJson<FaithFile>('research/faithfulness.json');
  if (adv.state !== 'ok' || alpha.state !== 'ok' || faith.state !== 'ok') return null;
  const med = adv.data.rows.find((r) => r.difficulty === 'medium');
  const top = Math.max(...alpha.data.rows.map((r) => r.alpha));
  const at = (mm: string) => alpha.data.rows.find((r) => r.mm === mm && r.alpha === top);
  const naive = at('naive');
  const analytical = at('analytical');
  const cf = faith.data.counterfactual;
  return (
    <section className="home__research" aria-labelledby="hl-title">
      <h2 id="hl-title">From the research</h2>
      <div className="home__facts">
        {med && (
          <p className="ticket">
            <strong className="home__big">{signed(med.meanPnl)}</strong>
            per game for a bot that simply follows the Advisor at Medium (95% CI ±{fmt(med.ci95)}), on deals
            it was never tuned on.
          </p>
        )}
        {naive && analytical && (
          <p className="ticket">
            <strong className="home__big">
              {signed(naive.pnl.mean)} vs {signed(analytical.pnl.mean)}
            </strong>
            naive vs analytical market maker when {Math.round(top * 100)}% of traders are informed: protecting
            the spread is the difference between losing and earning.
          </p>
        )}
        <p className="ticket">
          <strong className="home__big">
            {cf.matched.toLocaleString()} / {cf.checked.toLocaleString()}
          </strong>
          “what if” quotes in the market maker’s explanations matched a real replay exactly.
        </p>
      </div>
      <p>
        <a href={href('/research')}>See every chart and how it was measured →</a>
      </p>
    </section>
  );
}

export function Home() {
  useEffect(() => {
    document.title = 'Hidden Value: an explainable market-making card game';
  }, []);
  return (
    <main id="main" className="page home">
      <section className="hero">
        <div className="hero__text">
          <p className="stamp">A trading game you can see inside</p>
          <h1>Five hidden cards. One price. Can you beat the market maker?</h1>
          <p className="lede">
            The asset is worth the sum of five face-down cards. An AI market maker quotes a bid and an ask.
            You see a card it doesn’t, and an Advisor explains, with numbers, when to buy, sell or hold.
          </p>
          <div className="row hero__cta">
            <a className="btn btn--primary btn--big" href={href('/play')} data-testid="home-play">
              Play
            </a>
            <a className="btn" href={href('/tutorial')}>
              Learn in 3 minutes
            </a>
            <a className="btn btn--ghost" href={href('/daily')}>
              Today’s challenge
            </a>
          </div>
        </div>
        <LiveMarket />
      </section>

      <section className="home__how" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <div className="home__steps">
          <article className="ticket">
            <p className="home__num mono">01</p>
            <h3>The asset</h3>
            <p>
              Five cards, Ace = 1 to King = 13. V is their sum: 35 on average. One card turns face up at the
              start of each of rounds 2, 3 and 4. At the end, all five are shown and every position is paid
              out at V.
            </p>
          </article>
          <article className="ticket">
            <p className="home__num mono">02</p>
            <h3>The market maker</h3>
            <p>
              It always shows a bid (it buys, you sell ▼) and an ask (it sells, you buy ▲). Each quote is
              built from named parts: its fair value from a particle filter, a spread against informed
              traders, and a skew for its inventory. After each game the Review opens up every one of them.
            </p>
          </article>
          <article className="ticket">
            <p className="home__num mono">03</p>
            <h3>You, and the Advisor</h3>
            <p>
              You see one card it doesn’t. The Advisor, using only what you can see, says whether buying at
              the ask or selling at the bid has an edge, how big, and why. Follow it, or try to beat it: the
              skill score tells you which you did.
            </p>
          </article>
        </div>
      </section>

      <section className="home__levels" aria-labelledby="levels-title">
        <h2 id="levels-title">Four tables</h2>
        <ul className="home__level-list">
          {DIFFICULTY_ORDER.map((d) => (
            <li key={d} className="ticket">
              <strong>{DIFFICULTIES[d].label}</strong>
              <span>{DIFFICULTIES[d].blurb}</span>
            </li>
          ))}
        </ul>
      </section>

      <Highlights />
    </main>
  );
}
