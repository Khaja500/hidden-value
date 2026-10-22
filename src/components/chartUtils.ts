/** Chart helpers shared by the Research and Sandbox pages (hooks and constants; components live in charts.tsx). */
import { useEffect, useState } from 'react';
import type { MMKind } from '../engine/types';

export interface ChartColors {
  naive: string;
  analytical: string;
  learned: string;
  grid: string;
  axis: string;
  ink: string;
  muted: string;
  surface: string;
  buy: string;
  sell: string;
  brass: string;
}

function readColors(): ChartColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    naive: v('--series-naive'),
    analytical: v('--series-analytical'),
    learned: v('--series-learned'),
    grid: v('--chart-grid'),
    axis: v('--chart-axis'),
    ink: v('--ink'),
    muted: v('--muted'),
    surface: v('--surface'),
    buy: v('--buy'),
    sell: v('--sell'),
    brass: v('--brass'),
  };
}

/** Colours follow the active theme (system preference or the theme toggle). */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const update = () => setColors(readColors());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', update);
      obs.disconnect();
    };
  }, []);
  return colors;
}

export const MM_LABEL: Record<MMKind, string> = {
  naive: 'Naive',
  analytical: 'Analytical',
  learned: 'Learned',
};

export function seriesColor(c: ChartColors, mm: MMKind): string {
  return c[mm];
}

export const axisProps = (c: ChartColors) => ({
  stroke: c.axis,
  tick: { fill: c.muted, fontSize: 12, fontFamily: 'var(--font-mono)' },
  tickLine: false,
});

export const tooltipStyle = (c: ChartColors) => ({
  contentStyle: {
    background: c.surface,
    border: `1px solid ${c.grid}`,
    borderRadius: 8,
    fontFamily: 'var(--font-ui)',
    fontSize: 13,
    color: c.ink,
  },
  labelStyle: { color: c.muted, fontWeight: 600 },
});

export type Loaded<T> = { state: 'loading' } | { state: 'missing'; file: string } | { state: 'ok'; data: T };

/** Loads public/<path> (simulation output). */
export function useJson<T>(path: string): Loaded<T> {
  const [res, setRes] = useState<Loaded<T>>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.BASE_URL}${path}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: T) => live && setRes({ state: 'ok', data: d }))
      .catch(() => live && setRes({ state: 'missing', file: path }));
    return () => {
      live = false;
    };
  }, [path]);
  return res;
}

export function ci(mean: number, half: number, digits = 1): string {
  const m = mean.toFixed(digits).replace('-', '−');
  return `${m} ± ${half.toFixed(digits)}`;
}
