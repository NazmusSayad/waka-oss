import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CustomSeriesRenderItemAPI } from "echarts";
import { getJson, type DayHeartbeat, type Status } from "../api";
import { Chart } from "../Chart";
import {
  addDays,
  colorFor,
  formatClock,
  formatDate,
  formatDuration,
  groupSum,
  label,
  matchesFilters,
  secondsIntoDay,
  sortedEntries,
  sum,
  type Dimension,
  type Filter,
} from "../lib";
import { Empty, Panel, Stat, StatStrip, UnappliedFilters } from "../ui";

type Row = { kind: "sessions" | "project" | "file"; name: string; project: string | null };
type Segment = { row: number; start: number; end: number; color: string; opacity: number; title: string; detail: string };

const rowHeight = 24;
const filesPerProject = 8;

function shortPath(path: string) {
  return path.split(/[\\/]/).filter((part) => part !== "").slice(-2).join("/");
}

function richSafe(text: string) {
  return text.replace(/[{}|]/g, "");
}

function build(heartbeats: DayHeartbeat[], timeZone: string) {
  const projectTotals = sortedEntries(groupSum(heartbeats, (heartbeat) => heartbeat.project, (heartbeat) => heartbeat.duration));
  const rows: Row[] = [{ kind: "sessions", name: "Sessions", project: null }];
  const rowIndex = new Map<string, number>();
  let hiddenFiles = 0;
  for (const projectEntry of projectTotals) {
    const project = projectEntry[0];
    rowIndex.set(`project:${project}`, rows.length);
    rows.push({ kind: "project", name: label(project), project });
    const files = sortedEntries(
      groupSum(
        heartbeats.filter((heartbeat) => heartbeat.project === project),
        (heartbeat) => heartbeat.entity,
        (heartbeat) => heartbeat.duration,
      ),
    ).filter((entry) => entry[1] > 0);
    hiddenFiles += Math.max(0, files.length - filesPerProject);
    for (const fileEntry of files.slice(0, filesPerProject)) {
      rowIndex.set(`file:${project}:${fileEntry[0]}`, rows.length);
      rows.push({ kind: "file", name: fileEntry[0], project });
    }
  }

  const segments: Segment[] = [];
  const lastByRow = new Map<number, Segment>();
  function extend(row: number | undefined, heartbeat: DayHeartbeat, color: string, opacity: number, title: string, detail: string) {
    if (row === undefined) {
      return;
    }
    const end = heartbeat.time + heartbeat.duration;
    const last = lastByRow.get(row);
    if (last !== undefined && heartbeat.time - last.end < 1) {
      last.end = Math.max(last.end, end);
      return;
    }
    const segment = { row, start: heartbeat.time, end, color, opacity, title, detail };
    segments.push(segment);
    lastByRow.set(row, segment);
  }

  const sessions: { start: number; end: number; seconds: number }[] = [];
  let previous: DayHeartbeat | null = null;
  for (const heartbeat of heartbeats) {
    const current = sessions[sessions.length - 1];
    if (previous === null || current === undefined || heartbeat.time - previous.time > 900) {
      sessions.push({ start: heartbeat.time, end: heartbeat.time + heartbeat.duration, seconds: heartbeat.duration });
    } else {
      current.end = Math.max(current.end, heartbeat.time + heartbeat.duration);
      current.seconds += heartbeat.duration;
    }
    previous = heartbeat;
    if (heartbeat.duration <= 0) {
      continue;
    }
    const color = colorFor(heartbeat.project);
    extend(rowIndex.get(`project:${heartbeat.project}`), heartbeat, color, 0.9, label(heartbeat.project), "");
    extend(
      rowIndex.get(`file:${heartbeat.project}:${heartbeat.entity}`),
      heartbeat,
      color,
      0.55,
      heartbeat.entity,
      [label(heartbeat.language), heartbeat.branch === null ? null : `on ${heartbeat.branch}`, label(heartbeat.category)]
        .filter((part) => part !== null)
        .join(" · "),
    );
  }

  const breaks: { start: number; end: number }[] = [];
  sessions.forEach((session, index) => {
    segments.push({ row: 0, start: session.start, end: session.end, color: "#38bdf8", opacity: 0.9, title: "Session", detail: `${formatDuration(session.seconds)} coded` });
    const next = sessions[index + 1];
    if (next !== undefined) {
      breaks.push({ start: session.end, end: next.start });
      segments.push({ row: 0, start: session.end, end: next.start, color: "#3f3f46", opacity: 0.6, title: "Break", detail: "" });
    }
  });

  const first = heartbeats[0];
  const last = heartbeats[heartbeats.length - 1];
  const min = first === undefined ? 0 : first.time - (secondsIntoDay(first.time, timeZone) % 3600);
  const lastEnd = last === undefined ? 0 : last.time + last.duration;
  const max = lastEnd + (3600 - (secondsIntoDay(lastEnd, timeZone) % 3600));
  const span = max - min;
  const interval = span <= 8 * 3600 ? 3600 : span <= 16 * 3600 ? 7200 : 10800;

  const option = {
    grid: { left: 8, right: 16, top: 8, height: rows.length * rowHeight, containLabel: true },
    tooltip: {
      trigger: "item",
      formatter: (params: { dataIndex: number }) => {
        const segment = segments[params.dataIndex];
        if (segment === undefined) {
          return "";
        }
        return [
          `<b>${segment.title}</b>`,
          `${formatClock(segment.start, timeZone)} – ${formatClock(segment.end, timeZone)} · ${formatDuration(segment.end - segment.start)}`,
          segment.detail,
        ]
          .filter((line) => line !== "")
          .join("<br/>");
      },
    },
    dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "weakFilter" }],
    xAxis: {
      type: "value",
      position: "top",
      min,
      max,
      interval,
      axisLabel: { formatter: (value: number) => formatClock(value, timeZone) },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((_, index) => String(index)),
      splitLine: { show: true, lineStyle: { color: "#1c1c1f" } },
      axisLabel: {
        formatter: (_: string, index: number) => {
          const row = rows[index];
          if (row === undefined) {
            return "";
          }
          if (row.kind === "file") {
            const name = shortPath(row.name);
            return `{file|${richSafe(name.length > 36 ? `…${name.slice(-35)}` : name)}}`;
          }
          return `{${row.kind}|${richSafe(row.name.length > 28 ? `${row.name.slice(0, 27)}…` : row.name)}}`;
        },
        rich: {
          sessions: { color: "#7dd3fc", fontWeight: 600, fontSize: 11 },
          project: { color: "#e4e4e7", fontWeight: 600, fontSize: 11 },
          file: { color: "#a1a1aa", fontSize: 11 },
        },
      },
    },
    series: [
      {
        type: "custom",
        clip: true,
        renderItem: (params: { dataIndex: number }, api: CustomSeriesRenderItemAPI) => {
          const segment = segments[params.dataIndex];
          const start = api.coord([api.value(1), api.value(0)]);
          const end = api.coord([api.value(2), api.value(0)]);
          if (segment === undefined || start[0] === undefined || start[1] === undefined || end[0] === undefined) {
            return null;
          }
          const height = segment.row === 0 ? 14 : 12;
          return {
            type: "rect",
            shape: { x: start[0], y: start[1] - height / 2, width: Math.max(end[0] - start[0], 1.5), height, r: 2 },
            style: { fill: segment.color, opacity: segment.opacity },
          };
        },
        encode: { x: [1, 2], y: 0 },
        data: segments.map((segment) => [segment.row, segment.start, segment.end]),
      },
    ],
  };

  return { rows, segments, sessions, breaks, hiddenFiles, option, height: rows.length * rowHeight + 40 };
}

export function Timeline(props: {
  status: Status;
  date: string;
  onDateChange: (date: string) => void;
  filters: Filter[];
  onFilter: (dimension: Dimension, value: string | null) => void;
}) {
  const [loaded, setLoaded] = useState<{ key: string; heartbeats: DayHeartbeat[] } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const key = `${props.date}|${props.status.server_time}`;

  useEffect(() => {
    const controller = new AbortController();
    const requestKey = `${props.date}|${props.status.server_time}`;
    async function load() {
      try {
        const response = await getJson<{ heartbeats: DayHeartbeat[] }>(`/api/day?date=${props.date}`, controller.signal);
        setLoaded({ key: requestKey, heartbeats: response.heartbeats });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setFailure({ key: requestKey, message: error instanceof Error ? error.message : String(error) });
      }
    }
    load();
    return () => controller.abort();
  }, [props.date, props.status.server_time]);

  const heartbeats = useMemo(
    () =>
      loaded === null
        ? []
        : loaded.heartbeats.filter((heartbeat) =>
            matchesFilters(props.filters, {
              project: [heartbeat.project],
              language: [heartbeat.language],
              branch: [heartbeat.branch],
              category: [heartbeat.category],
              editor: [heartbeat.editor],
              machine: [heartbeat.machine],
            }),
          ),
    [loaded, props.filters],
  );
  const timeline = useMemo(() => build(heartbeats, props.status.timezone), [heartbeats, props.status.timezone]);

  const loading = loaded?.key !== key && failure?.key !== key;
  const timeZone = props.status.timezone;
  const total = sum(heartbeats, (heartbeat) => heartbeat.duration);
  const first = heartbeats[0];
  const last = heartbeats[heartbeats.length - 1];
  const longestBreak = timeline.breaks.reduce<{ start: number; end: number } | null>(
    (longest, item) => (longest === null || item.end - item.start > longest.end - longest.start ? item : longest),
    null,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Previous day"
          onClick={() => props.onDateChange(addDays(props.date, -1))}
          className="rounded-md border border-zinc-800 p-1.5 text-zinc-400 hover:text-zinc-100"
        >
          <ChevronLeft size={14} />
        </button>
        <input
          type="date"
          value={props.date}
          onChange={(event) => event.target.value !== "" && props.onDateChange(event.target.value)}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
        />
        <button
          type="button"
          aria-label="Next day"
          onClick={() => props.onDateChange(addDays(props.date, 1))}
          className="rounded-md border border-zinc-800 p-1.5 text-zinc-400 hover:text-zinc-100"
        >
          <ChevronRight size={14} />
        </button>
        <span className="ml-2 text-sm text-zinc-200">{formatDate(props.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
        {props.date !== props.status.today && (
          <button type="button" onClick={() => props.onDateChange(props.status.today)} className="ml-2 text-xs text-sky-400 hover:text-sky-300">
            Go to today
          </button>
        )}
        {loading && <span className="text-xs text-zinc-500">Loading…</span>}
      </div>

      <UnappliedFilters filters={props.filters} supported={["project", "language", "branch", "category", "editor", "machine"]} source="The day timeline" />

      {failure?.key === key && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">Couldn't load this day: {failure.message}</div>
      )}

      {loaded !== null && heartbeats.length === 0 && failure?.key !== key && <Empty title="No activity on this day" />}

      {heartbeats.length > 0 && first !== undefined && last !== undefined && (
        <>
          <StatStrip>
            <Stat label="Coded" value={formatDuration(total)} detail={`${heartbeats.length} heartbeats`} />
            <Stat label="Day span" value={`${formatClock(first.time, timeZone)} – ${formatClock(last.time + last.duration, timeZone)}`} />
            <Stat label="Sessions" value={timeline.sessions.length} detail={`${timeline.breaks.length} breaks`} />
            <Stat
              label="Longest break"
              value={longestBreak === null ? "—" : formatDuration(longestBreak.end - longestBreak.start)}
              detail={longestBreak === null ? undefined : `${formatClock(longestBreak.start, timeZone)} – ${formatClock(longestBreak.end, timeZone)}`}
            />
            <Stat
              label="Files"
              value={new Set(heartbeats.map((heartbeat) => heartbeat.entity)).size}
              detail={`${heartbeats.filter((heartbeat) => heartbeat.is_write).length} saves`}
            />
            <Stat
              label="Line changes"
              value={sum(heartbeats, (heartbeat) => (heartbeat.human_line_changes ?? 0) + (heartbeat.ai_line_changes ?? 0))}
              detail={`${sum(heartbeats, (heartbeat) => heartbeat.human_line_changes ?? 0)} human · ${sum(heartbeats, (heartbeat) => heartbeat.ai_line_changes ?? 0)} AI`}
            />
          </StatStrip>

          <Panel
            title="Timeline"
            subtitle={`Sessions and breaks, then each project with its top ${filesPerProject} files · scroll to zoom · click a project to filter`}
          >
            <Chart
              option={timeline.option}
              height={timeline.height}
              onClick={(event) => {
                const segment = timeline.segments[event.dataIndex];
                const row = segment === undefined ? undefined : timeline.rows[segment.row];
                if (row !== undefined && row.kind !== "sessions") {
                  props.onFilter("project", row.project);
                }
              }}
            />
            {timeline.hiddenFiles > 0 && <p className="mt-2 text-[11px] text-zinc-500">{timeline.hiddenFiles} smaller files not shown</p>}
          </Panel>

          {timeline.breaks.length > 0 && (
            <Panel title="Breaks" subtitle="Gaps longer than 15 minutes between heartbeats">
              <ul className="flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums">
                {timeline.breaks.map((item) => (
                  <li key={item.start} className="text-zinc-400">
                    {formatClock(item.start, timeZone)} – {formatClock(item.end, timeZone)}{" "}
                    <span className="text-zinc-200">{formatDuration(item.end - item.start)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
