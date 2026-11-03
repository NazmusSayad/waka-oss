import { useMemo } from 'react'
import type { ActivityRow, Session, Status } from '@/api/types'
import { Chart } from '@/components/chart'
import { EmptyState } from '@/components/empty-state'
import { Panel } from '@/components/panel'
import { Stat, StatGrid } from '@/components/stat'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { UnappliedFilters } from '@/components/unapplied-filters'
import type { Dimension } from '@/constants/dimensions'
import { sessionTokens } from '@/features/ai-vs-human/utils/session-tokens'
import type { Filter, Range } from '@/types/dashboard'
import { groupSum, sortedEntries, sum } from '@/utils/aggregate'
import {
  bucketOf,
  bucketsFor,
  formatBucket,
  granularityFor,
} from '@/utils/buckets'
import { cssColor } from '@/utils/colors'
import { formatClock, formatDate } from '@/utils/date'
import {
  formatDuration,
  formatNumber,
  formatPercent,
  label,
} from '@/utils/format'
import { hoursAxis } from '@/utils/hours-axis'

export function AiVsHuman(props: {
  status: Status
  rows: ActivityRow[]
  sessions: Session[]
  range: Range
  filters: Filter[]
  onFilter: (dimension: Dimension, value: string | null) => void
}) {
  const timeZone = props.status.timezone

  const ai = useMemo(() => {
    const humanColor = cssColor('--chart-1')
    const aiColor = cssColor('--chart-3')
    const granularity = granularityFor(props.range)
    const buckets = bucketsFor(props.range, granularity)
    const aiRows = props.rows.filter((row) => row.category === 'ai coding')
    const humanRows = props.rows.filter((row) => row.category === 'coding')
    const aiTime = groupSum(
      aiRows,
      (row) => bucketOf(row, granularity),
      (row) => row.seconds
    )
    const humanTime = groupSum(
      humanRows,
      (row) => bucketOf(row, granularity),
      (row) => row.seconds
    )
    const xAxis = {
      type: 'category',
      data: buckets.map((bucket) => formatBucket(bucket, granularity)),
    }

    const time = {
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (value: number | null) =>
          value === null ? '—' : formatDuration(value),
      },
      xAxis,
      yAxis: hoursAxis(
        Math.max(
          0,
          ...buckets.map(
            (bucket) => (aiTime.get(bucket) ?? 0) + (humanTime.get(bucket) ?? 0)
          )
        )
      ),
      series: [
        {
          type: 'bar',
          stack: 'time',
          name: 'Human coding',
          color: humanColor,
          barMaxWidth: 28,
          data: buckets.map((bucket) => humanTime.get(bucket) ?? 0),
        },
        {
          type: 'bar',
          stack: 'time',
          name: 'AI coding',
          color: aiColor,
          barMaxWidth: 28,
          data: buckets.map((bucket) => aiTime.get(bucket) ?? 0),
        },
      ],
    }

    const humanLines = groupSum(
      props.rows,
      (row) => bucketOf(row, granularity),
      (row) => row.human_lines
    )
    const aiLines = groupSum(
      props.rows,
      (row) => bucketOf(row, granularity),
      (row) => row.ai_lines
    )
    const lines = {
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (value: number) => `${formatNumber(value)} lines`,
      },
      xAxis,
      yAxis: { type: 'value' },
      series: [
        {
          type: 'bar',
          name: 'Human lines',
          color: humanColor,
          barMaxWidth: 14,
          data: buckets.map((bucket) => humanLines.get(bucket) ?? 0),
        },
        {
          type: 'bar',
          name: 'AI lines',
          color: aiColor,
          barMaxWidth: 14,
          data: buckets.map((bucket) => aiLines.get(bucket) ?? 0),
        },
      ],
    }

    const inputByProject = groupSum(
      props.rows,
      (row) => row.project,
      (row) => row.ai_input_tokens
    )
    const outputByProject = groupSum(
      props.rows,
      (row) => row.project,
      (row) => row.ai_output_tokens
    )
    const tokenProjects = sortedEntries(
      groupSum(
        props.rows,
        (row) => row.project,
        (row) => row.ai_input_tokens + row.ai_output_tokens
      )
    )
      .filter((entry) => entry[1] > 0)
      .slice(0, 12)
      .map((entry) => entry[0])
    const projectTokens = {
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (value: number) => `${formatNumber(value)} tokens`,
      },
      xAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => formatNumber(value) },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: tokenProjects.map(label),
      },
      series: [
        {
          type: 'bar',
          stack: 'tokens',
          name: 'Input',
          color: cssColor('--chart-5'),
          barMaxWidth: 16,
          data: tokenProjects.map(
            (project) => inputByProject.get(project) ?? 0
          ),
        },
        {
          type: 'bar',
          stack: 'tokens',
          name: 'Output',
          color: cssColor('--chart-4'),
          barMaxWidth: 16,
          data: tokenProjects.map(
            (project) => outputByProject.get(project) ?? 0
          ),
        },
      ],
    }

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
    }
  }, [props.rows, props.sessions, props.range, timeZone])

  if (props.rows.length === 0) {
    return (
      <EmptyState title="No activity in this range">
        Try a longer range or remove some filters.
      </EmptyState>
    )
  }

  const codingSeconds = ai.aiSeconds + ai.humanSeconds
  const totalLines = Math.abs(ai.aiLines) + Math.abs(ai.humanLines)
  const hasAi =
    ai.aiSeconds > 0 || ai.aiLines !== 0 || ai.inputTokens + ai.outputTokens > 0

  return (
    <div className="space-y-4">
      <StatGrid>
        <Stat
          label="AI coding"
          value={formatDuration(ai.aiSeconds)}
          detail={`${formatPercent(ai.aiSeconds, codingSeconds)} of coding time`}
        />
        <Stat
          label="Human coding"
          value={formatDuration(ai.humanSeconds)}
          detail={`${formatPercent(ai.humanSeconds, codingSeconds)} of coding time`}
        />
        <Stat
          label="AI line changes"
          value={formatNumber(ai.aiLines)}
          detail={`${formatPercent(Math.abs(ai.aiLines), totalLines)} of all line changes`}
        />
        <Stat
          label="Human line changes"
          value={formatNumber(ai.humanLines)}
          detail={`${formatPercent(Math.abs(ai.humanLines), totalLines)} of all line changes`}
        />
        <Stat
          label="Tokens"
          value={formatNumber(ai.inputTokens + ai.outputTokens)}
          detail={`${formatNumber(ai.inputTokens)} in · ${formatNumber(ai.outputTokens)} out`}
        />
        <Stat
          label="Tokens per AI hour"
          value={
            ai.aiSeconds === 0
              ? '—'
              : formatNumber(
                  (ai.inputTokens + ai.outputTokens) / (ai.aiSeconds / 3600)
                )
          }
        />
      </StatGrid>

      {!hasAi && (
        <p className="text-muted-foreground text-xs">
          No AI activity recorded in this range. It appears when your editor
          plugin sends the “ai coding” category, AI line changes or token
          counts.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="AI vs human coding time"
          description={`Per ${ai.granularity} · "ai coding" vs "coding" category`}
        >
          <Chart option={ai.time} height={260} />
        </Panel>
        <Panel
          title="AI vs human line changes"
          description={`Per ${ai.granularity}`}
        >
          <Chart option={ai.lines} height={260} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Tokens per project" description="Click to filter">
          {ai.tokenProjects.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs">
              No tokens recorded
            </p>
          ) : (
            <Chart
              option={ai.projectTokens}
              height={Math.max(220, ai.tokenProjects.length * 28 + 40)}
              onClick={(event) => {
                const project = ai.tokenProjects[event.dataIndex]
                if (project !== undefined) {
                  props.onFilter('project', project)
                }
              }}
            />
          )}
        </Panel>
        <Panel
          title="Tokens per session"
          description="Estimated from hourly token counts that overlap each session"
        >
          <div className="space-y-3">
            <UnappliedFilters
              filters={props.filters}
              supported={['project', 'language']}
              source="Sessions"
            />
            {ai.sessions.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-xs">
                No sessions with tokens
              </p>
            ) : (
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Session</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Length</TableHead>
                    <TableHead className="text-right">In</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                    <TableHead className="text-right">Per hour</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="tabular-nums">
                  {ai.sessions.slice(0, 12).map((item) => (
                    <TableRow key={item.session.start}>
                      <TableCell>
                        {formatDate(item.session.date, {
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        <span className="text-muted-foreground">
                          {formatClock(item.session.start, timeZone)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate">
                        {label(item.session.main_project)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatDuration(item.session.seconds)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(item.input)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(item.output)}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.session.seconds === 0
                          ? '—'
                          : formatNumber(
                              (item.input + item.output) /
                                (item.session.seconds / 3600)
                            )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}
