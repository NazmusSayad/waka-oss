import { useMemo, useState } from "react";
import clsx from "clsx";
import type { ActivityRow } from "../api";
import { Chart } from "../Chart";
import {
  bucketOf,
  bucketsFor,
  colorFor,
  dimensionLabels,
  dimensions,
  formatBucket,
  formatDuration,
  formatPercent,
  granularityFor,
  groupSum,
  hoursAxis,
  label,
  otherColor,
  sortedEntries,
  sum,
  type Dimension,
  type Range,
} from "../lib";
import { BarList, Empty, Panel } from "../ui";

type Slice = { key: string | null; other: boolean; seconds: number };

function topSlices(entries: [string | null, number][], limit: number): Slice[] {
  const top = entries.slice(0, limit).map((entry) => ({ key: entry[0], other: false, seconds: entry[1] }));
  const rest = entries.slice(limit);
  if (rest.length === 0) {
    return top;
  }
  return [...top, { key: null, other: true, seconds: sum(rest, (entry) => entry[1]) }];
}

function sliceName(slice: Slice) {
  return slice.other ? "Other" : label(slice.key);
}

function sliceColor(slice: Slice) {
  return slice.other ? otherColor : colorFor(slice.key);
}

function nodeLabel(name: string) {
  return name.slice(name.indexOf(":") + 1);
}

function sankey(rows: ActivityRow[]) {
  const projects = sortedEntries(groupSum(rows, (row) => row.project, (row) => row.seconds))
    .slice(0, 10)
    .map((entry) => entry[0]);
  const languages = sortedEntries(groupSum(rows, (row) => row.language, (row) => row.seconds))
    .slice(0, 10)
    .map((entry) => entry[0]);
  const nodes: { name: string; dimension: Dimension | null; key: string | null }[] = [];
  const links = new Map<string, { source: string; target: string; value: number }>();
  function nodeName(dimension: Dimension, value: string | null, isTop: boolean) {
    const name = isTop ? `${dimension}:${label(value)}` : `${dimension}:Other`;
    if (!nodes.some((node) => node.name === name)) {
      nodes.push({ name, dimension: isTop ? dimension : null, key: value });
    }
    return name;
  }
  function addLink(source: string, target: string, value: number) {
    const id = `${source}→${target}`;
    const existing = links.get(id);
    if (existing === undefined) {
      links.set(id, { source, target, value });
      return;
    }
    existing.value += value;
  }
  for (const row of rows) {
    if (row.seconds <= 0) {
      continue;
    }
    const project = nodeName("project", row.project, projects.includes(row.project));
    const language = nodeName("language", row.language, languages.includes(row.language));
    const category = nodeName("category", row.category, true);
    addLink(project, language, row.seconds);
    addLink(language, category, row.seconds);
  }
  return { nodes, links: [...links.values()] };
}

export function Explore(props: {
  rows: ActivityRow[];
  previousRows: ActivityRow[];
  range: Range;
  compare: boolean;
  onFilter: (dimension: Dimension, value: string | null) => void;
}) {
  const [dimension, setDimension] = useState<Dimension>("project");

  const breakdown = useMemo(() => {
    const entries = sortedEntries(groupSum(props.rows, (row) => row[dimension], (row) => row.seconds));
    const previous = groupSum(props.previousRows, (row) => row[dimension], (row) => row.seconds);
    const total = sum(entries, (entry) => entry[1]);
    const slices = topSlices(entries, 8);
    const topKeys = slices.filter((slice) => !slice.other).map((slice) => slice.key);
    const granularity = granularityFor(props.range);
    const buckets = bucketsFor(props.range, granularity);
    const donut = {
      tooltip: {
        trigger: "item",
        formatter: (params: { name: string; value: number }) => `${params.name}<br/><b>${formatDuration(params.value)}</b> · ${formatPercent(params.value, total)}`,
      },
      series: [
        {
          type: "pie",
          radius: ["58%", "88%"],
          padAngle: 1,
          itemStyle: { borderRadius: 3 },
          label: { show: false },
          data: slices.map((slice) => ({ name: sliceName(slice), value: slice.seconds, itemStyle: { color: sliceColor(slice) } })),
        },
      ],
    };
    const area = {
      grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, type: "scroll" },
      tooltip: { trigger: "axis", valueFormatter: (value: number) => formatDuration(value) },
      xAxis: { type: "category", boundaryGap: false, data: buckets.map((bucket) => formatBucket(bucket, granularity)) },
      yAxis: hoursAxis(Math.max(0, ...groupSum(props.rows, (row) => bucketOf(row, granularity), (row) => row.seconds).values())),
      series: slices.map((slice) => {
        const totals = groupSum(
          props.rows.filter((row) => (slice.other ? !topKeys.includes(row[dimension]) : row[dimension] === slice.key)),
          (row) => bucketOf(row, granularity),
          (row) => row.seconds,
        );
        return {
          type: "line",
          name: sliceName(slice),
          stack: "total",
          color: sliceColor(slice),
          symbol: "none",
          triggerLineEvent: true,
          lineStyle: { width: 1 },
          areaStyle: { opacity: 0.55 },
          data: buckets.map((bucket) => totals.get(bucket) ?? 0),
        };
      }),
    };
    return {
      total,
      slices,
      granularity,
      items: entries.map((entry) => ({ key: entry[0], seconds: entry[1], previous: props.compare ? (previous.get(entry[0]) ?? 0) : null })),
      donut,
      area,
    };
  }, [props.rows, props.previousRows, props.range, props.compare, dimension]);

  const flow = useMemo(() => {
    const graph = sankey(props.rows);
    return {
      nodes: graph.nodes,
      option: {
        tooltip: {
          trigger: "item",
          formatter: (params: { dataType: string; name: string; value: number; data: { source?: string; target?: string } }) =>
            params.dataType === "edge"
              ? `${nodeLabel(params.data.source ?? "")} → ${nodeLabel(params.data.target ?? "")}<br/><b>${formatDuration(params.value)}</b>`
              : `${nodeLabel(params.name)}<br/><b>${formatDuration(params.value)}</b>`,
        },
        series: [
          {
            type: "sankey",
            left: 8,
            right: 140,
            top: 8,
            bottom: 8,
            nodeGap: 10,
            nodeWidth: 12,
            emphasis: { focus: "adjacency" },
            lineStyle: { color: "gradient", opacity: 0.25, curveness: 0.5 },
            label: { color: "#d4d4d8", fontSize: 11, formatter: (params: { name: string }) => nodeLabel(params.name) },
            data: graph.nodes.map((node) => ({
              name: node.name,
              itemStyle: { color: node.dimension === null ? otherColor : colorFor(node.key), borderWidth: 0 },
            })),
            links: graph.links,
          },
        ],
      },
    };
  }, [props.rows]);

  if (props.rows.length === 0) {
    return <Empty title="No activity in this range">Try a longer range or remove some filters.</Empty>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-zinc-500">Break down by</span>
        <div className="flex rounded-md border border-zinc-800 p-0.5">
          {dimensions.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setDimension(item)}
              className={clsx("rounded px-2.5 py-1 text-xs", dimension === item ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-200")}
            >
              {dimensionLabels[item]}
            </button>
          ))}
        </div>
      </div>

      <Panel title={`Share by ${dimensionLabels[dimension].toLowerCase()}`} subtitle={`${breakdown.items.length} distinct · click to filter`}>
        <div className="grid items-start gap-6 md:grid-cols-[260px_1fr]">
          <div className="relative">
            <Chart
              option={breakdown.donut}
              height={260}
              onClick={(event) => {
                const slice = breakdown.slices[event.dataIndex];
                if (slice !== undefined && !slice.other) {
                  props.onFilter(dimension, slice.key);
                }
              }}
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-semibold text-zinc-50 tabular-nums">{formatDuration(breakdown.total)}</span>
              <span className="text-[11px] text-zinc-500">total</span>
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            <BarList items={breakdown.items} total={breakdown.total} limit={50} colored onSelect={(key) => props.onFilter(dimension, key)} />
          </div>
        </div>
      </Panel>

      <Panel title="Over time" subtitle={`Per ${breakdown.granularity} · top 8 stacked`}>
        <Chart
          option={breakdown.area}
          height={300}
          onClick={(event) => {
            const slice = breakdown.slices[event.seriesIndex ?? -1];
            if (slice !== undefined && !slice.other) {
              props.onFilter(dimension, slice.key);
            }
          }}
        />
      </Panel>

      <Panel title="Project → language → category" subtitle="Top 10 projects and languages · click a node to filter">
        <Chart
          option={flow.option}
          height={Math.max(320, flow.nodes.length * 18)}
          onClick={(event) => {
            const node = flow.nodes[event.dataIndex];
            if (event.dataType === "node" && node !== undefined && node.dimension !== null) {
              props.onFilter(node.dimension, node.key);
            }
          }}
        />
      </Panel>
    </div>
  );
}
