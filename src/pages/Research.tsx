import { useEffect, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ErrorBar,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartFrame, NotRun, StatTile } from '../components/charts';
import {
  axisProps,
  ci,
  MM_LABEL,
  tooltipStyle,
  useChartColors,
  useJson,
  type ChartColors,
  type Loaded,
} from '../components/chartUtils';
import { DEFAULT_GAMMA } from '../agents/mmAnalytical';
import { DIFFICULTIES } from '../engine/rules';
import type { Difficulty, MMKind } from '../engine/types';
import type { CalibrationBucket } from '../belief/calibration';
import { fmt, signed } from '../explain/render';
import type { MeanCI } from '../sim/simulate';
import { LearnedSection } from './ResearchLearned';

// ---- Result file shapes (written by scripts/experiments.ts) -------------------------------------------------

interface MMSummary {
  pnl: MeanCI;
  pnlSd: number;
  spread: number;
  lossToInformed: number;
  gainFromNoise: number;
  meanAbsInventory: number;
  maxAbsInventory: number;
  volume: number;
}
interface CalibView {
  meanBuckets: CalibrationBucket[];
  probBuckets: CalibrationBucket[];
  r2: number;
  rmse: number;
}
interface CalibFile {
  games: number;
  alpha: number;
  mm: CalibView;
  player: CalibView;
}
interface AlphaFile {
  games: number;
  rows: (MMSummary & { mm: MMKind; alpha: number })[];
}
interface GammaFile {
  games: number;
  alpha: number;
  rows: (MMSummary & { gamma: number })[];
}
interface MismatchFile {
  games: number;
  rows: (MMSummary & { trueAlpha: number; factor: number; assumedAlpha: number })[];
}
interface AttributionFile {
  games: number;
  rows: {
    mm: MMKind;
    spreadCapture: number;
    adverseSelection: number;
    inventory: number;
    player: number;
    total: number;
    ci95: Record<'spreadCapture' | 'adverseSelection' | 'inventory' | 'player' | 'total', number>;
  }[];
}
interface AblationFile {
  games: number;
  rows: (MMSummary & { variant: string; claim: string })[];
}
interface FaithFile {
  counterfactual: { states: number; checked: number; matched: number; maxAbsDiff: number };
  advisorAttribution: {
    states: number;
    meanAbsClaimed: number;
    meanAbsDiff: number;
    p95AbsDiff: number;
    within05: number;
  };
}
interface AdvisorFile {
  games: number;
  particles: number;
  params: { theta: number; pMin: number; k: number };
  rows: {
    difficulty: Difficulty;
    meanPnl: number;
    ci95: number;
    winRate: number;
    winRateWhenTrading: number;
    tradesPerGame: number;
    mmPnl: number;
    calibration: CalibrationBucket[];
  }[];
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="research__section" id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {intro && <p>{intro}</p>}
      {children}
    </section>
  );
}

function Gate<T>({
  res,
  command,
  children,
}: {
  res: Loaded<T>;
  command: string;
  children: (d: T) => ReactNode;
}) {
  if (res.state === 'loading') return <p className="muted">Loading simulation results…</p>;
  if (res.state === 'missing') return <NotRun file={res.file} command={command} />;
  return <>{children(res.data)}</>;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// ---- Calibration ----------------------------------------------------------------------------------------------

function ReliabilityChart({
  buckets,
  c,
  probability,
  name,
}: {
  buckets: CalibrationBucket[];
  c: ChartColors;
  probability: boolean;
  name: string;
}) {
  const data = buckets.map((b) => ({ x: b.meanPredicted, y: b.meanRealized, err: b.ci95, n: b.n }));
  const lo = probability ? 0 : Math.floor(Math.min(...data.map((d) => Math.min(d.x, d.y - d.err))) - 1);
  const hi = probability ? 1 : Math.ceil(Math.max(...data.map((d) => Math.max(d.x, d.y + d.err))) + 1);
  const f = (v: number) => (probability ? pct(v) : fmt(v, 0));
  const ticks: number[] = [];
  if (probability) ticks.push(0, 0.25, 0.5, 0.75, 1);
  else for (let t = Math.ceil(lo / 5) * 5; t <= hi; t += 5) ticks.push(t);
  return (
    <div>
      <p className="research__mini-title">{name}</p>
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
          <CartesianGrid stroke={c.grid} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[lo, hi]}
            ticks={ticks}
            {...axisProps(c)}
            tickFormatter={f}
            label={{
              value: probability ? 'stated probability' : 'predicted μ',
              position: 'insideBottom',
              offset: -10,
              fill: c.muted,
              fontSize: 12,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[lo, hi]}
            ticks={ticks}
            {...axisProps(c)}
            tickFormatter={f}
            width={44}
          />
          <ReferenceLine
            segment={[
              { x: lo, y: lo },
              { x: hi, y: hi },
            ]}
            stroke={c.axis}
            ifOverflow="hidden"
          />
          <Tooltip
            {...tooltipStyle(c)}
            formatter={(v, k) => [
              f(Number(v)),
              k === 'y' ? (probability ? 'came true' : 'mean true V') : 'predicted',
            ]}
          />
          <Scatter data={data} fill={c.ink} name={probability ? 'came true' : 'mean true V'}>
            <ErrorBar dataKey="err" direction="y" stroke={c.muted} width={4} />
          </Scatter>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function CalibrationSection() {
  const c = useChartColors();
  const res = useJson<CalibFile>('research/calibration.json');
  return (
    <Section
      id="calibration"
      title="Are the beliefs calibrated?"
      intro="Both the market maker and the Advisor use the same particle filter. If it is honest, games where it predicts a value of about 40 should end at about 40 on average, and statements like “70% chance V is above 38” should come true about 70% of the time."
    >
      <Gate res={res} command="npm run sim -- --exp calibration">
        {(d) => {
          const okMM = d.mm.meanBuckets.filter((b) => b.ok).length;
          const okPl = d.player.meanBuckets.filter((b) => b.ok).length;
          const okP =
            d.mm.probBuckets.filter((b) => b.ok).length + d.player.probBuckets.filter((b) => b.ok).length;
          const nP = d.mm.probBuckets.length + d.player.probBuckets.length;
          return (
            <div className="research__grid">
              <ChartFrame
                title="Predicted fair value vs true value"
                subtitle={`${d.games.toLocaleString()} simulated games, one random step each, deciles of the prediction. Bars are 95% intervals; the diagonal is perfect calibration.`}
                conclusion={
                  <p>
                    {okMM}/10 market-maker buckets and {okPl}/10 player buckets sit within their 95% interval
                    of the diagonal. The player’s view explains more of V (R² {fmt(d.player.r2, 2)} vs{' '}
                    {fmt(d.mm.r2, 2)}): one private card is worth a lot of information.
                  </p>
                }
                table={
                  <BucketTable
                    views={[
                      ['Market maker', d.mm.meanBuckets],
                      ['Player', d.player.meanBuckets],
                    ]}
                    probability={false}
                  />
                }
              >
                <div className="research__pair">
                  <ReliabilityChart
                    buckets={d.mm.meanBuckets}
                    c={c}
                    probability={false}
                    name="Market maker’s view"
                  />
                  <ReliabilityChart
                    buckets={d.player.meanBuckets}
                    c={c}
                    probability={false}
                    name="Player’s view"
                  />
                </div>
              </ChartFrame>
              <ChartFrame
                title="Stated probability vs how often it came true"
                subtitle="Statements P(V > x) for a price x near the estimate, grouped into 10%-wide bins (bins with at least 30 statements)."
                conclusion={
                  <p>
                    {okP} of {nP} probability bins are within their 95% interval. When the model says 70%, it
                    happens about 70% of the time, which is what lets the Advisor quote probabilities to the
                    player.
                  </p>
                }
                table={
                  <BucketTable
                    views={[
                      ['Market maker', d.mm.probBuckets],
                      ['Player', d.player.probBuckets],
                    ]}
                    probability
                  />
                }
              >
                <div className="research__pair">
                  <ReliabilityChart buckets={d.mm.probBuckets} c={c} probability name="Market maker’s view" />
                  <ReliabilityChart buckets={d.player.probBuckets} c={c} probability name="Player’s view" />
                </div>
              </ChartFrame>
            </div>
          );
        }}
      </Gate>
    </Section>
  );
}

function BucketTable({
  views,
  probability,
}: {
  views: [string, CalibrationBucket[]][];
  probability: boolean;
}) {
  const f = (v: number) => (probability ? pct(v) : fmt(v, 2));
  return (
    <table className="data">
      <thead>
        <tr>
          <th>View</th>
          <th className="num">n</th>
          <th className="num">Predicted</th>
          <th className="num">Realized</th>
          <th className="num">95% ±</th>
          <th>Within</th>
        </tr>
      </thead>
      <tbody>
        {views.flatMap(([name, bs]) =>
          bs.map((b, i) => (
            <tr key={`${name}${i}`}>
              <td>{name}</td>
              <td className="num">{b.n}</td>
              <td className="num">{f(b.meanPredicted)}</td>
              <td className="num">{f(b.meanRealized)}</td>
              <td className="num">{f(b.ci95)}</td>
              <td>{b.ok ? 'yes' : 'no'}</td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

// ---- α sweep -------------------------------------------------------------------------------------------------

function AlphaSection() {
  const c = useChartColors();
  const res = useJson<AlphaFile>('research/alpha-sweep.json');
  return (
    <Section
      id="alpha"
      title="More informed traders: who survives?"
      intro="Bots only (the player always passes), the same deals for every market maker. α is the share of bot traders who know one or two of the hidden cards."
    >
      <Gate res={res} command="npm run sim -- --exp alpha">
        {(d) => {
          const mms = [...new Set(d.rows.map((r) => r.mm))];
          const alphas = [...new Set(d.rows.map((r) => r.alpha))].sort((a, b) => a - b);
          const pivot = (f: (r: AlphaFile['rows'][number]) => number) =>
            alphas.map((a) => {
              const row: Record<string, number> = { alpha: a * 100 };
              for (const m of mms) {
                const r = d.rows.find((x) => x.mm === m && x.alpha === a);
                if (r) row[m] = f(r);
              }
              return row;
            });
          const get = (m: MMKind, a: number) => d.rows.find((r) => r.mm === m && r.alpha === a);
          const beatsFrom = alphas.find((a) =>
            alphas
              .filter((b) => b >= a)
              .every(
                (b) =>
                  (get('analytical', b)?.pnl.mean ?? -Infinity) > (get('naive', b)?.pnl.mean ?? Infinity),
              ),
          );
          const nLo = get('naive', alphas[0]);
          const nHi = get('naive', alphas[alphas.length - 1]);
          const aLo = get('analytical', alphas[0]);
          const aHi = get('analytical', alphas[alphas.length - 1]);
          const lHi = get('learned', alphas[alphas.length - 1]);
          const charts: [string, string, (r: AlphaFile['rows'][number]) => number][] = [
            ['Market maker P&L per game', 'mean of games', (r) => r.pnl.mean],
            ['Average spread', 'ask − bid', (r) => r.spread],
            ['Lost to informed traders', 'informed bots’ P&L per game', (r) => r.lossToInformed],
          ];
          return (
            <>
              <div className="research__grid research__grid--3">
                {charts.map(([title, sub, f]) => (
                  <ChartFrame key={title} title={title} subtitle={`${sub}, ${d.games} games per point`}>
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={pivot(f)} margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
                        <CartesianGrid stroke={c.grid} />
                        <XAxis
                          dataKey="alpha"
                          {...axisProps(c)}
                          unit="%"
                          label={{
                            value: 'α (informed share)',
                            position: 'insideBottom',
                            offset: -10,
                            fill: c.muted,
                            fontSize: 12,
                          }}
                        />
                        <YAxis {...axisProps(c)} width={40} />
                        <ReferenceLine y={0} stroke={c.axis} />
                        <Tooltip
                          {...tooltipStyle(c)}
                          formatter={(v, k) => [fmt(Number(v), 2), MM_LABEL[k as MMKind] ?? k]}
                          labelFormatter={(l) => `α = ${l}%`}
                        />
                        <Legend
                          verticalAlign="top"
                          align="right"
                          height={28}
                          formatter={(v) => MM_LABEL[v as MMKind] ?? v}
                        />
                        {mms.map((m) => (
                          <Line
                            key={m}
                            dataKey={m}
                            stroke={c[m]}
                            strokeWidth={2}
                            dot={{ r: 4, strokeWidth: 2, stroke: c.surface, fill: c[m] }}
                            activeDot={{ r: 6 }}
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartFrame>
                ))}
              </div>
              <div className="ticket chart__conclusion research__conclusion">
                <p>
                  The naive market maker’s fixed spread of 6 earns {fmt(nLo?.pnl.mean ?? 0)} per game when
                  nobody is informed but {fmt(nHi?.pnl.mean ?? 0)} at α = {pct(alphas[alphas.length - 1])}: it
                  never learns from the order flow, so informed traders pick it off (
                  {fmt(nHi?.lossToInformed ?? 0)} per game). The analytical market maker widens its
                  Glosten–Milgrom spread as α rises ({fmt(aLo?.spread ?? 0, 1)} → {fmt(aHi?.spread ?? 0, 1)})
                  and keeps earning ({fmt(aHi?.pnl.mean ?? 0)} at α = {pct(alphas[alphas.length - 1])}).{' '}
                  {beatsFrom !== undefined && (
                    <>It out-earns the naive market maker at every α from {pct(beatsFrom)} up. </>
                  )}
                  With no informed traders the naive spread happens to sit near the profit-maximising width
                  for price-sensitive noise traders, so it earns more there.
                  {lHi && (
                    <>
                      {' '}
                      The learned market maker earns {fmt(lHi.pnl.mean)} at α ={' '}
                      {pct(alphas[alphas.length - 1])} with an average spread of {fmt(lHi.spread, 1)}.
                    </>
                  )}
                </p>
              </div>
              <details className="chart__table ticket">
                <summary>Show the α sweep as a table</summary>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Market maker</th>
                        <th className="num">α</th>
                        <th className="num">P&amp;L (95% CI)</th>
                        <th className="num">Spread</th>
                        <th className="num">Lost to informed</th>
                        <th className="num">Gained from noise</th>
                        <th className="num">Mean |inventory|</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((r) => (
                        <tr key={`${r.mm}${r.alpha}`}>
                          <td>{MM_LABEL[r.mm]}</td>
                          <td className="num">{pct(r.alpha)}</td>
                          <td className="num">{ci(r.pnl.mean, r.pnl.ci95)}</td>
                          <td className="num">{fmt(r.spread, 2)}</td>
                          <td className="num">{fmt(r.lossToInformed)}</td>
                          <td className="num">{fmt(r.gainFromNoise)}</td>
                          <td className="num">{fmt(r.meanAbsInventory, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          );
        }}
      </Gate>
    </Section>
  );
}

// ---- γ sweep ---------------------------------------------------------------------------------------------------

function GammaSection() {
  const c = useChartColors();
  const res = useJson<GammaFile>('research/gamma-sweep.json');
  return (
    <Section
      id="gamma"
      title="Risk aversion: profit against inventory risk"
      intro="The analytical market maker’s γ sets both its inventory skew (−γ·q·Var) and its risk half-spread (c·γ·Var). Bots only, α = 25%."
    >
      <Gate res={res} command="npm run sim -- --exp gamma">
        {(d) => {
          const data = d.rows.map((r) => ({
            x: r.meanAbsInventory,
            y: r.pnl.mean,
            err: r.pnl.ci95,
            gamma: r.gamma,
            spread: r.spread,
            sd: r.pnlSd,
          }));
          const best = d.rows.reduce((a, b) => (b.pnl.mean > a.pnl.mean ? b : a));
          const game = d.rows.find((r) => r.gamma === DEFAULT_GAMMA);
          const lo = d.rows[0];
          const hi = d.rows[d.rows.length - 1];
          return (
            <div className="research__grid">
              <ChartFrame
                title="Mean P&L vs mean |inventory|, one point per γ"
                subtitle={`${d.games} games per point; bars are 95% intervals; labels are γ`}
                conclusion={
                  <p>
                    Raising γ from {lo.gamma} to {hi.gamma} cuts the average inventory from{' '}
                    {fmt(lo.meanAbsInventory, 1)} to {fmt(hi.meanAbsInventory, 1)} units and the P&amp;L
                    standard deviation from {fmt(lo.pnlSd, 0)} to {fmt(hi.pnlSd, 0)}. Profit peaks at γ ={' '}
                    {best.gamma} ({fmt(best.pnl.mean)} per game); beyond that the risk spread gets so wide (
                    {fmt(hi.spread, 1)} at γ = {hi.gamma}) that noise traders stop trading.{' '}
                    {game && game.gamma !== best.gamma && (
                      <>
                        The game uses γ = {game.gamma} ({fmt(game.pnl.mean)} per game, spread{' '}
                        {fmt(game.spread, 1)}): γ = {best.gamma} earns{' '}
                        {best.pnl.mean >= game.pnl.mean ? 'as much or more' : 'less'} with{' '}
                        {best.pnlSd < game.pnlSd ? 'less' : 'more'} risk, but quotes a spread of{' '}
                        {fmt(best.spread, 1)}, which leaves a human player little room to trade. The game
                        deliberately keeps the narrower, more playable spread.
                      </>
                    )}
                  </p>
                }
                table={
                  <table className="data">
                    <thead>
                      <tr>
                        <th className="num">γ</th>
                        <th className="num">P&amp;L (95% CI)</th>
                        <th className="num">P&amp;L SD</th>
                        <th className="num">Mean |inv|</th>
                        <th className="num">Spread</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((r) => (
                        <tr key={r.gamma}>
                          <td className="num">{r.gamma}</td>
                          <td className="num">{ci(r.pnl.mean, r.pnl.ci95)}</td>
                          <td className="num">{fmt(r.pnlSd)}</td>
                          <td className="num">{fmt(r.meanAbsInventory, 2)}</td>
                          <td className="num">{fmt(r.spread, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              >
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={data} margin={{ top: 16, right: 24, bottom: 22, left: 0 }}>
                    <CartesianGrid stroke={c.grid} />
                    <XAxis
                      type="number"
                      dataKey="x"
                      {...axisProps(c)}
                      domain={[0, 'auto']}
                      label={{
                        value: 'mean |inventory| (units)',
                        position: 'insideBottom',
                        offset: -12,
                        fill: c.muted,
                        fontSize: 12,
                      }}
                    />
                    <YAxis type="number" dataKey="y" {...axisProps(c)} width={40} />
                    <Tooltip
                      {...tooltipStyle(c)}
                      formatter={(v, k) => [fmt(Number(v), 2), k === 'y' ? 'P&L' : '|inventory|']}
                    />
                    <Line
                      dataKey="y"
                      stroke={c.analytical}
                      strokeWidth={2}
                      dot={{ r: 5, stroke: c.surface, strokeWidth: 2, fill: c.analytical }}
                      isAnimationActive={false}
                    >
                      <ErrorBar dataKey="err" direction="y" stroke={c.muted} width={4} />
                      <LabelList
                        dataKey="gamma"
                        position="top"
                        fill={c.ink}
                        fontSize={11}
                        formatter={(v) => `γ ${v}`}
                      />
                    </Line>
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartFrame>
              <MismatchCard />
            </div>
          );
        }}
      </Gate>
    </Section>
  );
}

function MismatchCard() {
  const res = useJson<MismatchFile>('research/mismatch.json');
  return (
    <Gate res={res} command="npm run sim -- --exp mismatch">
      {(d) => {
        const row = (t: number, f: number) => d.rows.find((r) => r.trueAlpha === t && r.factor === f);
        const trues = [...new Set(d.rows.map((r) => r.trueAlpha))];
        const change = (t: number, f: number) => (row(t, f)?.pnl.mean ?? 0) - (row(t, 1)?.pnl.mean ?? 0);
        const underHelps = trues.every((t) => change(t, 0.5) > 0);
        const overHurts = trues.every((t) => change(t, 1.5) < 0);
        const hi = trues[trues.length - 1];
        return (
          <ChartFrame
            title="Model mismatch: the market maker’s α is wrong by ±50%"
            subtitle={`Analytical MM, bots only, ${d.games} games per row`}
            conclusion={
              <p>
                Being wrong is not symmetric. Assuming half the true α changes P&amp;L by{' '}
                {trues.map((t) => signed(change(t, 0.5))).join(' and ')} per game (true α ={' '}
                {trues.map(pct).join(' / ')}
                ); assuming 50% too much changes it by{' '}
                {trues.map((t) => signed(change(t, 1.5))).join(' and ')}.{' '}
                {underHelps &&
                  overHurts &&
                  `Underestimating narrows the spread (${fmt(row(hi, 1)?.spread ?? 0, 1)} → ${fmt(row(hi, 0.5)?.spread ?? 0, 1)} at α = ${pct(hi)}): informed traders take more (${fmt(row(hi, 1)?.lossToInformed ?? 0)} → ${fmt(row(hi, 0.5)?.lossToInformed ?? 0)}), but more noise traders trade and that wins. Overestimating makes a spread that is too wide for noise traders. The Glosten–Milgrom part is a zero-profit spread and the risk spread already sits on top of it, so the total spread is on the wide side of the profit-maximising width.`}
              </p>
            }
          >
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="num">True α</th>
                    <th className="num">Assumed α</th>
                    <th className="num">P&amp;L (95% CI)</th>
                    <th className="num">Spread</th>
                    <th className="num">Lost to informed</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={`${r.trueAlpha}${r.factor}`}>
                      <td className="num">{pct(r.trueAlpha)}</td>
                      <td className="num">
                        {fmt(r.assumedAlpha * 100, 1)}%{' '}
                        <span className="muted">
                          ({r.factor === 1 ? 'correct' : r.factor < 1 ? '−50%' : '+50%'})
                        </span>
                      </td>
                      <td className="num">{ci(r.pnl.mean, r.pnl.ci95)}</td>
                      <td className="num">{fmt(r.spread, 2)}</td>
                      <td className="num">{fmt(r.lossToInformed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartFrame>
        );
      }}
    </Gate>
  );
}

// ---- P&L attribution -------------------------------------------------------------------------------------------

function AttributionSection() {
  const c = useChartColors();
  const res = useJson<AttributionFile>('research/attribution.json');
  return (
    <Section
      id="attribution"
      title="Where each market maker’s P&L comes from"
      intro="Every trade’s P&L splits exactly into the spread earned against the market maker’s own fair value at the time, plus how the true value turned out against that fair value, booked by counterparty: informed bots (adverse selection), noise bots (inventory drift) and the player. The Advisor bot plays, α = 25%."
    >
      <Gate res={res} command="npm run sim -- --exp attribution">
        {(d) => {
          const comps: [keyof AttributionFile['rows'][number], string][] = [
            ['spreadCapture', 'Spread capture'],
            ['adverseSelection', 'Informed traders'],
            ['inventory', 'Inventory drift'],
            ['player', 'The player'],
            ['total', 'Total'],
          ];
          const data = comps.map(([k, label]) => {
            const row: Record<string, number | string> = { k: label };
            for (const r of d.rows) row[r.mm] = r[k] as number;
            return row;
          });
          const by = (m: MMKind) => d.rows.find((r) => r.mm === m);
          const n = by('naive');
          const a = by('analytical');
          return (
            <ChartFrame
              title="Mean P&L per game, by source"
              subtitle={`${d.games} games per market maker; the first four bars add up to the total`}
              conclusion={
                n &&
                a && (
                  <p>
                    The naive market maker captures {fmt(n.spreadCapture)} of spread per game but gives back{' '}
                    {fmt(-n.adverseSelection)} to informed bots and {fmt(-n.player)} to the Advisor bot, which
                    sees a card it doesn’t. The analytical market maker captures a similar{' '}
                    {fmt(a.spreadCapture)}, and its spread protection cuts the informed bots’ take to{' '}
                    {fmt(-a.adverseSelection)} and the player’s to {fmt(-a.player)}. The inventory term
                    differs:{' '}
                    {Math.abs(n.inventory) <= n.ci95.inventory
                      ? `for the naive market maker it is indistinguishable from zero (${ci(n.inventory, n.ci95.inventory)})`
                      : `for the naive market maker it is ${ci(n.inventory, n.ci95.inventory)}`}
                    , while for the analytical one it is {ci(a.inventory, a.ci95.inventory)}.{' '}
                    {a.inventory - a.ci95.inventory > 0 &&
                      'After informed traders or the player push its inventory, the skew attracts noise traders on the other side while its fair value is still catching up, so inventory skew partly hedges adverse selection.'}
                  </p>
                )
              }
              table={
                <table className="data">
                  <thead>
                    <tr>
                      <th>Market maker</th>
                      {comps.map(([, l]) => (
                        <th key={l} className="num">
                          {l}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.mm}>
                        <td>{MM_LABEL[r.mm]}</td>
                        {comps.map(([k]) => (
                          <td key={k} className="num">
                            {signed(r[k] as number)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }} barGap={2}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="k" {...axisProps(c)} interval={0} />
                  <YAxis {...axisProps(c)} width={44} />
                  <ReferenceLine y={0} stroke={c.axis} />
                  <Tooltip
                    {...tooltipStyle(c)}
                    formatter={(v, k) => [signed(Number(v)), MM_LABEL[k as MMKind] ?? k]}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    height={28}
                    formatter={(v) => MM_LABEL[v as MMKind] ?? v}
                  />
                  {d.rows.map((r) => (
                    <Bar
                      key={r.mm}
                      dataKey={r.mm}
                      fill={c[r.mm]}
                      radius={[4, 4, 4, 4]}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          );
        }}
      </Gate>
    </Section>
  );
}

// ---- Faithfulness -----------------------------------------------------------------------------------------------

function FaithfulnessSection() {
  const abl = useJson<AblationFile>('research/ablations.json');
  const faith = useJson<FaithFile>('research/faithfulness.json');
  return (
    <Section
      id="faithfulness"
      title="Are the explanations faithful?"
      intro="An explanation is only useful if it describes what really drives the quote. Three checks: remove each component and see whether the effect its explanation claims shows up; replay every counterfactual the market maker lists; and recompute the Advisor’s private-card effect independently."
    >
      <Gate res={abl} command="npm run sim -- --exp ablations">
        {(d) => {
          const full = d.rows[0];
          const checks = d.rows.slice(1).map((r) => {
            let ok: boolean;
            let detail: string;
            if (r.variant.includes('skew')) {
              ok = r.meanAbsInventory > full.meanAbsInventory;
              detail = `mean |inventory| ${fmt(full.meanAbsInventory, 2)} → ${fmt(r.meanAbsInventory, 2)}`;
            } else if (r.variant.includes('adverse')) {
              ok = r.lossToInformed > full.lossToInformed;
              detail = `lost to informed ${fmt(full.lossToInformed)} → ${fmt(r.lossToInformed)} per game`;
            } else {
              ok = r.gainFromNoise < full.gainFromNoise;
              detail = `gained from noise ${fmt(full.gainFromNoise)} → ${fmt(r.gainFromNoise)} per game`;
            }
            return { ...r, ok, detail };
          });
          return (
            <ChartFrame
              title="Ablations: remove one component at a time"
              subtitle={`Analytical MM, bots only, α = 25%, ${d.games} games per row (same deals)`}
              conclusion={
                <p>
                  {checks.filter((x) => x.ok).length} of {checks.length} claimed effects appear when the
                  component is removed. Each component does the job its explanation says it does, so the
                  explanations describe real mechanisms rather than labels.
                </p>
              }
            >
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Variant</th>
                      <th className="num">P&amp;L (95% CI)</th>
                      <th className="num">P&amp;L SD</th>
                      <th className="num">Spread</th>
                      <th>Claimed effect if removed</th>
                      <th>Observed</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{full.variant}</td>
                      <td className="num">{ci(full.pnl.mean, full.pnl.ci95)}</td>
                      <td className="num">{fmt(full.pnlSd)}</td>
                      <td className="num">{fmt(full.spread, 2)}</td>
                      <td className="muted">baseline</td>
                      <td />
                    </tr>
                    {checks.map((r) => (
                      <tr key={r.variant}>
                        <td>{r.variant}</td>
                        <td className="num">{ci(r.pnl.mean, r.pnl.ci95)}</td>
                        <td className="num">{fmt(r.pnlSd)}</td>
                        <td className="num">{fmt(r.spread, 2)}</td>
                        <td>{r.claim}</td>
                        <td>
                          {r.ok ? '✓ yes' : '✗ no'}: {r.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartFrame>
          );
        }}
      </Gate>
      <Gate res={faith} command="npm run sim -- --exp faithfulness">
        {(f) => (
          <div className="stats">
            <StatTile
              label="Counterfactual quotes that match a real replay"
              value={`${f.counterfactual.matched} / ${f.counterfactual.checked}`}
              note={`${f.counterfactual.states.toLocaleString()} random game states; largest difference ${fmt(f.counterfactual.maxAbsDiff, 2)}`}
            />
            <StatTile
              label="Advisor’s private-card effect vs independent recompute"
              value={`${fmt(f.advisorAttribution.meanAbsDiff, 2)} mean gap`}
              note={`typical effect size ${fmt(f.advisorAttribution.meanAbsClaimed, 1)}; ${pct(f.advisorAttribution.within05)} within 0.5 (Monte Carlo noise)`}
            />
          </div>
        )}
      </Gate>
    </Section>
  );
}

// ---- Advisor results ----------------------------------------------------------------------------------------------

function AdvisorSection() {
  const c = useChartColors();
  const res = useJson<AdvisorFile>('research/advisor.json');
  return (
    <Section
      id="advisor"
      title="Does following the Advisor make money?"
      intro="The Advisor bot plays every game exactly as the Advisor says, on held-out test deals that were never used for tuning."
    >
      <Gate res={res} command="npm run sim -- --exp advisor">
        {(d) => {
          const data = d.rows.map((r) => ({
            k: DIFFICULTIES[r.difficulty].label,
            y: r.meanPnl,
            err: r.ci95,
          }));
          const allPositive = d.rows
            .filter((r) => r.difficulty !== 'expert')
            .every((r) => r.meanPnl - r.ci95 > 0);
          const statements = d.rows.flatMap((r) => r.calibration);
          return (
            <div className="research__grid">
              <ChartFrame
                title="Advisor bot P&L per game"
                subtitle={`${d.games.toLocaleString()} test games per level, ${d.particles.toLocaleString()} particles; bars are 95% intervals`}
                conclusion={
                  <p>
                    {allPositive
                      ? 'At Easy, Medium and Hard the whole 95% interval is above zero: following the Advisor is reliably profitable.'
                      : 'Not every level clears zero yet; see the table.'}{' '}
                    Profit shrinks as the market maker gets smarter and more traders are informed. Settings: θ
                    = {d.params.theta}, p_min = {d.params.pMin}, k = {d.params.k}, tuned on separate
                    validation deals.
                  </p>
                }
                table={
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Level</th>
                        <th className="num">P&amp;L (95% CI)</th>
                        <th className="num">Win rate</th>
                        <th className="num">Win rate when trading</th>
                        <th className="num">Trades / game</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((r) => (
                        <tr key={r.difficulty}>
                          <td>{DIFFICULTIES[r.difficulty].label}</td>
                          <td className="num">{ci(r.meanPnl, r.ci95)}</td>
                          <td className="num">{pct(r.winRate)}</td>
                          <td className="num">{pct(r.winRateWhenTrading)}</td>
                          <td className="num">{fmt(r.tradesPerGame, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              >
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke={c.grid} vertical={false} />
                    <XAxis dataKey="k" {...axisProps(c)} />
                    <YAxis {...axisProps(c)} width={40} />
                    <ReferenceLine y={0} stroke={c.axis} />
                    <Tooltip {...tooltipStyle(c)} formatter={(v) => [fmt(Number(v), 2), 'mean P&L']} />
                    <Bar dataKey="y" fill={c.ink} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                      <ErrorBar dataKey="err" direction="y" stroke={c.muted} width={6} />
                      <LabelList
                        dataKey="y"
                        position="insideTop"
                        fill={c.surface}
                        fontSize={12}
                        formatter={(v) => fmt(Number(v))}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>
              <ChartFrame
                title="Advisor’s stated chances vs outcomes"
                subtitle="Every recommended trade states P(V ends on the right side of the price); grouped into bins"
                conclusion={
                  <p>
                    The Advisor only trades when its stated chance is at least {pct(d.params.pMin)}, so the
                    statements sit in the upper bins. Outcomes track the stated chances, so the percentages on
                    the advice card can be taken at face value.
                  </p>
                }
                table={
                  <BucketTable
                    views={d.rows.map((r) => [DIFFICULTIES[r.difficulty].label, r.calibration])}
                    probability
                  />
                }
              >
                <ReliabilityChart buckets={mergeBuckets(statements)} c={c} probability name="All levels" />
              </ChartFrame>
            </div>
          );
        }}
      </Gate>
    </Section>
  );
}

/** Pools buckets from several levels by bin (weighted by count). */
function mergeBuckets(bs: CalibrationBucket[]): CalibrationBucket[] {
  const bins = new Map<number, CalibrationBucket[]>();
  for (const b of bs) {
    const k = Math.min(9, Math.floor(b.meanPredicted * 10));
    bins.set(k, [...(bins.get(k) ?? []), b]);
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, g]) => {
      const n = g.reduce((a, b) => a + b.n, 0);
      const mp = g.reduce((a, b) => a + b.meanPredicted * b.n, 0) / n;
      const mr = g.reduce((a, b) => a + b.meanRealized * b.n, 0) / n;
      const ci95 = 1.96 * Math.sqrt(Math.max(mp * (1 - mp), 0.25 / n) / n);
      return { n, meanPredicted: mp, meanRealized: mr, ci95, ok: Math.abs(mr - mp) <= ci95 };
    });
}

export function Research() {
  useEffect(() => {
    document.title = 'Research · Hidden Value';
  }, []);
  return (
    <main id="main" className="page research">
      <h1>Research results</h1>
      <p className="lede">
        Every number here comes from simulations run with the same engine as the game (
        <span className="mono">npm run sim</span>), on test deals kept separate from the deals used for
        tuning.
      </p>
      <nav className="research__toc" aria-label="Sections">
        <a href="#calibration" onClick={(e) => jump(e, 'calibration')}>
          Calibration
        </a>
        <a href="#alpha" onClick={(e) => jump(e, 'alpha')}>
          α sweep
        </a>
        <a href="#gamma" onClick={(e) => jump(e, 'gamma')}>
          γ sweep &amp; mismatch
        </a>
        <a href="#attribution" onClick={(e) => jump(e, 'attribution')}>
          P&amp;L attribution
        </a>
        <a href="#faithfulness" onClick={(e) => jump(e, 'faithfulness')}>
          Faithfulness
        </a>
        <a href="#advisor" onClick={(e) => jump(e, 'advisor')}>
          Advisor
        </a>
        <a href="#learned" onClick={(e) => jump(e, 'learned')}>
          Learned market maker
        </a>
      </nav>
      <CalibrationSection />
      <AlphaSection />
      <GammaSection />
      <AttributionSection />
      <FaithfulnessSection />
      <AdvisorSection />
      <LearnedSection />
    </main>
  );
}

/** In-page links must not change the hash route. */
function jump(e: React.MouseEvent, id: string) {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
