import { useEffect, useId, useRef, useState } from 'react';
import type { ReviewStep } from '../explain/review';
import { fmt } from '../explain/render';

interface Props {
  steps: ReviewStep[];
  value: number;
  current: number;
  onSelect: (i: number) => void;
}

/** Your estimate, the MM's fair value and the true V across the game, with a scrubber. */
export function Timeline({ steps, value, current, onSelect }: Props) {
  const id = useId();
  // Draw at the container's real width so text stays readable on phones.
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 230;
  const padL = 38;
  const padR = 14;
  const padT = 14;
  const padB = 28;
  const ys = steps
    .flatMap((s) => [s.playerMu, s.mmMu, s.quote.bid ?? s.playerMu, s.quote.ask ?? s.playerMu])
    .concat(value);
  const lo = Math.floor(Math.min(...ys) - 1);
  const hi = Math.ceil(Math.max(...ys) + 1);
  const n = steps.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const path = (vals: number[]) =>
    vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const yTicks: number[] = [];
  const stepY = hi - lo > 24 ? 10 : 5;
  for (let t = Math.ceil(lo / stepY) * stepY; t <= hi; t += stepY) yTicks.push(t);
  const cur = steps[current];
  return (
    <div className="timeline" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-desc`} className="timeline__chart">
        <desc id={`${id}-desc`}>
          Line chart over {n} steps: your estimate ended at {fmt(steps[n - 1]?.playerMu ?? null)}, the market
          maker’s fair value at {fmt(steps[n - 1]?.mmMu ?? null)}, and the true value was {value}.
        </desc>
        {yTicks.map((t) => (
          <g key={t}>
            <line className="tl__grid" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
            <text className="tl__tick" x={padL - 6} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {[1, 2, 3].map((r) => {
          const i = steps.findIndex((s) => s.round === r + 1);
          return i > 0 ? (
            <line key={r} className="tl__round" x1={x(i - 0.5)} x2={x(i - 0.5)} y1={padT} y2={H - padB} />
          ) : null;
        })}
        {steps.map((s, i) =>
          s.quote.bid !== null && s.quote.ask !== null ? (
            <line key={i} className="tl__quote" x1={x(i)} x2={x(i)} y1={y(s.quote.ask)} y2={y(s.quote.bid)} />
          ) : null,
        )}
        <line className="tl__value" x1={padL} x2={W - padR} y1={y(value)} y2={y(value)} />
        <path className="tl__mm" d={path(steps.map((s) => s.mmMu))} />
        <path className="tl__you" d={path(steps.map((s) => s.playerMu))} />
        {steps.map((s, i) =>
          s.action.side === 'pass' ? null : (
            <text
              key={`t${i}`}
              className={`tl__trade tl__trade--${s.action.side}`}
              x={x(i)}
              y={s.action.side === 'buy' ? y(s.quote.ask!) - 6 : y(s.quote.bid!) + 14}
              textAnchor="middle"
            >
              {s.action.side === 'buy' ? '▲' : '▼'}
            </text>
          ),
        )}
        {cur && <line className="tl__cursor" x1={x(current)} x2={x(current)} y1={padT} y2={H - padB} />}
        {[1, 2, 3, 4].map((r) => {
          const i = steps.findIndex((s) => s.round === r);
          return i >= 0 ? (
            <text key={`r${r}`} className="tl__tick" x={x(i)} y={H - 8}>
              R{r}
            </text>
          ) : null;
        })}
      </svg>
      <ul className="tl__legend" aria-hidden="true">
        <li className="tl__legend--you">Your estimate</li>
        <li className="tl__legend--mm">MM fair value</li>
        <li className="tl__legend--value">True V = {value}</li>
        <li className="tl__legend--quote">Bid–ask</li>
      </ul>
      <div className="tl__scrub">
        <button
          type="button"
          className="btn btn--small"
          onClick={() => onSelect(Math.max(0, current - 1))}
          disabled={current === 0}
        >
          ← Prev
        </button>
        <label className="tl__range">
          <span className="sr-only">Step</span>
          <input
            type="range"
            min={0}
            max={n - 1}
            value={current}
            onChange={(e) => onSelect(Number(e.target.value))}
            aria-valuetext={cur ? `Round ${cur.round}, step ${cur.step}` : undefined}
          />
        </label>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => onSelect(Math.min(n - 1, current + 1))}
          disabled={current === n - 1}
        >
          Next →
        </button>
        <span className="tl__pos mono">
          R{cur?.round}·S{cur?.step}
        </span>
      </div>
    </div>
  );
}
