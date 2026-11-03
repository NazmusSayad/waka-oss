import { useMemo } from "react";
import type { ActivityRow, Session, Status } from "../api";
import { Chart } from "../Chart";
import {
  addDays,
  datesInRange,
  formatClock,
  formatDate,
  formatDuration,
  formatHourOfDay,
  groupSum,
  hoursAxis,
  label,
  secondsIntoDay,
  sum,
  weekdayIndex,
  weekdayNames,
  type Filter,
  type Range,
} from "../lib";
import { Empty, Panel, Stat, StatStrip, UnappliedFilters } from "../ui";

const heatColors = ["#0c2a3f", "#0c4a6e", "#0369a1", "#0ea5e9", "#7dd3fc"];

const lengthBuckets = [
  { label: "<15m", max: 900 },
  { label: "15–30m", max: 1800 },
  { label: "30m–1h", max: 3600 },
  { label: "1–2h", max: 7200 },
  { label: "2–4h", max: 14400 },
  { label: "4h+", max: Number.POSITIVE_INFINITY },
];

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function streaks(dayTotals: Map<string, number>, range: Range, today: string) {
  let longest = { length: 0, from: "", to: "" };
  let runLength = 0;
  let runStart = "";
  for (const date of datesInRange(range)) {
    if ((dayTotals.get(date) ?? 0) > 0) {
      runStart = runLength === 0 ? date : runStart;
      runLength += 1;
      if (runLength > longest.length) {
        longest = { length: runLength, from: runStart, to: date };
      }
      continue;
    }
    runLength = 0;
  }
  let cursor = range.to;
  if ((dayTotals.get(cursor) ?? 0) === 0 && cursor === today) {
    cursor = addDays(cursor, -1);
  }
  let current = 0;
  while (cursor >= range.from && (dayTotals.get(cursor) ?? 0) > 0) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { longest, current };
}

export function Patterns(props: {
  status: Status;
  rows: ActivityRow[];
  sessions: Session[];
  range: Range;
  filters: Filter[];
  onOpenDay: (date: string) => void;
}) {
  const timeZone = props.status.timezone;

  const daily = useMemo(() => {
    const dates = datesInRange(props.range);
    const dayTotals = groupSum(props.rows, (row) => row.date, (row) => row.seconds);
    const maxDay = Math.max(0, ...dayTotals.values());
    const years: Range[] = [];
    for (let year = Number(props.range.from.slice(0, 4)); year <= Number(props.range.to.slice(0, 4)); year++) {
      years.push({
        from: props.range.from > `${year}-01-01` ? props.range.from : `${year}-01-01`,
        to: props.range.to < `${year}-12-31` ? props.range.to : `${year}-12-31`,
      });
    }
    const calendarData = years.map((year) =>
      [...dayTotals.entries()].filter((entry) => entry[0] >= year.from && entry[0] <= year.to && entry[1] > 0),
    );
    const calendar = {
      tooltip: {
        formatter: (params: { value: [string, number] }) =>
          `${formatDate(params.value[0], { weekday: "short", month: "short", day: "numeric", year: "numeric" })}<br/><b>${formatDuration(params.value[1])}</b>`,
      },
      visualMap: {
        show: false,
        min: 0,
        max: maxDay === 0 ? 1 : maxDay,
        inRange: { color: heatColors },
      },
      calendar: years.map((year, index) => ({
        top: 24 + index * 150,
        left: 48,
        cellSize: 16,
        range: [year.from, year.to],
        orient: "horizontal",
        splitLine: { show: false },
        itemStyle: { color: "#18181b", borderColor: "#09090b", borderWidth: 3 },
        yearLabel: { show: true, position: "left", color: "#71717a", fontSize: 12 },
        monthLabel: { color: "#a1a1aa", fontSize: 11 },
        dayLabel: { firstDay: 1, color: "#71717a", fontSize: 10, nameMap: ["S", "M", "T", "W", "T", "F", "S"] },
      })),
      series: calendarData.map((data, index) => ({ type: "heatmap", coordinateSystem: "calendar", calendarIndex: index, data })),
    };

    const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
    for (const date of dates) {
      weekdayCounts[weekdayIndex(date)] = (weekdayCounts[weekdayIndex(date)] ?? 0) + 1;
    }
    const grid = new Map<string, number>();
    for (const row of props.rows) {
      const key = `${weekdayIndex(row.date)}:${row.hour}`;
      grid.set(key, (grid.get(key) ?? 0) + row.seconds);
    }
    const gridData = [...grid.entries()].map((entry) => {
      const parts = entry[0].split(":");
      return [Number(parts[1]), Number(parts[0]), entry[1]];
    });
    const hourly = {
      grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        formatter: (params: { value: [number, number, number] }) => {
          const count = weekdayCounts[params.value[1]] ?? 0;
          return `${weekdayNames[params.value[1]]} ${String(params.value[0]).padStart(2, "0")}:00<br/><b>${formatDuration(params.value[2])}</b> total · ${formatDuration(count === 0 ? 0 : params.value[2] / count)} avg`;
        },
      },
      visualMap: { show: false, min: 0, max: Math.max(1, ...grid.values()), inRange: { color: heatColors } },
      xAxis: { type: "category", data: Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0")), splitArea: { show: false } },
      yAxis: { type: "category", data: weekdayNames, inverse: true },
      series: [{ type: "heatmap", data: gridData, itemStyle: { borderColor: "#09090b", borderWidth: 2, borderRadius: 2 } }],
    };

    const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
    for (const entry of dayTotals) {
      weekdayTotals[weekdayIndex(entry[0])] = (weekdayTotals[weekdayIndex(entry[0])] ?? 0) + entry[1];
    }
    const weekdayAverages = weekdayTotals.map((total, index) => {
      const count = weekdayCounts[index] ?? 0;
      return count === 0 ? 0 : total / count;
    });
    const weekdayDays = (weekdayCounts[0] ?? 0) + (weekdayCounts[1] ?? 0) + (weekdayCounts[2] ?? 0) + (weekdayCounts[3] ?? 0) + (weekdayCounts[4] ?? 0);
    const weekendDays = (weekdayCounts[5] ?? 0) + (weekdayCounts[6] ?? 0);
    const weekdayTotal = weekdayTotals.slice(0, 5).reduce((total, value) => total + value, 0);
    const weekendTotal = weekdayTotals.slice(5).reduce((total, value) => total + value, 0);
    const weekdays = {
      grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number) => `${formatDuration(value)} avg` },
      xAxis: { type: "category", data: weekdayNames },
      yAxis: hoursAxis(Math.max(0, ...weekdayAverages)),
      series: [
        {
          type: "bar",
          barMaxWidth: 36,
          data: weekdayAverages.map((value, index) => ({ value, itemStyle: { color: index >= 5 ? "#f472b6" : "#60a5fa", borderRadius: [3, 3, 0, 0] } })),
        },
      ],
    };

    return {
      dayTotals,
      calendarData,
      calendar,
      calendarHeight: years.length * 150 + 8,
      hourly,
      weekdays,
      activeDays: [...dayTotals.values()].filter((value) => value > 0).length,
      totalDays: dates.length,
      weekdayAverage: weekdayDays === 0 ? 0 : weekdayTotal / weekdayDays,
      weekendAverage: weekendDays === 0 ? 0 : weekendTotal / weekendDays,
      weekendShare: weekdayTotal + weekendTotal === 0 ? 0 : weekendTotal / (weekdayTotal + weekendTotal),
      streak: streaks(dayTotals, props.range, props.status.today),
    };
  }, [props.rows, props.range, props.status.today]);

  const sessionStats = useMemo(() => {
    const byDate = new Map<string, { first: number; last: number }>();
    for (const session of props.sessions) {
      const start = secondsIntoDay(session.start, timeZone);
      const end = start + (session.end - session.start);
      const existing = byDate.get(session.date);
      byDate.set(session.date, {
        first: existing === undefined ? start : Math.min(existing.first, start),
        last: existing === undefined ? end : Math.max(existing.last, end),
      });
    }
    const dates = datesInRange(props.range);
    const spans = dates.map((date) => byDate.get(date));
    const maxLast = Math.max(24 * 3600, ...[...byDate.values()].map((span) => span.last));
    const firstLast = {
      grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { dataIndex: number }[]) => {
          const index = params[0]?.dataIndex ?? 0;
          const span = spans[index];
          const date = dates[index] ?? "";
          const title = formatDate(date, { weekday: "short", month: "short", day: "numeric" });
          if (span === undefined) {
            return `${title}<br/>No sessions`;
          }
          return `${title}<br/><b>${formatHourOfDay(span.first)} – ${formatHourOfDay(span.last)}</b><br/>${formatDuration(span.last - span.first)} from first to last`;
        },
      },
      xAxis: { type: "category", data: dates.map((date) => formatDate(date, { month: "short", day: "numeric" })) },
      yAxis: {
        type: "value",
        min: 0,
        max: Math.ceil(maxLast / 3600) * 3600,
        interval: 3 * 3600,
        inverse: true,
        axisLabel: { formatter: (value: number) => formatHourOfDay(value) },
      },
      series: [
        { type: "bar", stack: "span", silent: true, itemStyle: { color: "transparent" }, data: spans.map((span) => (span === undefined ? null : span.first)) },
        {
          type: "bar",
          stack: "span",
          barMaxWidth: 14,
          itemStyle: { color: "#a78bfa", borderRadius: 3 },
          data: spans.map((span) => (span === undefined ? null : span.last - span.first)),
        },
      ],
    };

    const lengths = lengthBuckets.map((bucket, index) => {
      const min = index === 0 ? 0 : (lengthBuckets[index - 1]?.max ?? 0);
      const matching = props.sessions.filter((session) => session.seconds >= min && session.seconds < bucket.max);
      return { label: bucket.label, count: matching.length, seconds: sum(matching, (session) => session.seconds) };
    });
    const histogram = {
      grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { dataIndex: number }[]) => {
          const bucket = lengths[params[0]?.dataIndex ?? 0];
          return bucket === undefined ? "" : `${bucket.label}<br/><b>${bucket.count} sessions</b> · ${formatDuration(bucket.seconds)}`;
        },
      },
      xAxis: { type: "category", data: lengths.map((bucket) => bucket.label) },
      yAxis: { type: "value", minInterval: 1 },
      series: [{ type: "bar", barMaxWidth: 40, itemStyle: { color: "#34d399", borderRadius: [3, 3, 0, 0] }, data: lengths.map((bucket) => bucket.count) }],
    };

    const switchesByDate = groupSum(props.sessions, (session) => session.date, (session) => session.file_switches);
    const secondsByDate = groupSum(props.sessions, (session) => session.date, (session) => session.seconds);
    const totalSwitches = sum(props.sessions, (session) => session.file_switches);
    const totalSeconds = sum(props.sessions, (session) => session.seconds);
    const switches = {
      grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (value: number | null) => (value === null ? "no coding" : `${value.toFixed(1)} switches / hour`) },
      xAxis: { type: "category", data: dates.map((date) => formatDate(date, { month: "short", day: "numeric" })) },
      yAxis: { type: "value" },
      series: [
        {
          type: dates.length === 1 ? "bar" : "line",
          color: "#fbbf24",
          barMaxWidth: 40,
          symbolSize: 4,
          connectNulls: false,
          data: dates.map((date) => {
            const seconds = secondsByDate.get(date) ?? 0;
            return seconds < 60 ? null : (switchesByDate.get(date) ?? 0) / (seconds / 3600);
          }),
        },
      ],
    };

    const longest = [...props.sessions].sort((a, b) => b.seconds - a.seconds).slice(0, 10);
    const activeSpans = [...byDate.values()];
    return {
      firstLast,
      histogram,
      switches,
      longest,
      switchRate: totalSeconds === 0 ? 0 : totalSwitches / (totalSeconds / 3600),
      averageSession: props.sessions.length === 0 ? 0 : totalSeconds / props.sessions.length,
      medianFirst: activeSpans.length === 0 ? null : median(activeSpans.map((span) => span.first)),
      medianLast: activeSpans.length === 0 ? null : median(activeSpans.map((span) => span.last)),
    };
  }, [props.sessions, props.range, timeZone]);

  if (props.rows.length === 0) {
    return <Empty title="No activity in this range">Try a longer range or remove some filters.</Empty>;
  }

  const streak = daily.streak;

  return (
    <div className="space-y-4">
      <StatStrip>
        <Stat
          label={props.range.to === props.status.today ? "Current streak" : "Streak at range end"}
          value={`${streak.current} ${streak.current === 1 ? "day" : "days"}`}
        />
        <Stat
          label="Longest streak"
          value={`${streak.longest.length} ${streak.longest.length === 1 ? "day" : "days"}`}
          detail={
            streak.longest.length === 0
              ? undefined
              : `${formatDate(streak.longest.from, { month: "short", day: "numeric" })} – ${formatDate(streak.longest.to, { month: "short", day: "numeric" })}`
          }
        />
        <Stat label="Active days" value={`${daily.activeDays} / ${daily.totalDays}`} />
        <Stat
          label="Weekday vs weekend"
          value={`${formatDuration(daily.weekdayAverage)} · ${formatDuration(daily.weekendAverage)}`}
          detail={`avg per day · weekends are ${Math.round(daily.weekendShare * 100)}% of time`}
        />
        <Stat
          label="Sessions"
          value={props.sessions.length}
          detail={`avg ${formatDuration(sessionStats.averageSession)} · ${sessionStats.switchRate.toFixed(1)} file switches/h`}
        />
        <Stat
          label="Typical day"
          value={
            sessionStats.medianFirst === null || sessionStats.medianLast === null
              ? "—"
              : `${formatHourOfDay(sessionStats.medianFirst)} – ${formatHourOfDay(sessionStats.medianLast)}`
          }
          detail="median first and last activity"
        />
      </StatStrip>

      <Panel title="Daily activity" subtitle="Click a day to open its timeline">
        <Chart
          option={daily.calendar}
          height={daily.calendarHeight}
          onClick={(event) => {
            const entry = daily.calendarData[event.seriesIndex ?? -1]?.[event.dataIndex];
            if (entry !== undefined) {
              props.onOpenDay(entry[0]);
            }
          }}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Panel title="Hour × weekday" subtitle="Total time in each hour of the week">
          <Chart option={daily.hourly} height={240} />
        </Panel>
        <Panel title="Average by weekday" subtitle="Per calendar day, including idle days">
          <Chart option={daily.weekdays} height={240} />
        </Panel>
      </div>

      <UnappliedFilters filters={props.filters} supported={["project", "language"]} source="Sessions" />

      <Panel title="First and last activity" subtitle="Span from the first session start to the last session end of each day">
        <Chart
          option={sessionStats.firstLast}
          height={260}
          onClick={(event) => {
            const date = datesInRange(props.range)[event.dataIndex];
            if (date !== undefined) {
              props.onOpenDay(date);
            }
          }}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Session lengths" subtitle="Sessions end after 15 minutes without a heartbeat">
          <Chart option={sessionStats.histogram} height={220} />
        </Panel>
        <Panel title="Context switches per hour" subtitle="File switches per hour of coding, by day">
          <Chart option={sessionStats.switches} height={220} />
        </Panel>
      </div>

      <Panel title="Longest focus sessions">
        {sessionStats.longest.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-500">No sessions</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr className="border-b border-zinc-800">
                <th className="py-2 pr-4 font-normal">Date</th>
                <th className="py-2 pr-4 font-normal">Time</th>
                <th className="py-2 pr-4 text-right font-normal">Length</th>
                <th className="py-2 pr-4 font-normal">Main project</th>
                <th className="py-2 pr-4 font-normal">Languages</th>
                <th className="py-2 text-right font-normal">Switches / h</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {sessionStats.longest.map((session) => (
                <tr
                  key={session.start}
                  onClick={() => props.onOpenDay(session.date)}
                  className="cursor-pointer border-b border-zinc-800/50 text-zinc-300 hover:bg-zinc-800/40"
                >
                  <td className="py-1.5 pr-4">{formatDate(session.date, { weekday: "short", month: "short", day: "numeric" })}</td>
                  <td className="py-1.5 pr-4 text-zinc-400">
                    {formatClock(session.start, timeZone)} – {formatClock(session.end, timeZone)}
                  </td>
                  <td className="py-1.5 pr-4 text-right text-zinc-100">{formatDuration(session.seconds)}</td>
                  <td className="py-1.5 pr-4">{label(session.main_project)}</td>
                  <td className="max-w-[240px] truncate py-1.5 pr-4 text-zinc-400">{session.languages.map(label).join(", ")}</td>
                  <td className="py-1.5 text-right">{session.seconds === 0 ? "—" : (session.file_switches / (session.seconds / 3600)).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
