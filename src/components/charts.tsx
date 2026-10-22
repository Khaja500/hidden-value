/** Chart frame, stat tile and "not run yet" notice for the Research and Sandbox pages. */
import type { ReactNode } from 'react';

interface FrameProps {
  title: string;
  /** One-line description of what is plotted. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** The written conclusion under the chart. */
  conclusion?: ReactNode;
  /** Table-view twin of the chart: every value readable without the chart. */
  table?: ReactNode;
  id?: string;
}

export function ChartFrame({ title, subtitle, children, conclusion, table, id }: FrameProps) {
  return (
    <figure className="chart ticket" id={id}>
      <figcaption className="chart__head">
        <h3 className="chart__title">{title}</h3>
        {subtitle && <p className="chart__subtitle muted">{subtitle}</p>}
      </figcaption>
      <div className="chart__body">{children}</div>
      {conclusion && <div className="chart__conclusion">{conclusion}</div>}
      {table && (
        <details className="chart__table">
          <summary>Show the numbers as a table</summary>
          <div className="table-wrap">{table}</div>
        </details>
      )}
    </figure>
  );
}

export function NotRun({ file, command }: { file: string; command: string }) {
  return (
    <p className="empty">
      No results in <span className="mono">public/{file}</span> yet. Generate them with{' '}
      <span className="mono">{command}</span>.
    </p>
  );
}

export function StatTile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {note && <div className="stat__note muted">{note}</div>}
    </div>
  );
}
