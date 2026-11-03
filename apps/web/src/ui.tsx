import type { ReactNode } from "react";
import clsx from "clsx";
import { colorFor, dimensionLabels, formatDuration, formatPercent, label, type Dimension, type Filter } from "./lib";

export function Panel(props: { title: string; subtitle?: string; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={clsx("rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4", props.className)}>
      <header className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-zinc-100">{props.title}</h2>
          {props.subtitle !== undefined && <p className="mt-0.5 text-xs text-zinc-500">{props.subtitle}</p>}
        </div>
        {props.actions}
      </header>
      {props.children}
    </section>
  );
}

export function Delta(props: { current: number; previous: number; format: (value: number) => string }) {
  const difference = props.current - props.previous;
  if (difference === 0) {
    return <span className="text-zinc-500">no change</span>;
  }
  const sign = difference > 0 ? "+" : "−";
  return (
    <span className={clsx("tabular-nums", difference > 0 && "text-emerald-400", difference < 0 && "text-rose-400")}>
      {sign}
      {props.format(Math.abs(difference))}
      {props.previous > 0 && ` (${sign}${formatPercent(Math.abs(difference), props.previous)})`}
    </span>
  );
}

export type BarItem = { key: string | null; seconds: number; previous: number | null };

export function BarList(props: { items: BarItem[]; total: number; limit: number; colored: boolean; onSelect: (key: string | null) => void }) {
  const visible = props.items.slice(0, props.limit);
  const max = visible[0]?.seconds ?? 0;
  if (visible.length === 0) {
    return <p className="py-6 text-center text-xs text-zinc-500">Nothing here</p>;
  }
  return (
    <ul className="space-y-0.5">
      {visible.map((item) => (
        <li key={item.key ?? "\u0000"}>
          <button
            type="button"
            onClick={() => props.onSelect(item.key)}
            className="group relative flex w-full items-center gap-3 rounded px-2 py-1 text-left text-xs hover:bg-zinc-800/60"
          >
            <span
              className="absolute inset-y-0.5 left-0 rounded-sm opacity-20 group-hover:opacity-30"
              style={{ width: `${max === 0 ? 0 : (item.seconds / max) * 100}%`, background: props.colored ? colorFor(item.key) : "#60a5fa" }}
            />
            <span className={clsx("relative min-w-0 flex-1 truncate", item.key === null ? "text-zinc-500 italic" : "text-zinc-200")}>
              {label(item.key)}
            </span>
            <span className="relative w-10 text-right text-zinc-500 tabular-nums">{formatPercent(item.seconds, props.total)}</span>
            <span className="relative w-16 text-right text-zinc-200 tabular-nums">{formatDuration(item.seconds)}</span>
            {item.previous !== null && (
              <span className="relative w-28 text-right text-[11px] whitespace-nowrap">
                <Delta current={item.seconds} previous={item.previous} format={formatDuration} />
              </span>
            )}
          </button>
        </li>
      ))}
      {props.items.length > props.limit && (
        <li className="px-2 pt-1 text-[11px] text-zinc-500">
          +{props.items.length - props.limit} more · {formatDuration(props.items.slice(props.limit).reduce((total, item) => total + item.seconds, 0))}
        </li>
      )}
    </ul>
  );
}

export function Empty(props: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 px-6 py-16 text-center">
      <p className="text-sm text-zinc-300">{props.title}</p>
      {props.children !== undefined && <div className="mt-2 max-w-md text-xs text-zinc-500">{props.children}</div>}
    </div>
  );
}

export function UnappliedFilters(props: { filters: Filter[]; supported: Dimension[]; source: string }) {
  const unapplied = [...new Set(props.filters.map((filter) => filter.dimension))].filter(
    (dimension) => !props.supported.includes(dimension),
  );
  if (unapplied.length === 0) {
    return null;
  }
  return (
    <p className="text-[11px] text-amber-400/80">
      {props.source} can't be filtered by {unapplied.map((dimension) => dimensionLabels[dimension].toLowerCase()).join(", ")}; those filters are
      ignored here.
    </p>
  );
}

export function Stat(props: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="text-[11px] tracking-wide text-zinc-500 uppercase">{props.label}</div>
      <div className="mt-1 truncate text-xl font-semibold text-zinc-50 tabular-nums">{props.value}</div>
      {props.detail !== undefined && <div className="mt-0.5 text-xs text-zinc-500">{props.detail}</div>}
    </div>
  );
}

export function StatStrip(props: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 divide-zinc-800 rounded-lg border border-zinc-800/80 bg-zinc-900/40 sm:grid-cols-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none lg:divide-x">
      {props.children}
    </div>
  );
}
