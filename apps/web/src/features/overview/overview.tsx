import { useMemo } from 'react'
import type { ActivityRow, Status } from '@/api/types'
import { BarList } from '@/components/bar-list'
import { Chart } from '@/components/chart'
import { Delta } from '@/components/delta'
import { EmptyState } from '@/components/empty-state'
import { Panel } from '@/components/panel'
import { Stat, StatGrid } from '@/components/stat'
import type { Dimension } from '@/constants/dimensions'
import type { Range } from '@/types/dashboard'
import { groupSum, sortedEntries, sum } from '@/utils/aggregate'
import {
  bucketOf,
  bucketsFor,
  formatBucket,
  granularityFor,
} from '@/utils/buckets'
import { colorFor, cssColor } from '@/utils/colors'
import { addDays, daysBetween, formatRange, previousRange } from '@/utils/date'
import { formatDuration, label } from '@/utils/format'
import { hoursAxis } from '@/utils/hours-axis'

function totalBetween(totals: Map<string, number>, from: string, to: string) {
  let total = 0
  for (const entry of totals) {
    if (entry[0] >= from && entry[0] <= to) {
      total += entry[1]
    }
  }
  return total
}

function breakdown(
  rows: ActivityRow[],
  previousRows: ActivityRow[],
  compare: boolean,
  dimension: 'project' | 'language'
) {
  const previous = groupSum(
    previousRows,
    (row) => row[dimension],
    (row) => row.seconds
  )
  return sortedEntries(
    groupSum(
      rows,
      (row) => row[dimension],
      (row) => row.seconds
    )
  ).map((entry) => ({
    key: entry[0],
    seconds: entry[1],
    previous: compare ? (previous.get(entry[0]) ?? 0) : null,
  }))
}

function basename(path: string) {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

export function Overview(props: {
  status: Status
  rows: ActivityRow[]
  previousRows: ActivityRow[]
  recentRows: ActivityRow[]
  range: Range
  compare: boolean
  onFilter: (dimension: Dimension, value: string | null) => void
  onOpenDay: (date: string) => void
}) {
  const today = props.status.today
  const recent = useMemo(
    () =>
      groupSum(
        props.recentRows,
        (row) => row.date,
        (row) => row.seconds
      ),
    [props.recentRows]
  )
  const total = sum(props.rows, (row) => row.seconds)
  const previousTotal = sum(props.previousRows, (row) => row.seconds)
  const days = daysBetween(props.range.from, props.range.to) + 1
  const activeDays = new Set(
    props.rows.filter((row) => row.seconds > 0).map((row) => row.date)
  ).size
  const projects = useMemo(
    () => breakdown(props.rows, props.previousRows, props.compare, 'project'),
    [props.rows, props.previousRows, props.compare]
  )
  const languages = useMemo(
    () => breakdown(props.rows, props.previousRows, props.compare, 'language'),
    [props.rows, props.previousRows, props.compare]
  )

  const daily = useMemo(() => {
    const granularity = granularityFor(props.range) === 'hour' ? 'hour' : 'day'
    const buckets = bucketsFor(props.range, granularity)
    const previousBuckets = bucketsFor(previousRange(props.range), granularity)
    const topProjects = sortedEntries(
      groupSum(
        props.rows,
        (row) => row.project,
        (row) => row.seconds
      )
    )
      .slice(0, 6)
      .map((entry) => entry[0])
    const series = [
      ...topProjects.map((project) => ({ project, other: false })),
      { project: null, other: true },
    ]
      .map((item) => {
        const totals = groupSum(
          props.rows.filter((row) =>
            item.other
              ? !topProjects.includes(row.project)
              : row.project === item.project
          ),
          (row) => bucketOf(row, granularity),
          (row) => row.seconds
        )
        return {
          type: 'bar',
          stack: 'total',
          name: item.other ? 'Other' : label(item.project),
          color: item.other
            ? cssColor('--chart-other')
            : colorFor(item.project),
          barMaxWidth: 28,
          data: buckets.map((bucket) => totals.get(bucket) ?? 0),
        }
      })
      .filter((item) => item.data.some((value) => value > 0))
    const previousTotals = groupSum(
      props.previousRows,
      (row) => bucketOf(row, granularity),
      (row) => row.seconds
    )
    const currentTotals = groupSum(
      props.rows,
      (row) => bucketOf(row, granularity),
      (row) => row.seconds
    )
    const previousSeries = {
      type: 'line',
      name: 'Previous period',
      color: cssColor('--muted-foreground'),
      symbol: 'none',
      lineStyle: { type: 'dashed', width: 1.5 },
      data: previousBuckets.map((bucket) => previousTotals.get(bucket) ?? 0),
    }
    return {
      granularity,
      buckets,
      option: {
        grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
        legend: { top: 0, left: 0, type: 'scroll' },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          valueFormatter: (value: number) => formatDuration(value),
        },
        xAxis: {
          type: 'category',
          data: buckets.map((bucket) => formatBucket(bucket, granularity)),
        },
        yAxis: hoursAxis(
          Math.max(
            0,
            ...currentTotals.values(),
            ...(props.compare ? previousTotals.values() : [])
          )
        ),
        series: props.compare ? [...series, previousSeries] : series,
      },
    }
  }, [props.rows, props.previousRows, props.range, props.compare])

  const last = props.status.last_heartbeat
  const workingNow = last !== null && props.status.server_time - last.time < 900

  const periods = [
    {
      label: 'Today',
      from: today,
      to: today,
      previousFrom: addDays(today, -1),
      previousTo: addDays(today, -1),
      versus: 'vs yesterday',
    },
    {
      label: 'Last 7 days',
      from: addDays(today, -6),
      to: today,
      previousFrom: addDays(today, -13),
      previousTo: addDays(today, -7),
      versus: 'vs previous 7',
    },
    {
      label: 'Last 30 days',
      from: addDays(today, -29),
      to: today,
      previousFrom: addDays(today, -59),
      previousTo: addDays(today, -30),
      versus: 'vs previous 30',
    },
  ]

  return (
    <div className="space-y-4">
      {workingNow && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2 font-medium text-emerald-300">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            Working on now
          </span>
          <button
            type="button"
            onClick={() => props.onFilter('project', last.project)}
            className="hover:underline"
          >
            {label(last.project)}
          </button>
          <span className="text-muted-foreground">{basename(last.entity)}</span>
          <span className="text-muted-foreground">
            {[
              label(last.language),
              last.branch === null ? null : `on ${last.branch}`,
              label(last.editor),
              label(last.machine),
            ]
              .filter((part) => part !== null)
              .join(' · ')}
          </span>
          <span className="text-muted-foreground ml-auto text-xs">
            {Math.max(
              0,
              Math.round((props.status.server_time - last.time) / 60)
            )}
            m ago
          </span>
        </div>
      )}

      <StatGrid>
        {periods.map((period) => {
          const current = totalBetween(recent, period.from, period.to)
          const previous = totalBetween(
            recent,
            period.previousFrom,
            period.previousTo
          )
          return (
            <Stat
              key={period.label}
              label={period.label}
              value={formatDuration(current)}
              detail={
                <>
                  <Delta
                    current={current}
                    previous={previous}
                    format={formatDuration}
                  />{' '}
                  {period.versus}
                </>
              }
            />
          )
        })}
        <Stat
          label="Selected range"
          value={formatDuration(total)}
          detail={
            props.compare ? (
              <Delta
                current={total}
                previous={previousTotal}
                format={formatDuration}
              />
            ) : (
              formatRange(props.range)
            )
          }
        />
        <Stat
          label="Daily average"
          value={formatDuration(activeDays === 0 ? 0 : total / activeDays)}
          detail={`per active day · ${activeDays} of ${days} days active`}
        />
      </StatGrid>

      {props.rows.length === 0 ? (
        <EmptyState title="No activity in this range">
          Try a longer range or remove some filters.
        </EmptyState>
      ) : (
        <>
          <Panel
            title={
              daily.granularity === 'hour' ? 'Hourly totals' : 'Daily totals'
            }
            description={
              daily.granularity === 'hour'
                ? 'By project'
                : 'By project · click a day to open its timeline'
            }
          >
            <Chart
              option={daily.option}
              height={280}
              onClick={(event) => {
                const bucket = daily.buckets[event.dataIndex]
                if (
                  daily.granularity === 'day' &&
                  event.seriesType === 'bar' &&
                  bucket !== undefined
                ) {
                  props.onOpenDay(bucket)
                }
              }}
            />
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Top projects"
              description={`${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`}
            >
              <BarList
                items={projects}
                total={total}
                limit={10}
                onSelect={(key) => props.onFilter('project', key)}
              />
            </Panel>
            <Panel
              title="Top languages"
              description={`${languages.length} ${languages.length === 1 ? 'language' : 'languages'}`}
            >
              <BarList
                items={languages}
                total={total}
                limit={10}
                onSelect={(key) => props.onFilter('language', key)}
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
