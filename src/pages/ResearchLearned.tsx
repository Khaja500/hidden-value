import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DEFAULT_GAMMA } from '../agents/mmAnalytical';
import { ChartFrame, NotRun, StatTile } from '../components/charts';
import { axisProps, tooltipStyle, useChartColors, useJson, type ChartColors } from '../components/chartUtils';
import { fmt, signed } from '../explain/render';

interface CurvePoint {
  iter: number;
  meanObjective: number;
  eliteObjective: number;
  muObjective: number;
  muPnl: number;
  muSpread: number;
}
interface Pdp {
  x: number;
  offset: number;
  halfSpread: number;
}
interface Analysis {
  states: number;
  pdp: {
    offsetVsInventory: Pdp[];
    halfSpreadVsImbalance: Pdp[];
    offsetVsImbalance: Pdp[];
    halfSpreadVsRound: Pdp[];
    offsetVsFlowJoint: Pdp[];
  };
  importance: { offset: number; halfSpread: number }[];
  distilled: {
    offset: number[];
    offsetIntercept: number;
    halfSpread: number[];
    halfSpreadIntercept: number;
    r2Offset: number;
    r2HalfSpread: number;
  };
  fidelity: number;
  inventoryComparison: {
    cardsRevealed: number;
    publicVariance: number;
    learnedPerUnit: number;
    analyticalPerUnit: number;
  }[];
  rediscovered: {
    inventorySkew: boolean;
    inventorySlope: number;
    adverseSelection: boolean;
    spreadAtBalancedFlow: number;
    spreadAfterNetSelling: number;
    spreadAfterNetBuying: number;
    uncertaintySpread: boolean;
    spreadRound1: number;
    spreadRound4: number;
    flowFollowing: boolean;
    jointOffsetAfterNetBuying: number;
    jointOffsetAfterNetSelling: number;
    flowFollowingHoldingInventory: boolean;
  };
}
interface VariantResult {
  runs: {
    seed: number;
    curve: CurvePoint[];
    valObjective: number;
    valPnl: number;
    valMsq: number;
    valSpread: number;
  }[];
  best: {
    seed: number;
    params: number[];
    valObjective: number;
    valPnl: number;
    valMsq: number;
    valSpread: number;
  };
  analysis: Analysis;
}
interface LearnedFile {
  settings: {
    iterations: number;
    population: number;
    elites: number;
    gamesPerEvaluation: number;
    seeds: number;
    lambda: number;
    alphas: number[];
    validationGames: number;
  };
  featureNames: string[];
  chosen: 'linear' | 'mlp';
  variants: { linear: VariantResult; mlp: VariantResult };
}

const VARIANT_LABEL = { linear: 'Linear policy', mlp: 'Small MLP (16 hidden units)' } as const;

function Curves({ v, c, name }: { v: VariantResult; c: ChartColors; name: string }) {
  const iters = v.runs[0].curve.length;
  const data = Array.from({ length: iters }, (_, i) => {
    const row: Record<string, number> = { iter: i + 1 };
    for (const r of v.runs) row[`s${r.seed}`] = r.curve[i].muObjective;
    return row;
  });
  return (
    <div>
      <p className="research__mini-title">{name}</p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
          <CartesianGrid stroke={c.grid} />
          <XAxis
            dataKey="iter"
            {...axisProps(c)}
            label={{
              value: 'CEM iteration',
              position: 'insideBottom',
              offset: -10,
              fill: c.muted,
              fontSize: 12,
            }}
          />
          <YAxis {...axisProps(c)} width={40} domain={['auto', 'auto']} />
          <Tooltip
            {...tooltipStyle(c)}
            formatter={(val, k) => [fmt(Number(val), 2), `seed ${String(k).slice(1)}`]}
            labelFormatter={(l) => `iteration ${l}`}
          />
          {v.runs.map((r) => (
            <Line
              key={r.seed}
              dataKey={`s${r.seed}`}
              stroke={c.learned}
              strokeWidth={r.seed === v.best.seed ? 2.5 : 1}
              strokeOpacity={r.seed === v.best.seed ? 1 : 0.45}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PdpChart({
  data,
  y,
  c,
  title,
  xLabel,
  reference,
}: {
  data: Pdp[];
  y: 'offset' | 'halfSpread';
  c: ChartColors;
  title: string;
  xLabel: string;
  reference?: { label: string; f: (x: number) => number };
}) {
  const xs = data.map((d) => d.x);
  const span = Math.max(...xs) - Math.min(...xs);
  const step = span <= 4 ? 1 : span <= 16 ? 4 : 5;
  const xTicks = xs.filter((x) => Math.abs(x / step - Math.round(x / step)) < 1e-9);
  const rows = data.map((d) => ({
    x: d.x,
    learned: d[y],
    ...(reference ? { analytical: reference.f(d.x) } : {}),
  }));
  return (
    <ChartFrame
      title={title}
      subtitle={reference ? `Learned (MLP) vs ${reference.label}` : 'MLP, averaged over the states it visits'}
      table={
        <table className="data">
          <thead>
            <tr>
              <th className="num">{xLabel}</th>
              <th className="num">Learned</th>
              {reference && <th className="num">{reference.label}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.x}>
                <td className="num">{r.x}</td>
                <td className="num">{fmt(r.learned, 2)}</td>
                {reference && <td className="num">{fmt(r.analytical ?? 0, 2)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
          <CartesianGrid stroke={c.grid} />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={xTicks}
            {...axisProps(c)}
            label={{ value: xLabel, position: 'insideBottom', offset: -10, fill: c.muted, fontSize: 12 }}
          />
          <YAxis
            {...axisProps(c)}
            width={46}
            domain={['auto', 'auto']}
            tickFormatter={(v) => fmt(Number(v), 1)}
          />
          {y === 'offset' && <ReferenceLine y={0} stroke={c.axis} />}
          <Tooltip
            {...tooltipStyle(c)}
            formatter={(v, k) => [
              fmt(Number(v), 2),
              k === 'learned' ? 'learned' : (reference?.label ?? String(k)),
            ]}
          />
          {reference && (
            <Legend
              verticalAlign="top"
              align="right"
              height={26}
              formatter={(v) => (v === 'learned' ? 'Learned (MLP)' : 'Analytical')}
            />
          )}
          <Line dataKey="learned" stroke={c.learned} strokeWidth={2} dot={false} isAnimationActive={false} />
          {reference && (
            <Line
              dataKey="analytical"
              stroke={c.analytical}
              strokeWidth={2}
              dot={false}
              strokeDasharray="6 4"
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function FeatureBars({
  names,
  values,
  c,
  title,
  subtitle,
}: {
  names: string[];
  values: number[];
  c: ChartColors;
  title: string;
  subtitle: string;
}) {
  const data = names.map((n, i) => ({ n, v: values[i] }));
  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      table={
        <table className="data">
          <tbody>
            {data.map((d) => (
              <tr key={d.n}>
                <td>{d.n}</td>
                <td className="num">{signed(d.v, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height={260}>
        <BarChart layout="vertical" data={data} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid stroke={c.grid} horizontal={false} />
          <XAxis type="number" {...axisProps(c)} tickCount={4} tickFormatter={(v) => fmt(Number(v), 1)} />
          <YAxis
            type="category"
            dataKey="n"
            {...axisProps(c)}
            width={170}
            tick={{ fill: c.muted, fontSize: 11 }}
          />
          <ReferenceLine x={0} stroke={c.axis} />
          <Tooltip {...tooltipStyle(c)} formatter={(v) => [signed(Number(v), 3), '']} />
          <Bar dataKey="v" fill={c.learned} radius={3} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function FlowChart({ joint, fixed, c }: { joint: Pdp[]; fixed: Pdp[]; c: ChartColors }) {
  const rows = joint.map((d, i) => ({ x: d.x, joint: d.offset, fixed: fixed[i]?.offset }));
  return (
    <ChartFrame
      title="Centre offset vs order flow"
      subtitle="MLP. Bold: inventory moves with the flow (2 units per net bot trade), as in real games. Thin: inventory held fixed."
      table={
        <table className="data">
          <thead>
            <tr>
              <th className="num">Net bot buys (last 8)</th>
              <th className="num">Joint</th>
              <th className="num">Inventory fixed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.x}>
                <td className="num">{r.x}</td>
                <td className="num">{fmt(r.joint, 2)}</td>
                <td className="num">{fmt(r.fixed ?? 0, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
          <CartesianGrid stroke={c.grid} />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={[-8, -4, 0, 4, 8]}
            {...axisProps(c)}
            label={{
              value: 'net bot buys, last 8 steps',
              position: 'insideBottom',
              offset: -10,
              fill: c.muted,
              fontSize: 12,
            }}
          />
          <YAxis {...axisProps(c)} width={40} tickFormatter={(v) => fmt(Number(v), 0)} />
          <ReferenceLine y={0} stroke={c.axis} />
          <Tooltip
            {...tooltipStyle(c)}
            formatter={(v, k) => [
              fmt(Number(v), 2),
              k === 'joint' ? 'inventory moves with flow' : 'inventory fixed',
            ]}
          />
          <Legend
            verticalAlign="top"
            align="right"
            height={26}
            formatter={(v) => (v === 'joint' ? 'Inventory moves with flow' : 'Inventory fixed')}
          />
          <Line
            dataKey="joint"
            stroke={c.learned}
            strokeWidth={2.5}
            dot={{ r: 3, fill: c.learned, stroke: c.surface }}
            isAnimationActive={false}
          />
          <Line dataKey="fixed" stroke={c.muted} strokeWidth={1.25} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Learned market maker results (spec §6, §8.5). Filled in by `npm run train`. */
export function LearnedSection() {
  const c = useChartColors();
  const res = useJson<LearnedFile>('models/learned-mm.json');
  return (
    <section className="research__section" id="learned" aria-labelledby="learned-h">
      <h2 id="learned-h">The learned market maker</h2>
      <p>
        Instead of designing the quotes, train them. A small policy sees only public features (the public-card
        value, cards revealed, its inventory, inventory × uncertainty, recent order-flow imbalance, round and
        step) and outputs a centre offset and a half-spread. It was trained with the Cross-Entropy Method to
        maximise mean P&amp;L − λ × mean squared inventory against the same bots, across α from 5% to 45%.
        Nothing told it about adverse selection or inventory risk. Did it find them anyway?
      </p>
      {res.state === 'loading' && <p className="muted">Loading training results…</p>}
      {res.state === 'missing' && <NotRun file="models/learned-mm.json" command="npm run train" />}
      {res.state === 'ok' && <LearnedBody d={res.data} c={c} />}
    </section>
  );
}

function LearnedBody({ d, c }: { d: LearnedFile; c: ChartColors }) {
  const mlp = d.variants.mlp;
  const lin = d.variants.linear;
  const am = mlp.analysis;
  const rd = am.rediscovered;
  const r1 = am.inventoryComparison[0];
  const meanVar =
    am.inventoryComparison.reduce((a, r) => a + r.publicVariance, 0) / am.inventoryComparison.length;
  const s = d.settings;
  const n = d.featureNames;
  return (
    <>
      <div className="stats">
        <StatTile
          label="Rediscovered inventory skew?"
          value={rd.inventorySkew ? 'Yes' : 'No'}
          note={`centre moves ${signed(r1.learnedPerUnit, 2)} per unit held with no cards revealed; the analytical −γ·Var is ${signed(r1.analyticalPerUnit, 2)}`}
        />
        <StatTile
          label="Narrows its spread as cards are revealed?"
          value={rd.uncertaintySpread ? 'Yes' : 'No'}
          note={`half-spread ${fmt(rd.spreadRound1, 2)} in round 1 → ${fmt(rd.spreadRound4, 2)} in round 4`}
        />
        <StatTile
          label="Widens its spread after one-sided flow?"
          value={rd.adverseSelection ? 'Yes' : 'No'}
          note={`half-spread ${fmt(rd.spreadAfterNetSelling, 2)} after net selling, ${fmt(rd.spreadAtBalancedFlow, 2)} balanced, ${fmt(rd.spreadAfterNetBuying, 2)} after net buying`}
        />
        <StatTile
          label="Moves its centre with the order flow?"
          value={rd.flowFollowing ? 'Yes' : 'No'}
          note={`${signed(rd.jointOffsetAfterNetBuying, 1)} after 8 net bot buys, ${signed(rd.jointOffsetAfterNetSelling, 1)} after 8 net sells`}
        />
        <StatTile
          label="Fidelity of the distilled explanation"
          value={`R² ${fmt(am.fidelity, 2)}`}
          note={`centre ${fmt(am.distilled.r2Offset, 2)}, half-spread ${fmt(am.distilled.r2HalfSpread, 2)}`}
        />
      </div>

      <div className="research__grid">
        <ChartFrame
          title="Training curves"
          subtitle={`Objective of the CEM mean policy per iteration (${s.population} candidates × ${s.gamesPerEvaluation} games, top ${s.elites} kept, λ = ${s.lambda}); ${s.seeds} seeds each, best seed in bold`}
          conclusion={
            <p>
              On {s.validationGames.toLocaleString()} held-out validation games the best linear policy scores{' '}
              {fmt(lin.best.valObjective, 2)} (P&amp;L {fmt(lin.best.valPnl, 1)}, spread{' '}
              {fmt(lin.best.valSpread, 1)}) and the best MLP {fmt(mlp.best.valObjective, 2)} (P&amp;L{' '}
              {fmt(mlp.best.valPnl, 1)}, spread {fmt(mlp.best.valSpread, 1)}). Expert mode uses the{' '}
              {d.chosen === 'mlp' ? 'MLP' : 'linear policy'}.
            </p>
          }
          table={
            <table className="data">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th className="num">Seed</th>
                  <th className="num">Validation objective</th>
                  <th className="num">P&amp;L</th>
                  <th className="num">Mean q²</th>
                  <th className="num">Spread</th>
                </tr>
              </thead>
              <tbody>
                {(['linear', 'mlp'] as const).flatMap((v) =>
                  d.variants[v].runs.map((r) => (
                    <tr key={`${v}${r.seed}`}>
                      <td>{VARIANT_LABEL[v]}</td>
                      <td className="num">
                        {r.seed}
                        {r.seed === d.variants[v].best.seed ? ' (best)' : ''}
                      </td>
                      <td className="num">{fmt(r.valObjective, 2)}</td>
                      <td className="num">{fmt(r.valPnl, 2)}</td>
                      <td className="num">{fmt(r.valMsq, 1)}</td>
                      <td className="num">{fmt(r.valSpread, 2)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          }
        >
          <div className="research__pair">
            <Curves v={lin} c={c} name={VARIANT_LABEL.linear} />
            <Curves v={mlp} c={c} name={VARIANT_LABEL.mlp} />
          </div>
        </ChartFrame>
        <FeatureBars
          names={n}
          values={lin.best.params.slice(0, n.length)}
          c={c}
          title="Linear policy: what moves the centre"
          subtitle="Weights on the centre offset; features are scaled to about −1…1 (inventory ÷ 10, imbalance ÷ window, …)"
        />
      </div>

      <div className="research__grid research__grid--3">
        <PdpChart
          data={am.pdp.offsetVsInventory}
          y="offset"
          c={c}
          title="Centre offset vs inventory"
          xLabel="inventory (units)"
          reference={{
            label: `analytical −γ·Var·q (Var ${fmt(meanVar, 0)})`,
            f: (x) => -DEFAULT_GAMMA * meanVar * x,
          }}
        />
        <PdpChart
          data={am.pdp.halfSpreadVsImbalance}
          y="halfSpread"
          c={c}
          title="Half-spread vs order-flow imbalance"
          xLabel="net bot buys, last 8 steps"
        />
        <FlowChart joint={am.pdp.offsetVsFlowJoint} fixed={am.pdp.offsetVsImbalance} c={c} />
        <PdpChart
          data={am.pdp.halfSpreadVsRound}
          y="halfSpread"
          c={c}
          title="Half-spread vs round"
          xLabel="round"
        />
        <FeatureBars
          names={n}
          values={am.importance.map((x) => x.offset)}
          c={c}
          title="Permutation importance: centre"
          subtitle="Mean change in the MLP’s centre offset when one feature is shuffled. Round and cards revealed always move together (cards revealed = round − 1), so how the effect splits between them is not meaningful."
        />
        <FeatureBars
          names={n}
          values={am.importance.map((x) => x.halfSpread)}
          c={c}
          title="Permutation importance: half-spread"
          subtitle="Mean change in the MLP’s half-spread when one feature is shuffled (round and cards revealed: see left)."
        />
      </div>

      <div className="ticket chart__conclusion research__conclusion">
        <p>
          <strong>Inventory skew: {rd.inventorySkew ? 'rediscovered' : 'not found'}.</strong> The distilled
          model moves the centre by{' '}
          {am.inventoryComparison.map((r) => signed(r.learnedPerUnit, 2)).join(', ')} per unit of inventory
          with 0, 1, 2 and 3 cards revealed; the analytical market maker’s −γ·Var skew is{' '}
          {am.inventoryComparison.map((r) => signed(r.analyticalPerUnit, 2)).join(', ')}. They agree in sign
          and are close at the start, but the learned skew barely shrinks as uncertainty falls, so it leans on
          its inventory harder than the analytical rule late in the game. Its partial-dependence curve also
          flattens at large positions, which a linear rule cannot do.
        </p>
        <p>
          <strong>Spread and uncertainty: {rd.uncertaintySpread ? 'rediscovered' : 'not found'}.</strong> Its
          half-spread falls from {fmt(rd.spreadRound1, 2)} in round 1 to {fmt(rd.spreadRound4, 2)} in round 4,
          like the analytical risk spread c·γ·Var and the Glosten–Milgrom spread, which both shrink as cards
          are revealed.
        </p>
        <p>
          <strong>
            Adverse-selection widening: {rd.adverseSelection ? 'rediscovered' : 'not rediscovered'}.
          </strong>{' '}
          A Glosten–Milgrom market maker widens after one-sided flow in either direction. This policy is
          asymmetric: {fmt(rd.spreadAfterNetSelling, 2)} after net selling and{' '}
          {fmt(rd.spreadAfterNetBuying, 2)} after net buying, against {fmt(rd.spreadAtBalancedFlow, 2)} when
          flow is balanced. It protects itself mainly by moving its centre: on a realistic path, where each
          bot trade also changes its inventory, the centre ends {signed(rd.jointOffsetAfterNetBuying, 1)}{' '}
          after 8 net buys and {signed(rd.jointOffsetAfterNetSelling, 1)} after 8 net sells.{' '}
          {!rd.flowFollowingHoldingInventory &&
            'With inventory held fixed, the order-flow features alone push the other way: the flow signal is carried by the inventory feature, because bot buying is exactly what makes it short. Partial dependence on one of two correlated features can mislead, which is why the joint curve is shown as well.'}
        </p>
        <p>
          <strong>Faithfulness of its explanations:</strong> the linear model distilled from the MLP
          reproduces its centre with R² {fmt(am.distilled.r2Offset, 2)} and its half-spread with R²{' '}
          {fmt(am.distilled.r2HalfSpread, 2)}. Expert-mode reviews show that distilled explanation, labelled
          with this fidelity.
        </p>
      </div>
    </>
  );
}
