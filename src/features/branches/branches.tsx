import { useMemo } from 'react'
import type { ActivityRow } from '@/api/types'
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
import type { Dimension } from '@/constants/dimensions'
import { cn } from '@/lib/utils'
import type { Range } from '@/types/dashboard'
import {
  bucketOf,
  bucketsFor,
  formatBucket,
  granularityFor,
} from '@/utils/buckets'
import { cssColor } from '@/utils/colors'
import { daysBetween, formatDate } from '@/utils/date'
import { formatDuration, formatNumber, label } from '@/utils/format'

type Branch = {
  project: string | null
  branch: string | null
  seconds: number
  dates: Map<string, number>
  writes: number
  lines: number
  aiLines: number
}

function branchActivity(rows: ActivityRow[], range: Range) {
  const groups = new Map<string, Branch>()
  for (const row of rows) {
    const key = `${row.project}\u0000${row.branch}`
    let group = groups.get(key)
    if (group === undefined) {
      group = {
        project: row.project,
        branch: row.branch,
        seconds: 0,
        dates: new Map(),
        writes: 0,
        lines: 0,
        aiLines: 0,
      }
      groups.set(key, group)
    }
    group.seconds += row.seconds
    group.writes += row.writes
    group.lines += row.human_lines
    group.aiLines += row.ai_lines
    if (row.seconds > 0) {
      group.dates.set(row.date, (group.dates.get(row.date) ?? 0) + row.seconds)
    }
  }
  const branches = [...groups.values()]
    .filter((branch) => branch.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
  const top = branches.slice(0, 15)
  const granularity =
    granularityFor(range) === 'hour' ? 'day' : granularityFor(range)
  const buckets = bucketsFor(range, granularity)
  const cells: [number, number, number][] = []
  top.forEach((branch, branchIndex) => {
    const totals = new Map<string, number>()
    for (const entry of branch.dates) {
      const bucket = bucketOf({ date: entry[0], hour: 0 }, granularity)
      totals.set(bucket, (totals.get(bucket) ?? 0) + entry[1])
    }
    for (const entry of totals) {
      cells.push([buckets.indexOf(entry[0]), branchIndex, entry[1]])
    }
  })
  const heatmap = {
    grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      formatter: (params: { value: [number, number, number] }) => {
        const branch = top[params.value[1]]
        const bucket = buckets[params.value[0]] ?? ''
        return branch === undefined
          ? ''
          : `${label(branch.project)} / ${label(branch.branch)}<br/>${formatBucket(bucket, granularity)}: <b>${formatDuration(params.value[2])}</b>`
      },
    },
    visualMap: {
      show: false,
      min: 0,
      max: Math.max(1, ...cells.map((cell) => cell[2])),
      inRange: { color: [cssColor('--heat-low'), cssColor('--heat-high')] },
    },
    xAxis: {
      type: 'category',
      data: buckets.map((bucket) => formatBucket(bucket, granularity)),
      splitArea: { show: false },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: top.map((branch) => {
        const name = `${label(branch.branch)} · ${label(branch.project)}`
        return name.length > 40 ? `${name.slice(0, 39)}…` : name
      }),
    },
    series: [
      {
        type: 'heatmap',
        data: cells,
        itemStyle: {
          borderColor: cssColor('--card'),
          borderWidth: 1,
          borderRadius: 2,
        },
      },
    ],
  }
  return { branches, top, granularity, heatmap, cells }
}

export function Branches(props: {
  rows: ActivityRow[]
  range: Range
  onFilter: (dimension: Dimension, value: string | null) => void
}) {
  const result = useMemo(
    () => branchActivity(props.rows, props.range),
    [props.rows, props.range]
  )

  if (result.branches.length === 0) {
    return (
      <EmptyState title="No activity in this range">
        Try a longer range or remove some filters.
      </EmptyState>
    )
  }

  const total = result.branches.reduce(
    (seconds, branch) => seconds + branch.seconds,
    0
  )
  const unknown = result.branches
    .filter((branch) => branch.branch === null)
    .reduce((seconds, branch) => seconds + branch.seconds, 0)
  const named = result.branches.filter((branch) => branch.branch !== null)

  return (
    <div className="space-y-4">
      <StatGrid>
        <Stat
          label="Branches"
          value={named.length}
          detail={`across ${new Set(named.map((branch) => branch.project)).size} projects`}
        />
        <Stat
          label="Average per branch"
          value={formatDuration(
            named.length === 0 ? 0 : (total - unknown) / named.length
          )}
        />
        <Stat
          label="Most time"
          value={label(result.branches[0]?.branch ?? null)}
          detail={formatDuration(result.branches[0]?.seconds ?? 0)}
        />
        <Stat
          label="Outside a branch"
          value={formatDuration(unknown)}
          detail="no git branch reported"
        />
      </StatGrid>

      <Panel
        title="Branch activity"
        description={`Top ${result.top.length} branches · time per ${result.granularity}`}
      >
        <Chart
          option={result.heatmap}
          height={result.top.length * 24 + 50}
          onClick={(event) => {
            const branch = result.top[result.cells[event.dataIndex]?.[1] ?? -1]
            if (branch !== undefined) {
              props.onFilter('branch', branch.branch)
            }
          }}
        />
      </Panel>

      <Panel
        title="All branches"
        description="Time is a rough cost per feature or pull request; dates are limited to the selected range"
      >
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead>
              <TableHead>Project</TableHead>
              <TableHead className="text-right">Time</TableHead>
              <TableHead className="text-right">Active days</TableHead>
              <TableHead>First – last seen</TableHead>
              <TableHead className="text-right">Span</TableHead>
              <TableHead className="text-right">Per active day</TableHead>
              <TableHead className="text-right">Saves</TableHead>
              <TableHead className="text-right">Lines (human / AI)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="tabular-nums">
            {result.branches.map((branch) => {
              const dates = [...branch.dates.keys()].sort()
              const first = dates[0] ?? ''
              const last = dates[dates.length - 1] ?? ''
              return (
                <TableRow key={`${branch.project}\u0000${branch.branch}`}>
                  <TableCell className="max-w-[280px] truncate">
                    <button
                      type="button"
                      onClick={() => props.onFilter('branch', branch.branch)}
                      className={cn(
                        'hover:underline',
                        branch.branch === null && 'text-muted-foreground italic'
                      )}
                    >
                      {label(branch.branch)}
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">
                    <button
                      type="button"
                      onClick={() => props.onFilter('project', branch.project)}
                      className="hover:text-foreground hover:underline"
                    >
                      {label(branch.project)}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatDuration(branch.seconds)}
                  </TableCell>
                  <TableCell className="text-right">{dates.length}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {first === last
                      ? formatDate(first, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : `${formatDate(first, { month: 'short', day: 'numeric' })} – ${formatDate(last, { month: 'short', day: 'numeric', year: 'numeric' })}`}
                  </TableCell>
                  <TableCell className="text-right">
                    {daysBetween(first, last) + 1}d
                  </TableCell>
                  <TableCell className="text-right">
                    {formatDuration(
                      dates.length === 0 ? 0 : branch.seconds / dates.length
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(branch.writes)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(branch.lines)}{' '}
                    <span className="text-muted-foreground">
                      / {formatNumber(branch.aiLines)}
                    </span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Panel>
    </div>
  )
}
