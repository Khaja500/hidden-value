import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartFrame, StatTile } from '../components/charts';
import { axisProps, ci, MM_LABEL, tooltipStyle, useChartColors } from '../components/chartUtils';
import type { MMKind } from '../engine/types';
import { fmt, signed } from '../explain/render';
import type { SandboxRequest, SandboxResult } from '../sim/sandbox';
import { callWorker } from '../workers/client';

/** Market makers selectable in the Sandbox. */
const SANDBOX_MMS: MMKind[] = ['naive', 'analytical'];
const PARTICLES = 2000;

function histogram(xs: number[], bins = 16) {
  const lo = Math.floor(Math.min(...xs));
  const hi = Math.ceil(Math.max(...xs));
  const w = Math.max(1, Math.ceil((hi - lo) / bins));
  const out = Array.from({ length: Math.ceil((hi - lo + 1) / w) }, (_, i) => ({
    from: lo + i * w,
    to: lo + (i + 1) * w,
    n: 0,
  }));
  for (const x of xs) out[Math.min(out.length - 1, Math.floor((x - lo) / w))].n++;
  return out.map((b) => ({ ...b, label: `${b.from} to ${b.to}` }));
}

export function Sandbox() {
  const c = useChartColors();
  const [req, setReq] = useState<SandboxRequest>({
    alpha: 0.25,
    mmKind: 'analytical',
    gamma: 0.01,
    games: 100,
    player: 'pass',
    dealSet: 1,
    particles: PARTICLES,
  });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [runs, setRuns] = useState<SandboxResult[]>([]);
  const latest = runs[0];

  useEffect(() => {
    document.title = 'Sandbox · Hidden Value';
  }, []);

  const run = async () => {
    setRunning(true);
    setProgress(0);
    try {
      const r = await callWorker<SandboxResult>('sandbox', req, (d, t) => setProgress(d / t));
      setRuns((rs) => [r, ...rs].slice(0, 12));
    } finally {
      setRunning(false);
    }
  };
  const set = (patch: Partial<SandboxRequest>) => setReq((r) => ({ ...r, ...patch }));

  return (
    <main id="main" className="page sandbox">
      <h1>Sandbox</h1>
      <p className="lede">
        Run your own simulations: pick how many traders are informed, which market maker quotes, and who
        plays. Games run in a background worker, so the page stays responsive.
      </p>

      <section className="ticket sandbox__controls" aria-label="Simulation settings">
        <label>
          <span>
            Informed share α <strong className="mono">{Math.round(req.alpha * 100)}%</strong>
          </span>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.05}
            value={req.alpha}
            onChange={(e) => set({ alpha: Number(e.target.value) })}
          />
        </label>
        <label>
          <span>Market maker</span>
          <select value={req.mmKind} onChange={(e) => set({ mmKind: e.target.value as MMKind })}>
            {SANDBOX_MMS.map((m) => (
              <option key={m} value={m}>
                {MM_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            Risk aversion γ {req.mmKind !== 'analytical' && <span className="muted">(analytical only)</span>}
          </span>
          <select
            value={req.gamma}
            disabled={req.mmKind !== 'analytical'}
            onChange={(e) => set({ gamma: Number(e.target.value) })}
          >
            {[0, 0.0025, 0.005, 0.01, 0.02, 0.04].map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Player</span>
          <select
            value={req.player}
            onChange={(e) => set({ player: e.target.value as SandboxRequest['player'] })}
          >
            <option value="pass">Nobody (always passes)</option>
            <option value="advisor">Advisor bot</option>
          </select>
        </label>
        <label>
          <span>Games</span>
          <input
            type="number"
            min={10}
            max={500}
            step={10}
            value={req.games}
            onChange={(e) => set({ games: Math.max(10, Math.min(500, Number(e.target.value) || 100)) })}
          />
        </label>
        <label>
          <span>Deal set</span>
          <input
            type="number"
            min={1}
            max={999}
            value={req.dealSet}
            onChange={(e) => set({ dealSet: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
        <div className="sandbox__run">
          <button
            type="button"
            className="btn btn--primary"
            onClick={run}
            disabled={running}
            data-testid="run-sandbox"
          >
            {running ? `Running… ${Math.round(progress * 100)}%` : 'Run simulation'}
          </button>
          <p className="muted">
            Same deal set = same cards and bots, so changing one setting is a fair comparison. Filters use{' '}
            {PARTICLES.toLocaleString()} particles here for speed.
          </p>
        </div>
      </section>

      {!latest ? (
        <p className="empty">Choose settings and press “Run simulation”. Results appear here.</p>
      ) : (
        <>
          <div className="stats" aria-live="polite">
            <StatTile
              label="Market maker P&L per game"
              value={ci(latest.mmPnl.mean, latest.mmPnl.ci95)}
              note="mean ± 95% CI"
            />
            <StatTile label="Average spread" value={fmt(latest.spread, 2)} />
            <StatTile label="Lost to informed traders" value={fmt(latest.lossToInformed)} note="per game" />
            <StatTile
              label="Average |inventory|"
              value={fmt(latest.meanAbsInventory, 2)}
              note={`max ${fmt(latest.maxAbsInventory, 1)} per game`}
            />
            {latest.playerPnl && (
              <StatTile
                label="Advisor bot P&L"
                value={ci(latest.playerPnl.mean, latest.playerPnl.ci95)}
                note={`${fmt(latest.playerTrades, 1)} trades per game`}
              />
            )}
          </div>

          <div className="sandbox__charts">
            <ChartFrame
              title="Market maker P&L per game"
              subtitle={`${latest.request.games} games · ${MM_LABEL[latest.request.mmKind]} · α ${Math.round(latest.request.alpha * 100)}%`}
              table={
                <table className="data">
                  <thead>
                    <tr>
                      <th>P&amp;L range</th>
                      <th className="num">Games</th>
                    </tr>
                  </thead>
                  <tbody>
                    {histogram(latest.mmPnls).map((b) => (
                      <tr key={b.from}>
                        <td>{b.label}</td>
                        <td className="num">{b.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={histogram(latest.mmPnls)} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="from" {...axisProps(c)} />
                  <YAxis {...axisProps(c)} allowDecimals={false} width={36} />
                  <Tooltip
                    {...tooltipStyle(c)}
                    formatter={(v) => [v, 'games']}
                    labelFormatter={(_l, p) => `P&L ${p?.[0]?.payload?.label ?? ''}`}
                  />
                  <Bar dataKey="n" fill={c[latest.request.mmKind]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>

            <ChartFrame
              title="Where the market maker’s P&L came from"
              subtitle="Mean per game; the four parts add up to its total P&L"
              table={
                <table className="data">
                  <tbody>
                    {Object.entries(latest.attribution).map(([k, v]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td className="num">{signed(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  layout="vertical"
                  data={[
                    { k: 'Spread capture', v: latest.attribution.spreadCapture },
                    { k: 'Informed traders', v: latest.attribution.adverseSelection },
                    { k: 'Inventory drift', v: latest.attribution.inventory },
                    { k: 'Player', v: latest.attribution.player },
                  ]}
                  margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                >
                  <CartesianGrid stroke={c.grid} horizontal={false} />
                  <XAxis type="number" {...axisProps(c)} />
                  <YAxis type="category" dataKey="k" {...axisProps(c)} width={120} />
                  <ReferenceLine x={0} stroke={c.axis} />
                  <Tooltip {...tooltipStyle(c)} formatter={(v) => [signed(Number(v)), 'per game']} />
                  <Bar dataKey="v" radius={4}>
                    {[0, 1, 2, 3].map((i) => (
                      <Cell key={i} fill={c[latest.request.mmKind]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          </div>

          <section className="ticket">
            <h2 className="stamp">Your runs</h2>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Market maker</th>
                    <th className="num">α</th>
                    <th className="num">γ</th>
                    <th>Player</th>
                    <th className="num">Games</th>
                    <th className="num">MM P&amp;L</th>
                    <th className="num">Spread</th>
                    <th className="num">Lost to informed</th>
                    <th className="num">Player P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={i}>
                      <td>{MM_LABEL[r.request.mmKind]}</td>
                      <td className="num">{Math.round(r.request.alpha * 100)}%</td>
                      <td className="num">{r.request.mmKind === 'analytical' ? r.request.gamma : '—'}</td>
                      <td>{r.request.player === 'advisor' ? 'Advisor bot' : 'none'}</td>
                      <td className="num">{r.request.games}</td>
                      <td className="num">{ci(r.mmPnl.mean, r.mmPnl.ci95)}</td>
                      <td className="num">{fmt(r.spread, 2)}</td>
                      <td className="num">{fmt(r.lossToInformed)}</td>
                      <td className="num">{r.playerPnl ? ci(r.playerPnl.mean, r.playerPnl.ci95) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
