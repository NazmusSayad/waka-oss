import { CircleAlert } from 'lucide-react'
import { useMemo } from 'react'
import type { Status } from '@/api/types'
import { Chart } from '@/components/chart'
import { EmptyState } from '@/components/empty-state'
import { Panel } from '@/components/panel'
import { Stat, StatGrid } from '@/components/stat'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useParallel } from '@/hooks/use-parallel'
import { cn } from '@/lib/utils'
import type { Filter, Range } from '@/types/dashboard'
import { groupSum, sum } from '@/utils/aggregate'
import {
  bucketOf,
  bucketsFor,
  formatBucket,
  granularityFor,
} from '@/utils/buckets'
import { cssColor } from '@/utils/colors'
import { formatDate } from '@/utils/date'
import { formatDuration, formatPercent } from '@/utils/format'
import { hoursAxis } from '@/utils/hours-axis'

export function Parallel(props: {
  status: Status
  range: Range
  filters: Filter[]
  onOpenDay: (date: string) => void
}) {
  const result = useParallel(
    props.range,
    props.filters,
    props.status.server_time
  )
  const loaded = result.data

  const parallel = useMemo(() => {
    if (loaded === null) {
      return null
    }
    const granularity = granularityFor(props.range)
    const buckets = bucketsFor(props.range, granularity)
    const wallByBucket = groupSum(
      loaded.hours,
      (hour) => bucketOf(hour, granularity),
      (hour) => hour.wall_seconds
    )
    const lanesByBucket = groupSum(
      loaded.hours,
      (hour) => bucketOf(hour, granularity),
      (hour) => hour.lane_seconds
    )
    const wallSeconds = sum(loaded.hours, (hour) => hour.wall_seconds)

    const time = {
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0 },
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
        Math.max(0, ...buckets.map((bucket) => lanesByBucket.get(bucket) ?? 0))
      ),
      series: [
        {
          type: 'bar',
          stack: 'time',
          name: 'Real time',
          color: cssColor('--chart-1'),
          barMaxWidth: 28,
          data: buckets.map((bucket) => wallByBucket.get(bucket) ?? 0),
        },
        {
          type: 'bar',
          stack: 'time',
          name: 'Extra from parallel lanes',
          color: cssColor('--chart-3'),
          barMaxWidth: 28,
          data: buckets.map(
            (bucket) =>
              (lanesByBucket.get(bucket) ?? 0) - (wallByBucket.get(bucket) ?? 0)
          ),
        },
      ],
    }

    const levels = {
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (value: number) =>
          `${formatDuration(value)} · ${formatPercent(value, wallSeconds)}`,
      },
      xAxis: {
        type: 'category',
        name: 'Lanes',
        nameLocation: 'middle',
        nameGap: 28,
        data: loaded.levels.map((level) => String(level.lanes)),
      },
      yAxis: hoursAxis(
        Math.max(0, ...loaded.levels.map((level) => level.seconds))
      ),
      series: [
        {
          type: 'bar',
          name: 'Time',
          color: cssColor('--chart-3'),
          barMaxWidth: 28,
          data: loaded.levels.map((level) => level.seconds),
        },
      ],
    }

    const days = new Map<
      string,
      { wall: number; lanes: number; peak: number }
    >()
    for (const hour of loaded.hours) {
      const day = days.get(hour.date) ?? { wall: 0, lanes: 0, peak: 0 }
      day.wall += hour.wall_seconds
      day.lanes += hour.lane_seconds
      day.peak = Math.max(day.peak, hour.peak_lanes)
      days.set(hour.date, day)
    }
    const topDays = [...days.entries()]
      .filter((entry) => entry[1].lanes > entry[1].wall)
      .sort((a, b) => b[1].lanes - b[1].wall - (a[1].lanes - a[1].wall))
      .slice(0, 10)

    return {
      time,
      levels,
      topDays,
      wallSeconds,
      laneSeconds: sum(loaded.hours, (hour) => hour.lane_seconds),
      parallelSeconds: sum(loaded.hours, (hour) => hour.parallel_seconds),
      peakLanes: Math.max(0, ...loaded.hours.map((hour) => hour.peak_lanes)),
    }
  }, [loaded, props.range])

  return (
    <div
      className={cn(
        'space-y-4 transition-opacity',
        !result.current && parallel !== null && 'opacity-60'
      )}
    >
      {result.error !== null && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Couldn’t load parallel timings</AlertTitle>
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      )}

      {parallel === null && result.error === null && (
        <div className="space-y-4">
          <Skeleton className="h-[86px] rounded-xl" />
          <Skeleton className="h-[360px] rounded-xl" />
        </div>
      )}

      {parallel !== null && parallel.wallSeconds === 0 && (
        <EmptyState title="No activity in this range">
          Try a longer range.
        </EmptyState>
      )}

      {parallel !== null && parallel.wallSeconds > 0 && (
        <>
          <StatGrid>
            <Stat
              label="Real time"
              value={formatDuration(parallel.wallSeconds)}
              detail="Each moment counted once"
            />
            <Stat
              label="Work across lanes"
              value={formatDuration(parallel.laneSeconds)}
              detail={`${(parallel.laneSeconds / parallel.wallSeconds).toFixed(2)}× real time`}
            />
            <Stat
              label="Parallel time"
              value={formatDuration(parallel.parallelSeconds)}
              detail={`${formatPercent(parallel.parallelSeconds, parallel.wallSeconds)} of real time had 2+ lanes`}
            />
            <Stat
              label="Peak lanes"
              value={parallel.peakLanes}
              detail="Most lanes active at once"
            />
          </StatGrid>

          <Panel
            title="Real time vs work across lanes"
            description="Each agent session is its own lane, and all your own activity is one lane. Real time counts each moment once; work across lanes counts it once per active lane."
          >
            <Chart option={parallel.time} height={300} />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Lanes active at once"
              description="How much real time had 1, 2, 3… lanes running together"
            >
              <Chart option={parallel.levels} height={260} />
            </Panel>
            <Panel
              title="Most parallel days"
              description="Ranked by extra time gained from parallel lanes. Click a day to open its timeline."
            >
              {parallel.topDays.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-xs">
                  No parallel work in this range
                </p>
              ) : (
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead className="text-right">Real time</TableHead>
                      <TableHead className="text-right">Across lanes</TableHead>
                      <TableHead className="text-right">Multiplier</TableHead>
                      <TableHead className="text-right">Peak</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="tabular-nums">
                    {parallel.topDays.map((entry) => (
                      <TableRow
                        key={entry[0]}
                        onClick={() => props.onOpenDay(entry[0])}
                        className="cursor-pointer"
                      >
                        <TableCell>
                          {formatDate(entry[0], {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatDuration(entry[1].wall)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatDuration(entry[1].lanes)}
                        </TableCell>
                        <TableCell className="text-right">
                          {(entry[1].lanes / entry[1].wall).toFixed(2)}×
                        </TableCell>
                        <TableCell className="text-right">
                          {entry[1].peak}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
