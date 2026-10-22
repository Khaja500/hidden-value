import { useEffect, useState } from 'react';
import { GameScreen } from '../components/GameScreen';
import { PlayingCard } from '../components/PlayingCard';
import { cardName, PRIOR_MEAN, PRIOR_VARIANCE, rankOf } from '../engine/cards';
import type { Advice } from '../agents/advisor';
import type { PlayerView } from '../engine/types';
import { fmt } from '../explain/render';
import { href } from '../router';
import { useGame, useGameVisible } from '../store/gameStore';
import { useSettings } from '../store/settings';

/** A fixed deal so the lessons line up: you hold a King and the Advisor says BUY on the first step. */
export const TUTORIAL_SEED = 1757224188;

interface Lesson {
  title: string;
  body: React.ReactNode;
}

function GlostenMilgrom() {
  const [alpha, setAlpha] = useState(0.3);
  const pHigh = (1 + alpha) / 2;
  const ask = 25 + 20 * pHigh;
  const bid = 25 + 20 * (1 - pHigh);
  return (
    <div className="gm">
      <p>
        Suppose V is either <strong className="mono">25</strong> or <strong className="mono">45</strong>,
        equally likely. A share α of traders know which; the rest buy or sell at random. If the next trader{' '}
        <em>buys</em>, how likely is V = 45?
      </p>
      <label className="gm__slider">
        <span>
          Informed share α = <strong className="mono">{alpha.toFixed(2)}</strong>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={alpha}
          onChange={(e) => setAlpha(Number(e.target.value))}
        />
      </label>
      <ol className="gm__steps">
        <li>
          P(buy | V = 45) = α + (1 − α)/2 = <span className="mono">{fmt((1 + alpha) / 2, 2)}</span>; P(buy | V
          = 25) = (1 − α)/2 = <span className="mono">{fmt((1 - alpha) / 2, 2)}</span>
        </li>
        <li>
          So after a buy, P(V = 45) = (1 + α)/2 = <span className="mono">{fmt(pHigh, 2)}</span>
        </li>
        <li>
          Ask = E[V | buy] = 25 + 20 × {fmt(pHigh, 2)} = <strong className="mono">{fmt(ask, 1)}</strong>; bid
          = E[V | sell] = <strong className="mono">{fmt(bid, 1)}</strong>
        </li>
        <li>
          Spread = α × 20 = <strong className="mono">{fmt(ask - bid, 1)}</strong>
        </li>
      </ol>
      <p className="muted">
        The market maker cannot tell informed traders from the rest, so it sets each price as if the trade
        that hits it came from someone who might know more. More informed traders, wider spread.
      </p>
    </div>
  );
}

const LESSONS: Lesson[] = [
  {
    title: 'The asset',
    body: (
      <>
        <p>
          Five cards are dealt face down. The asset is worth <strong>V = the sum of their values</strong>,
          with Ace = 1 up to King = 13.
        </p>
        <div className="cards__row tut__cards" aria-hidden="true">
          <PlayingCard card={12} role="public" size="sm" />
          <PlayingCard card={13 + 4} role="public" size="sm" />
          <PlayingCard role="hidden" size="sm" />
          <PlayingCard role="hidden" size="sm" />
          <PlayingCard role="hidden" size="sm" />
        </div>
        <p>
          Before anything is shown, V averages <strong className="mono">{PRIOR_MEAN}</strong> with a standard
          deviation of about <strong className="mono">{fmt(Math.sqrt(PRIOR_VARIANCE))}</strong>: it can be
          anything from 5 to 65, but is usually 27–43. In rounds 2, 3 and 4 one more card is turned face up
          for everyone.
        </p>
      </>
    ),
  },
  {
    title: 'Bid and ask',
    body: (
      <>
        <p>
          The market maker always shows two prices. The <strong>bid</strong> is what it will pay: you{' '}
          <strong>sell at the bid</strong> (▼). The <strong>ask</strong> is what it charges: you{' '}
          <strong>buy at the ask</strong> (▲). The gap between them is the <strong>spread</strong>.
        </p>
        <p>
          At the end, every unit you bought pays V − price, and every unit you sold pays price − V. Your score
          is your total P&amp;L.
        </p>
      </>
    ),
  },
  {
    title: 'Edge',
    body: (
      <>
        <p>
          You see one card the market maker does not. That gives you your own <strong>estimate</strong> of V.
        </p>
        <ul>
          <li>
            <strong>Buy edge</strong> = your estimate − ask. Positive means buying is a good trade on average.
          </li>
          <li>
            <strong>Sell edge</strong> = bid − your estimate.
          </li>
        </ul>
        <p>
          Edge is about the average, not a guarantee: a good trade can still lose when the hidden cards
          surprise you.
        </p>
      </>
    ),
  },
  { title: 'Why is there a spread?', body: <GlostenMilgrom /> },
  {
    title: 'The market maker’s other tricks',
    body: (
      <>
        <p>
          It updates its <strong>fair value</strong> after every reveal and every trade it sees. When it holds
          inventory it <strong>skews</strong> both prices to get rid of it: long, it lowers them to attract
          buyers; short, it raises them. It also adds a little extra spread for risk while lots of cards are
          still hidden.
        </p>
        <p>After the game, the Review opens up its reasoning for every single quote.</p>
      </>
    ),
  },
  {
    title: 'The Advisor',
    body: (
      <>
        <p>
          The Advisor uses only what you can see. At each step it says <strong>BUY</strong>,{' '}
          <strong>SELL</strong> or <strong>HOLD</strong>, how much, and why, with the numbers behind it. In
          this tutorial it is always on.
        </p>
        <p>Keyboard: B buy, S sell, 1/2/3 size, Space pass, A ask the Advisor.</p>
      </>
    ),
  },
];

interface Tip {
  id: string;
  when: (v: PlayerView, settled: boolean) => boolean;
  title: string;
  body: (v: PlayerView, advice: Advice | null) => React.ReactNode;
}

const TIPS: Tip[] = [
  {
    id: 'start',
    when: (v) => v.round === 1 && v.step === 1,
    title: 'Your first step',
    body: (v, a) => {
      const c = v.privateCards[0].card;
      return (
        <>
          You hold the <strong>{cardName(c)}</strong> (value {rankOf(c)}), and the market maker can’t see it.
          One trader has already arrived (see the trade feed), and the quote is now{' '}
          <span className="mono">
            {fmt(v.quote.bid)} / {fmt(v.quote.ask)}
          </span>
          .{' '}
          {a && a.action === 'buy' ? (
            <>
              Your estimate ({fmt(a.estimate.mean)}) is {fmt(a.buyEdge)} above the ask, so the Advisor says
              buy. Try it: choose a size and press <strong>Buy</strong> (or B).
            </>
          ) : (
            <>
              Compare your estimate with the bid and ask: the Advisor’s card on the right shows the numbers.
            </>
          )}
        </>
      );
    },
  },
  {
    id: 'after-first',
    when: (v) => v.round === 1 && v.step === 2,
    title: 'What just happened',
    body: () => (
      <>
        Your trade is in the feed, highlighted. The line under the board grades it using only what you knew at
        the time. Each step, one trader arrives: most are noise traders, but some are{' '}
        <strong>informed</strong> and know 1–2 cards. The market maker cannot tell which, so it nudges its
        fair value after every buy or sell.
      </>
    ),
  },
  {
    id: 'flow',
    when: (v) => v.round === 1 && v.step === 4,
    title: 'Watch the prices move',
    body: (v) => (
      <>
        The arrows next to the bid and ask show how they moved since your last decision.{' '}
        {v.mmPosition < 0
          ? `The market maker is now short ${-v.mmPosition} units, so it raises both prices to attract sellers (inventory skew).`
          : v.mmPosition > 0
            ? `The market maker is now long ${v.mmPosition} units, so it lowers both prices to attract buyers (inventory skew).`
            : 'The market maker holds no inventory right now, so its prices are not skewed.'}{' '}
        The Advisor’s “Why” list separates your card, the trade feed and the market maker’s positioning.
      </>
    ),
  },
  {
    id: 'reveal',
    when: (v) => v.round === 2 && v.step === 1,
    title: 'A card is revealed',
    body: (v) => (
      <>
        Round 2 opened with the <strong>{cardName(v.revealed[0].card)}</strong> face up for everyone. Public
        information moves the market maker’s fair value and your estimate by the same amount, so it does not
        change your <em>edge</em>; your private card does.
      </>
    ),
  },
  {
    id: 'reveal2',
    when: (v) => v.round === 3 && v.step === 1,
    title: 'Another reveal',
    body: (v) => {
      const r = rankOf(v.revealed[1].card);
      return (
        <>
          The {cardName(v.revealed[1].card)} is{' '}
          {r <= 6 ? 'a low card: bad news for the value' : r >= 8 ? 'a high card' : 'about average'}. Fewer
          cards are hidden now, so everyone is less uncertain and the market maker can quote a narrower
          spread. Check whether your edge is still there before adding to your position.
        </>
      );
    },
  },
  {
    id: 'last',
    when: (v) => v.round === 4 && v.step === 1,
    title: 'Last round',
    body: () => (
      <>
        Only one card the market maker can’t see is left besides yours. In this round the Advisor will also
        tell you to close a position if the market will now pay more than it is worth to you.
      </>
    ),
  },
  {
    id: 'done',
    when: (_v, settled) => settled,
    title: 'Settled',
    body: () => (
      <>
        All five cards are face up and every position is paid out at V. Open <strong>Review this game</strong>{' '}
        to see the market maker’s reasoning for every quote, what the Advisor said, and how your trades were
        graded.
      </>
    ),
  },
];

export function Tutorial() {
  const status = useGame((s) => s.status);
  const mode = useGame((s) => s.mode);
  const view = useGame((s) => s.view);
  const advice = useGame((s) => s.advice);
  const start = useGame((s) => s.start);
  const update = useSettings((s) => s.update);
  const [lesson, setLesson] = useState(0);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    document.title = 'Tutorial · Hidden Value';
  }, []);
  const finished = status === 'settled' && mode === 'tutorial';
  useEffect(() => {
    if (finished) update({ tutorialDone: true });
  }, [finished, update]);

  const [show, markStarted] = useGameVisible('tutorial');
  const begin = () => {
    markStarted();
    setDismissed([]);
    start({ difficulty: 'medium', mode: 'tutorial', pacing: 'turn', seed: TUTORIAL_SEED });
  };

  if (show && view) {
    const settled = status === 'settled';
    const tip = [...TIPS].reverse().find((t) => t.when(view, settled) && !dismissed.includes(t.id));
    const overlay = tip ? (
      <div className="tip" role="dialog" aria-labelledby={`tip-${tip.id}`} aria-live="polite">
        <h2 className="tip__title" id={`tip-${tip.id}`}>
          {tip.title}
        </h2>
        <p className="tip__body">{tip.body(view, advice)}</p>
        <button type="button" className="btn btn--small" onClick={() => setDismissed((d) => [...d, tip.id])}>
          Got it
        </button>
      </div>
    ) : null;
    return (
      <main id="main" className="page page--play">
        <GameScreen overlay={overlay} onPlayAgain={begin} />
      </main>
    );
  }

  const l = LESSONS[lesson];
  return (
    <main id="main" className="page page--narrow">
      <p className="stamp">
        Tutorial · {lesson + 1} of {LESSONS.length}
      </p>
      <h1>{l.title}</h1>
      <div className="ticket ticket--perf tut__lesson">{l.body}</div>
      <div className="row tut__nav">
        <button type="button" className="btn" onClick={() => setLesson((i) => i - 1)} disabled={lesson === 0}>
          ← Back
        </button>
        {lesson < LESSONS.length - 1 ? (
          <button type="button" className="btn btn--primary" onClick={() => setLesson((i) => i + 1)}>
            Next →
          </button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={begin} data-testid="start-tutorial">
            Start the guided game
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={begin}>
          Skip to the game
        </button>
      </div>
      <p className="muted">
        Already know the rules? <a href={href('/play')}>Go straight to Play</a>.
      </p>
    </main>
  );
}
