import { useEffect } from 'react';
import { ORIGINAL_SITE_URL, REPO_URL } from '../config';
import { DEFAULT_ADVISOR_PARAMS } from '../agents/advisor';
import { DEFAULT_GAMMA, DEFAULT_RISK_COEF } from '../agents/mmAnalytical';
import { DEFAULT_PARTICLES } from '../belief/particleFilter';
import { NOISE_TOLERANCE_MEAN } from '../engine/rules';
import { href } from '../router';

export function About() {
  useEffect(() => {
    document.title = 'About · Hidden Value';
  }, []);
  const p = DEFAULT_ADVISOR_PARAMS;
  return (
    <main id="main" className="page page--narrow about">
      <p className="stamp">About the project</p>
      <h1>A market maker you can see inside</h1>
      <p className="lede">
        Hidden Value is a small trading game built to make market making explainable. Every price the market
        maker shows can be broken into named parts, every piece of advice comes from numbers you can check,
        and the whole thing runs in your browser with no server.
      </p>

      <section>
        <h2>The game</h2>
        <p>
          Five cards are dealt face down; the asset is worth V, their sum (Ace = 1 … King = 13). Over four
          rounds of eight steps, three of the cards are revealed. At each step one computer trader arrives: a{' '}
          <em>noise</em> trader who trades for reasons unrelated to value, or an <em>informed</em> trader who
          has seen one or two of the cards. Then you may buy at the ask or sell at the bid. You see one card
          the market maker does not (two on Easy). At the end, every position is paid out at V. The player,
          the market maker and the bots always sum to exactly zero.
        </p>
      </section>

      <section>
        <h2>Multiplayer on one screen</h2>
        <p>
          This edition adds a <a href={href('/multiplayer')}>multiplayer</a> table for two to four people
          sharing one device. Each player holds a different card (player 1 the first position, and so on).
          Each step one bot trades, then every player trades once in turn, and the first player rotates every
          step. Between turns a hand-off screen hides everything private until the next player taps to see
          their own card. Reveals use cards nobody holds first, so with three or four players one or two
          players’ cards are turned face up in the late rounds.
        </p>
        <p>
          On the Hard table the market maker reads every player’s trades, each with that player’s own card
          position. Each player’s Advisor reads the bots’ order flow but not the other players’ trades, so
          reading your friends is up to you. At the end, each trade is graded by the edge it had when it was
          made, which separates skill from luck. The original single-player site is still at{' '}
          <a href={ORIGINAL_SITE_URL}>{ORIGINAL_SITE_URL.replace('https://', '')}</a>.
        </p>
      </section>

      <section>
        <h2>Beliefs: a particle filter</h2>
        <p>
          The market maker and the Advisor both keep a belief about the hidden cards with a particle filter of{' '}
          {DEFAULT_PARTICLES.toLocaleString()} candidate deals. Each trade reweights the deals by how likely
          that trade would be if the deal were true: an informed trader buys only if what they know puts V
          above the ask. A lookup table of informed valuations makes an update take well under a millisecond.
          When a card is revealed, deals that disagree are redrawn and reweighted against the whole trade
          history, so the filter never collapses. Over thousands of simulated games its predictions are
          calibrated (see the Research page).
        </p>
      </section>

      <section>
        <h2>The analytical market maker</h2>
        <ol>
          <li>
            <strong>Fair value μ</strong>: the particle filter’s estimate from public cards and order flow.
          </li>
          <li>
            <strong>Adverse-selection spread (Glosten–Milgrom)</strong>: the ask is E[V | the next trader
            buys] and the bid is E[V | they sell]. The more traders are informed, the wider it gets.
          </li>
          <li>
            <strong>Inventory skew and risk spread (Avellaneda–Stoikov style)</strong>: both prices move by
            −γ·q·Var(V) when it holds q units, plus a half-spread of c·γ·Var(V) (γ = {DEFAULT_GAMMA}, c ={' '}
            {DEFAULT_RISK_COEF}) that shrinks as cards are revealed.
          </li>
        </ol>
        <p>
          The parts plus tick rounding add up exactly to the posted quote, and every “what if” it lists (no
          inventory, the last two trades removed) is checked against a real replay. Easy mode uses a naive
          market maker with a fixed spread of 6; Hard mode’s market maker also learns from your trades.
        </p>
      </section>

      <section>
        <h2>The Advisor</h2>
        <p>
          The Advisor’s only input is what you can see. A test changes every card you cannot see in 500 game
          states and checks that its advice is identical. It recommends BUY when your edge (estimate − ask)
          exceeds θ = {p.theta} standard deviations <em>and</em> the chance that V ends above the ask is at
          least {Math.round(p.pMin * 100)}%, sizes the trade by edge ÷ variance, and explains itself by
          recomputing your estimate with your private card, or the order flow, removed. Those settings were
          tuned on separate validation deals; a bot that always follows the Advisor is profitable at Easy,
          Medium and Hard on held-out deals.
        </p>
      </section>

      <section>
        <h2>The learned market maker</h2>
        <p>
          Expert mode’s market maker was not designed: a small neural network (8 public features, 16 hidden
          units) was trained by simulation with the Cross-Entropy Method to maximise profit minus an inventory
          penalty. To explain it, a linear model is distilled from it and labelled with its fidelity, and the
          Research page asks which of the analytical market maker’s ideas it rediscovered on its own.
        </p>
      </section>

      <section>
        <h2>One modelling choice to know about</h2>
        <p>
          Noise traders here are price-sensitive: each has a random tolerance (exponential, mean{' '}
          {NOISE_TOLERANCE_MEAN}) and only trades if the price is within it of the public-card value. If noise
          traders paid any price, the most profitable spread would be infinitely wide and no market maker
          design could be compared fairly.
        </p>
      </section>

      <section>
        <h2>How it is built</h2>
        <ul className="about__stack">
          <li>
            TypeScript (strict), React and Vite; Zustand for state; Recharts and hand-drawn SVG for charts.
          </li>
          <li>
            The engine, belief model and agents are pure TypeScript with no DOM, shared by the page, a Web
            Worker (reviews, the skill score, the Sandbox) and the Node research scripts.
          </li>
          <li>Seeded randomness everywhere: any game replays exactly from its seed and your actions.</li>
          <li>
            Vitest (with fast-check property tests) for zero-sum, replay, calibration, decomposition,
            counterfactual, no-cheat and no-leak tests; Playwright plays full games in a real browser.
          </li>
          <li>GitHub Actions runs every check and deploys to GitHub Pages.</li>
        </ul>
        <div className="row">
          <a className="btn btn--primary" href={REPO_URL}>
            Source on GitHub
          </a>
          <a className="btn" href={`${REPO_URL}/blob/main/docs/DECISIONS.md`}>
            Design decisions
          </a>
          <a className="btn" href={href('/research')}>
            Research results
          </a>
        </div>
      </section>
    </main>
  );
}
