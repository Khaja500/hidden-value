import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { seedToString } from '../engine/rng';
import type { PlayerAction } from '../engine/types';
import { fmt, signed } from '../explain/render';
import { href } from '../router';
import { useGame } from '../store/gameStore';
import { useSettings } from '../store/settings';
import { AdvisorPanel } from './AdvisorPanel';
import { CardRow } from './CardRow';
import { PositionPanel } from './PositionPanel';
import { QuoteBoard } from './QuoteBoard';
import { TopBar } from './TopBar';
import { TradeFeed } from './TradeFeed';

interface Props {
  /** Shown in the right column instead of the Advisor in ranked mode. */
  rankedNote?: ReactNode;
  /** Extra content above the board (tutorial pop-ups). */
  overlay?: ReactNode;
  onPlayAgain: () => void;
}

const MODE_LABEL = { practice: 'Practice', daily: 'Daily (ranked)', tutorial: 'Tutorial' } as const;

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  );
}

export function GameScreen({ rankedNote, overlay, onPlayAgain }: Props) {
  const g = useGame();
  const stepSeconds = useSettings((s) => s.stepSeconds);
  const view = g.view!;
  const playing = g.status === 'playing';
  const timed = g.pacing === 'timed' && playing && g.mode !== 'tutorial';
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const act = g.act;

  const doAct = useCallback(
    (a: PlayerAction) => {
      if (!playing) return;
      act(a);
    },
    [act, playing],
  );

  // Timed mode: each step lasts `stepSeconds`; no action counts as a pass.
  const stepKey = `${view.round}-${view.step}-${view.events.length}`;
  useEffect(() => {
    if (!timed) {
      setSecondsLeft(null);
      return;
    }
    setSecondsLeft(stepSeconds);
    const started = Date.now();
    const id = window.setInterval(() => {
      const left = Math.max(0, stepSeconds - Math.floor((Date.now() - started) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        window.clearInterval(id);
        act({ side: 'pass', size: 0 });
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [timed, stepKey, stepSeconds, act]);

  // Keyboard: B buy, S sell, 1/2/3 size, Space pass, A ask the Advisor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useGame.getState();
      if (st.status !== 'playing' || !st.view) return;
      const k = e.key.toLowerCase();
      if (k === 'b' && st.view.maxBuy >= st.size) st.act({ side: 'buy', size: st.size });
      else if (k === 's' && st.view.maxSell >= st.size) st.act({ side: 'sell', size: st.size });
      else if (k === '1' || k === '2' || k === '3') st.setSize(Number(k));
      else if (k === ' ' || e.code === 'Space') {
        if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
        e.preventDefault();
        st.act({ side: 'pass', size: 0 });
      } else if (k === 'a') st.askAdvisor();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showAdvisor = g.mode !== 'daily';
  return (
    <div className="play" data-testid="game">
      <div className="play__top">
        <TopBar
          view={view}
          modeLabel={MODE_LABEL[g.mode]}
          pacingLabel={g.pacing === 'timed' && g.mode !== 'tutorial' ? 'Timed' : 'Turn-based'}
          secondsLeft={secondsLeft}
          stepSeconds={stepSeconds}
        />
      </div>
      {overlay && <div className="play__overlay">{overlay}</div>}
      <div className="play__cards">
        <CardRow view={view} settled={g.settled} />
      </div>
      <div className="play__board">
        {g.status === 'settled' && g.settled && g.log ? (
          <Settlement onPlayAgain={onPlayAgain} />
        ) : (
          <>
            <QuoteBoard view={view} size={g.size} onSize={g.setSize} onAct={doAct} disabled={!playing} />
            <p className="verdict" aria-live="polite" data-testid="verdict">
              {g.verdict ?? ''}
            </p>
          </>
        )}
      </div>
      <div className="play__advisor">
        {showAdvisor ? (
          <AdvisorPanel
            view={view}
            belief={g.belief}
            advice={g.advice}
            onAsk={g.askAdvisor}
            hintsUsed={g.hintsUsed}
            alwaysOn={g.mode === 'tutorial'}
            disabled={!playing}
          />
        ) : (
          <section className="advisor ticket">
            <h2 className="stamp">Ranked</h2>
            {rankedNote}
          </section>
        )}
      </div>
      <div className="play__position">
        <PositionPanel view={view} estimate={g.belief?.mean ?? null} settled={g.settled} />
      </div>
      <div className="play__feed">
        <TradeFeed events={view.events} />
      </div>
    </div>
  );
}

function Settlement({ onPlayAgain }: { onPlayAgain: () => void }) {
  const g = useGame();
  const log = g.log!;
  const s = g.settled!.settlement;
  const [copied, setCopied] = useState(false);
  const share = () => {
    const url = `${window.location.origin}${window.location.pathname}#/play?seed=${seedToString(log.config.seed)}&d=${log.difficulty}`;
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    };
    if (navigator.clipboard?.writeText)
      navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this link', url));
    else window.prompt('Copy this link', url);
  };
  const pnl = s.pnl.player;
  return (
    <section className="settle ticket ticket--perf" aria-labelledby="settle-title" data-testid="settlement">
      <h2 className="stamp" id="settle-title">
        Settlement
      </h2>
      <p className="settle__value">
        V = <span className="mono">{s.value}</span>
      </p>
      <dl className="settle__grid">
        <div>
          <dt>Your P&amp;L (score)</dt>
          <dd className={`num settle__big ${pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : ''}`}>{signed(pnl)}</dd>
        </div>
        <div>
          <dt>Skill score</dt>
          <dd className="num">
            {log.skill === null ? (
              <span className="muted">replaying…</span>
            ) : (
              <span className={log.skill > 0 ? 'pos' : log.skill < 0 ? 'neg' : ''}>{signed(log.skill)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Advisor bot on this deal</dt>
          <dd className="num">{log.advisorPnl === null ? '…' : signed(log.advisorPnl)}</dd>
        </div>
        <div>
          <dt>Market maker P&amp;L</dt>
          <dd className="num">{signed(s.pnl.mm)}</dd>
        </div>
      </dl>
      <p className="muted settle__note">
        Skill score = your P&amp;L minus what the Advisor bot made on the same deal. Positive means you beat
        it.
        {g.mode !== 'daily' && (
          <>
            {' '}
            Hints used: <span className="mono">{log.hintsUsed}</span>.
          </>
        )}{' '}
        Bots this game: noise traders made {fmt(s.pnl.noise)}, informed traders {fmt(s.pnl.informed)}.
      </p>
      <div className="row">
        <a className="btn btn--primary" href={href(`/review/${log.id}`)}>
          Review this game
        </a>
        <button type="button" className="btn" onClick={onPlayAgain}>
          Play again
        </button>
        <button type="button" className="btn" onClick={share}>
          {copied ? 'Link copied' : 'Share this deal'}
        </button>
      </div>
    </section>
  );
}
