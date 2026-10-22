import { fmt } from '../explain/render';

interface Props {
  distribution: readonly number[];
  mean: number;
  sd: number;
  bid: number | null;
  ask: number | null;
  /** Optional true value, for review. */
  value?: number;
  height?: number;
}

/** Your belief about V as a histogram, with the bid and ask drawn as vertical lines. */
export function BeliefHistogram({ distribution, mean, sd, bid, ask, value, height = 150 }: Props) {
  let lo = 5;
  let hi = 65;
  while (lo < hi && distribution[lo] < 0.002) lo++;
  while (hi > lo && distribution[hi] < 0.002) hi--;
  lo = Math.max(5, Math.min(lo, Math.floor(Math.min(bid ?? lo, ask ?? lo, mean - 2 * sd)) - 1));
  hi = Math.min(65, Math.max(hi, Math.ceil(Math.max(bid ?? hi, ask ?? hi, mean + 2 * sd)) + 1));
  if (hi - lo < 12) {
    const pad = Math.ceil((12 - (hi - lo)) / 2);
    lo = Math.max(5, lo - pad);
    hi = Math.min(65, hi + pad);
  }
  const W = 320;
  const H = height;
  const padL = 6;
  const padR = 6;
  const padB = 22;
  const padT = 18;
  const n = hi - lo + 1;
  const bw = (W - padL - padR) / n;
  const maxP = Math.max(0.01, ...distribution.slice(lo, hi + 1));
  const x = (v: number) => padL + (v - lo + 0.5) * bw;
  const y = (p: number) => H - padB - (p / maxP) * (H - padB - padT);
  // Selling at the bid wins when V < bid; buying at the ask wins when V > ask. Lines sit on those bar boundaries.
  const bidX = bid === null ? 0 : x(Math.ceil(bid) - 0.5);
  const askX = ask === null ? 0 : x(Math.floor(ask) + 0.5);
  const ticks: number[] = [];
  const stepT = n > 30 ? 10 : 5;
  for (let t = Math.ceil(lo / stepT) * stepT; t <= hi; t += stepT) ticks.push(t);
  const pAbove = ask === null ? null : distribution.reduce((a, p, v) => (v > ask ? a + p : a), 0);
  const pBelow = bid === null ? null : distribution.reduce((a, p, v) => (v < bid ? a + p : a), 0);
  const summary = `Your belief about V: estimate ${fmt(mean)} plus or minus ${fmt(sd)}.${
    pAbove !== null ? ` ${Math.round(pAbove * 100)}% chance V is above the ask.` : ''
  }${pBelow !== null ? ` ${Math.round(pBelow * 100)}% chance V is below the bid.` : ''}`;

  return (
    <figure className="hist">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="none">
        {Array.from({ length: n }, (_, i) => {
          const v = lo + i;
          const p = distribution[v] ?? 0;
          const zone = ask !== null && v > ask ? 'above' : bid !== null && v < bid ? 'below' : 'mid';
          return (
            <rect
              key={v}
              className={`hist__bar hist__bar--${zone}`}
              x={padL + i * bw + 0.5}
              y={y(p)}
              width={Math.max(1, bw - 1)}
              height={H - padB - y(p)}
            />
          );
        })}
        <line className="hist__axis" x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} />
        {ticks.map((t) => (
          <text key={t} className="hist__tick" x={x(t)} y={H - 6} textAnchor="middle">
            {t}
          </text>
        ))}
        {bid !== null && (
          <g className="hist__line hist__line--bid">
            <line x1={bidX} x2={bidX} y1={padT - 4} y2={H - padB} />
            <text x={bidX < 80 ? bidX + 3 : bidX - 3} y={padT - 6} textAnchor={bidX < 80 ? 'start' : 'end'}>
              ▼ bid {fmt(bid)}
            </text>
          </g>
        )}
        {ask !== null && (
          <g className="hist__line hist__line--ask">
            <line x1={askX} x2={askX} y1={padT - 4} y2={H - padB} />
            <text
              x={askX > W - 80 ? askX - 3 : askX + 3}
              y={bid !== null && askX - bidX < 90 && (bidX < 80 || askX > W - 80) ? padT + 8 : padT - 6}
              textAnchor={askX > W - 80 ? 'end' : 'start'}
            >
              ask {fmt(ask)} ▲
            </text>
          </g>
        )}
        {value !== undefined && (
          <g className="hist__line hist__line--value">
            <line x1={x(value)} x2={x(value)} y1={padT} y2={H - padB} />
          </g>
        )}
      </svg>
      <figcaption className="hist__caption">
        <span>
          Estimate <strong className="mono">{fmt(mean)}</strong> ± <span className="mono">{fmt(sd)}</span>
        </span>
        {pAbove !== null && (
          <span>
            P(V &gt; ask) <span className="mono">{Math.round(pAbove * 100)}%</span>
          </span>
        )}
        {pBelow !== null && (
          <span>
            P(V &lt; bid) <span className="mono">{Math.round(pBelow * 100)}%</span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}
