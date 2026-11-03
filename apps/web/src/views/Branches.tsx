import { useMemo } from "react";
import clsx from "clsx";
import type { ActivityRow } from "../api";
import { Chart } from "../Chart";
import { bucketOf, bucketsFor, daysBetween, formatBucket, formatDate, formatDuration, formatNumber, granularityFor, label, type Dimension, type Range } from "../lib";
import { Empty, Panel, Stat, StatStrip } from "../ui";

type Branch = {
  project: string | null;
  branch: string | null;
  seconds: number;
  dates: Map<string, number>;
  writes: number;
  lines: number;
  aiLines: number;
};

export function Branches(props: { rows: ActivityRow[]; range: Range; onFilter: (dimension: Dimension, value: string | null) => void }) {
  const result = useMemo(() => {
    const groups = new Map<string, Branch>();
    for (const row of props.rows) {
      const key = `${row.project}\u0000${row.branch}`;
      let group = groups.get(key);
      if (group === undefined) {
        group = { project: row.project, branch: row.branch, seconds: 0, dates: new Map(), writes: 0, lines: 0, aiLines: 0 };
        groups.set(key, group);
      }
      group.seconds += row.seconds;
      group.writes += row.writes;
      group.lines += row.human_lines;
      group.aiLines += row.ai_lines;
      if (row.seconds > 0) {
        group.dates.set(row.date, (group.dates.get(row.date) ?? 0) + row.seconds);
      }
    }
    const branches = [...groups.values()].filter((branch) => branch.seconds > 0).sort((a, b) => b.seconds - a.seconds);
    const top = branches.slice(0, 15);
    const granularity = granularityFor(props.range) === "hour" ? "day" : granularityFor(props.range);
    const buckets = bucketsFor(props.range, granularity);
    const cells: [number, number, number][] = [];
    top.forEach((branch, branchIndex) => {
      const totals = new Map<string, number>();
      for (const entry of branch.dates) {
        const bucket = bucketOf({ date: entry[0], hour: 0 }, granularity);
        totals.set(bucket, (totals.get(bucket) ?? 0) + entry[1]);
      }
      for (const entry of totals) {
        cells.push([buckets.indexOf(entry[0]), branchIndex, entry[1]]);
      }
    });
    const heatmap = {
      grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        formatter: (params: { value: [number, number, number] }) => {
          const branch = top[params.value[1]];
          const bucket = buckets[params.value[0]] ?? "";
          return branch === undefined
            ? ""
            : `${label(branch.project)} / ${label(branch.branch)}<br/>${formatBucket(bucket, granularity)}: <b>${formatDuration(params.value[2])}</b>`;
        },
      },
      visualMap: { show: false, min: 0, max: Math.max(1, ...cells.map((cell) => cell[2])), inRange: { color: ["#1e1b4b", "#4c1d95", "#7c3aed", "#a78bfa", "#ddd6fe"] } },
      xAxis: { type: "category", data: buckets.map((bucket) => formatBucket(bucket, granularity)), splitArea: { show: false } },
      yAxis: {
        type: "category",
        inverse: true,
        data: top.map((branch) => {
          const name = `${label(branch.branch)} · ${label(branch.project)}`;
          return name.length > 40 ? `${name.slice(0, 39)}…` : name;
        }),
      },
      series: [{ type: "heatmap", data: cells, itemStyle: { borderColor: "#09090b", borderWidth: 1, borderRadius: 2 } }],
    };
    return { branches, top, granularity, heatmap, cells };
  }, [props.rows, props.range]);

  if (result.branches.length === 0) {
    return <Empty title="No activity in this range">Try a longer range or remove some filters.</Empty>;
  }

  const total = result.branches.reduce((sum, branch) => sum + branch.seconds, 0);
  const unknown = result.branches.filter((branch) => branch.branch === null).reduce((sum, branch) => sum + branch.seconds, 0);
  const named = result.branches.filter((branch) => branch.branch !== null);

  return (
    <div className="space-y-4">
      <StatStrip>
        <Stat label="Branches" value={named.length} detail={`across ${new Set(named.map((branch) => branch.project)).size} projects`} />
        <Stat label="Average per branch" value={formatDuration(named.length === 0 ? 0 : (total - unknown) / named.length)} />
        <Stat label="Most time" value={label(result.branches[0]?.branch ?? null)} detail={formatDuration(result.branches[0]?.seconds ?? 0)} />
        <Stat label="Outside a branch" value={formatDuration(unknown)} detail="no git branch reported" />
      </StatStrip>

      <Panel title="Branch activity" subtitle={`Top ${result.top.length} branches · time per ${result.granularity}`}>
        <Chart
          option={result.heatmap}
          height={result.top.length * 24 + 50}
          onClick={(event) => {
            const branch = result.top[result.cells[event.dataIndex]?.[1] ?? -1];
            if (branch !== undefined) {
              props.onFilter("branch", branch.branch);
            }
          }}
        />
      </Panel>

      <Panel title="All branches" subtitle="Time is a rough cost per feature or pull request; dates are limited to the selected range">
        <table className="w-full text-left text-xs">
          <thead className="text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="py-2 pr-4 font-normal">Branch</th>
              <th className="py-2 pr-4 font-normal">Project</th>
              <th className="py-2 pr-4 text-right font-normal">Time</th>
              <th className="py-2 pr-4 text-right font-normal">Active days</th>
              <th className="py-2 pr-4 font-normal">First – last seen</th>
              <th className="py-2 pr-4 text-right font-normal">Span</th>
              <th className="py-2 pr-4 text-right font-normal">Per active day</th>
              <th className="py-2 pr-4 text-right font-normal">Saves</th>
              <th className="py-2 text-right font-normal">Lines (human / AI)</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {result.branches.map((branch) => {
              const dates = [...branch.dates.keys()].sort();
              const first = dates[0] ?? "";
              const last = dates[dates.length - 1] ?? "";
              return (
                <tr key={`${branch.project}\u0000${branch.branch}`} className="border-b border-zinc-800/50 text-zinc-300">
                  <td className="max-w-[280px] truncate py-1.5 pr-4">
                    <button
                      type="button"
                      onClick={() => props.onFilter("branch", branch.branch)}
                      className={clsx("hover:text-sky-300", branch.branch === null && "text-zinc-500 italic", branch.branch !== null && "text-zinc-100")}
                    >
                      {label(branch.branch)}
                    </button>
                  </td>
                  <td className="max-w-[200px] truncate py-1.5 pr-4">
                    <button type="button" onClick={() => props.onFilter("project", branch.project)} className="hover:text-sky-300">
                      {label(branch.project)}
                    </button>
                  </td>
                  <td className="py-1.5 pr-4 text-right text-zinc-100">{formatDuration(branch.seconds)}</td>
                  <td className="py-1.5 pr-4 text-right">{dates.length}</td>
                  <td className="py-1.5 pr-4 whitespace-nowrap text-zinc-400">
                    {first === last
                      ? formatDate(first, { month: "short", day: "numeric", year: "numeric" })
                      : `${formatDate(first, { month: "short", day: "numeric" })} – ${formatDate(last, { month: "short", day: "numeric", year: "numeric" })}`}
                  </td>
                  <td className="py-1.5 pr-4 text-right">{daysBetween(first, last) + 1}d</td>
                  <td className="py-1.5 pr-4 text-right">{formatDuration(dates.length === 0 ? 0 : branch.seconds / dates.length)}</td>
                  <td className="py-1.5 pr-4 text-right">{formatNumber(branch.writes)}</td>
                  <td className="py-1.5 text-right">
                    {formatNumber(branch.lines)} <span className="text-zinc-500">/ {formatNumber(branch.aiLines)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
