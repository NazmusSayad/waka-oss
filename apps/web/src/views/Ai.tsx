import { useMemo } from "react";
import type { ActivityRow, Session, Status } from "../api";
import { Chart } from "../Chart";
import {
  addDays,
  bucketOf,
  bucketsFor,
  formatBucket,
  formatClock,
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  granularityFor,
  groupSum,
  hoursAxis,
  label,
  secondsIntoDay,
  sortedEntries,
  sum,
  type Dimension,
  type Filter,
  type Range,
} from "../lib";
import { Empty, Panel, Stat, StatStrip, UnappliedFilters } from "../ui";

const humanColor = "#60a5fa";
const aiColor = "#f472b6";

function sessionTokens(sessions: Session[], rows: ActivityRow[], timeZone: string) {
  const tokensByHour = new Map<string, { input: number; output: number }>();
  for (const row of rows) {
    if (row.ai_input_tokens === 0 && row.ai_output_tokens === 0) {
      continue;
    }
    const key = `${row.date}:${row.hour}`;
    const existing = tokensByHour.get(key);
    tokensByHour.set(key, {
      input: (existing?.input ?? 0) + row.ai_input_tokens,
      output: (existing?.output ?? 0) + row.ai_output_tokens,
    });
  }
  const claimed = new Set<string>();
  return [...sessions]
    .sort((a, b) => a.start - b.start)
    .map((session) => {
      const startSeconds = secondsIntoDay(session.start, timeZone);
      const firstHour = Math.floor(startSeconds / 3600);
      const lastHour = Math.floor((startSeconds + (session.end - session.start)) / 3600);
      let input = 0;
      let output = 0;
      for (let hour = firstHour; hour <= lastHour; hour++) {
        const key = `${addDays(session.date, Math.floor(hour / 24))}:${hour % 24}`;
        const tokens = tokensByHour.get(key);
        if (tokens === undefined || claimed.has(key)) {
          continue;
        }
        claimed.add(key);
        input += tokens.input;
        output += tokens.output;
      }
      return { session, input, output };
    })
    .filter((item) => item.input + item.output > 0)
    .sort((a, b) => b.input + b.output - (a.input + a.output));
}

export function Ai(props: {
  status: Status;
  rows: ActivityRow[];
  sessions: Session[];
  range: Range;
  filters: Filter[];
  onFilter: (dimension: Dimension, value: string | null) => void;
}) {
  const timeZone = props.status.timezone;

  const ai = useMemo(() => {
    const granularity = granularityFor(props.range);
    const buckets = bucketsFor(props.range, granularity);
    const aiRows = props.rows.filter((row) => row.category === "ai coding");
    const humanRows = props.rows.filter((row) => row.category === "coding");
    const aiTime = groupSum(aiRows, (row) => bucketOf(row, granularity), (row) => row.seconds);
    const humanTime = groupSum(humanRows, (row) => bucketOf(row, granularity), (row) => row.seconds);
    const xAxis = { type: "category", data: buckets.map((bucket) => formatBucket(bucket, granularity)) };

    const time = {
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value: number | null) => (value === null ? "—" : formatDuration(value)),
      },
      xAxis,
      yAxis: hoursAxis(Math.max(0, ...buckets.map((bucket) => (aiTime.get(bucket) ?? 0) + (humanTime.get(bucket) ?? 0)))),
      series: [
        { type: "bar", stack: "time", name: "Human coding", color: humanColor, barMaxWidth: 28, data: buckets.map((bucket) => humanTime.get(bucket) ?? 0) },
        { type: "bar", stack: "time", name: "AI coding", color: aiColor, barMaxWidth: 28, data: buckets.map((bucket) => aiTime.get(bucket) ?? 0) },
      ],
    };

    const humanLines = groupSum(props.rows, (row) => bucketOf(row, granularity), (row) => row.human_lines);
    const aiLines = groupSum(props.rows, (row) => bucketOf(row, granularity), (row) => row.ai_lines);
    const lines = {
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number) => `${formatNumber(value)} lines` },
      xAxis,
      yAxis: { type: "value" },
      series: [
        { type: "bar", name: "Human lines", color: humanColor, barMaxWidth: 14, data: buckets.map((bucket) => humanLines.get(bucket) ?? 0) },
        { type: "bar", name: "AI lines", color: aiColor, barMaxWidth: 14, data: buckets.map((bucket) => aiLines.get(bucket) ?? 0) },
      ],
    };

    const inputByProject = groupSum(props.rows, (row) => row.project, (row) => row.ai_input_tokens);
    const outputByProject = groupSum(props.rows, (row) => row.project, (row) => row.ai_output_tokens);
    const tokenProjects = sortedEntries(groupSum(props.rows, (row) => row.project, (row) => row.ai_input_tokens + row.ai_output_tokens))
      .filter((entry) => entry[1] > 0)
      .slice(0, 12)
      .map((entry) => entry[0]);
    const projectTokens = {
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number) => `${formatNumber(value)} tokens` },
      xAxis: { type: "value", axisLabel: { formatter: (value: number) => formatNumber(value) } },
      yAxis: { type: "category", inverse: true, data: tokenProjects.map(label) },
      series: [
        { type: "bar", stack: "tokens", name: "Input", color: "#a78bfa", barMaxWidth: 16, data: tokenProjects.map((project) => inputByProject.get(project) ?? 0) },
        { type: "bar", stack: "tokens", name: "Output", color: "#fbbf24", barMaxWidth: 16, data: tokenProjects.map((project) => outputByProject.get(project) ?? 0) },
      ],
    };

    return {
      granularity,
      time,
      lines,
      projectTokens,
      tokenProjects,
      sessions: sessionTokens(props.sessions, props.rows, timeZone),
      aiSeconds: sum(aiRows, (row) => row.seconds),
      humanSeconds: sum(humanRows, (row) => row.seconds),
      aiLines: sum(props.rows, (row) => row.ai_lines),
      humanLines: sum(props.rows, (row) => row.human_lines),
      inputTokens: sum(props.rows, (row) => row.ai_input_tokens),
      outputTokens: sum(props.rows, (row) => row.ai_output_tokens),
    };
  }, [props.rows, props.sessions, props.range, timeZone]);

  if (props.rows.length === 0) {
    return <Empty title="No activity in this range">Try a longer range or remove some filters.</Empty>;
  }

  const codingSeconds = ai.aiSeconds + ai.humanSeconds;
  const totalLines = Math.abs(ai.aiLines) + Math.abs(ai.humanLines);
  const hasAi = ai.aiSeconds > 0 || ai.aiLines !== 0 || ai.inputTokens + ai.outputTokens > 0;

  return (
    <div className="space-y-4">
      <StatStrip>
        <Stat label="AI coding" value={formatDuration(ai.aiSeconds)} detail={`${formatPercent(ai.aiSeconds, codingSeconds)} of coding time`} />
        <Stat label="Human coding" value={formatDuration(ai.humanSeconds)} detail={`${formatPercent(ai.humanSeconds, codingSeconds)} of coding time`} />
        <Stat label="AI line changes" value={formatNumber(ai.aiLines)} detail={`${formatPercent(Math.abs(ai.aiLines), totalLines)} of all line changes`} />
        <Stat label="Human line changes" value={formatNumber(ai.humanLines)} detail={`${formatPercent(Math.abs(ai.humanLines), totalLines)} of all line changes`} />
        <Stat
          label="Tokens"
          value={formatNumber(ai.inputTokens + ai.outputTokens)}
          detail={`${formatNumber(ai.inputTokens)} in · ${formatNumber(ai.outputTokens)} out`}
        />
        <Stat
          label="Tokens per AI hour"
          value={ai.aiSeconds === 0 ? "—" : formatNumber((ai.inputTokens + ai.outputTokens) / (ai.aiSeconds / 3600))}
        />
      </StatStrip>

      {!hasAi && (
        <p className="text-xs text-zinc-500">
          No AI activity recorded in this range. It appears when your editor plugin sends the "ai coding" category, AI line changes or token counts.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="AI vs human coding time" subtitle={`Per ${ai.granularity} · "ai coding" vs "coding" category`}>
          <Chart option={ai.time} height={260} />
        </Panel>
        <Panel title="AI vs human line changes" subtitle={`Per ${ai.granularity}`}>
          <Chart option={ai.lines} height={260} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Tokens per project" subtitle="Click to filter">
          {ai.tokenProjects.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">No tokens recorded</p>
          ) : (
            <Chart
              option={ai.projectTokens}
              height={Math.max(220, ai.tokenProjects.length * 28 + 40)}
              onClick={(event) => {
                const project = ai.tokenProjects[event.dataIndex];
                if (project !== undefined) {
                  props.onFilter("project", project);
                }
              }}
            />
          )}
        </Panel>
        <Panel title="Tokens per session" subtitle="Estimated from hourly token counts that overlap each session">
          <UnappliedFilters filters={props.filters} supported={["project", "language"]} source="Sessions" />
          {ai.sessions.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">No sessions with tokens</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="py-2 pr-3 font-normal">Session</th>
                  <th className="py-2 pr-3 font-normal">Project</th>
                  <th className="py-2 pr-3 text-right font-normal">Length</th>
                  <th className="py-2 pr-3 text-right font-normal">In</th>
                  <th className="py-2 pr-3 text-right font-normal">Out</th>
                  <th className="py-2 text-right font-normal">Per hour</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {ai.sessions.slice(0, 12).map((item) => (
                  <tr key={item.session.start} className="border-b border-zinc-800/50 text-zinc-300">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {formatDate(item.session.date, { month: "short", day: "numeric" })}{" "}
                      <span className="text-zinc-500">{formatClock(item.session.start, timeZone)}</span>
                    </td>
                    <td className="max-w-[160px] truncate py-1.5 pr-3">{label(item.session.main_project)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatDuration(item.session.seconds)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatNumber(item.input)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatNumber(item.output)}</td>
                    <td className="py-1.5 text-right text-zinc-100">
                      {item.session.seconds === 0 ? "—" : formatNumber((item.input + item.output) / (item.session.seconds / 3600))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
