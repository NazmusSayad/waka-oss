import { ChevronLeft, ChevronRight, CircleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getJson } from '@/api/get-json'
import type { DayHeartbeat, Status } from '@/api/types'
import { Chart } from '@/components/chart'
import { DatePicker } from '@/components/date-picker'
import { EmptyState } from '@/components/empty-state'
import { Panel } from '@/components/panel'
import { Stat, StatGrid } from '@/components/stat'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { UnappliedFilters } from '@/components/unapplied-filters'
import type { Dimension } from '@/constants/dimensions'
import {
  buildTimeline,
  filesPerProject,
} from '@/features/day-timeline/utils/build-timeline'
import type { Filter } from '@/types/dashboard'
import { sum } from '@/utils/aggregate'
import { addDays, formatClock, formatDate } from '@/utils/date'
import { matchesFilters } from '@/utils/filters'
import { formatDuration } from '@/utils/format'

export function DayTimeline(props: {
  status: Status
  date: string
  onDateChange: (date: string) => void
  filters: Filter[]
  onFilter: (dimension: Dimension, value: string | null) => void
}) {
  const [loaded, setLoaded] = useState<{
    key: string
    heartbeats: DayHeartbeat[]
  } | null>(null)
  const [failure, setFailure] = useState<{
    key: string
    message: string
  } | null>(null)
  const key = `${props.date}|${props.status.server_time}`

  useEffect(() => {
    const controller = new AbortController()
    const requestKey = `${props.date}|${props.status.server_time}`
    async function load() {
      try {
        const response = await getJson<{ heartbeats: DayHeartbeat[] }>(
          `/api/day?date=${props.date}`,
          controller.signal
        )
        setLoaded({ key: requestKey, heartbeats: response.heartbeats })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        setFailure({
          key: requestKey,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    void load()
    return () => controller.abort()
  }, [props.date, props.status.server_time])

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
            })
          ),
    [loaded, props.filters]
  )
  const timeline = useMemo(
    () => buildTimeline(heartbeats, props.status.timezone),
    [heartbeats, props.status.timezone]
  )

  const loading = loaded?.key !== key && failure?.key !== key
  const timeZone = props.status.timezone
  const total = sum(heartbeats, (heartbeat) => heartbeat.duration)
  const first = heartbeats[0]
  const last = heartbeats[heartbeats.length - 1]
  const longestBreak = timeline.breaks.reduce<{
    start: number
    end: number
  } | null>(
    (longest, item) =>
      longest === null || item.end - item.start > longest.end - longest.start
        ? item
        : longest,
    null
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous day"
              onClick={() => props.onDateChange(addDays(props.date, -1))}
            >
              <ChevronLeft />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Previous day</TooltipContent>
        </Tooltip>
        <DatePicker
          label="Day"
          value={props.date}
          onChange={props.onDateChange}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next day"
              onClick={() => props.onDateChange(addDays(props.date, 1))}
            >
              <ChevronRight />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Next day</TooltipContent>
        </Tooltip>
        <span className="ml-2 text-sm font-medium">
          {formatDate(props.date, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
        {props.date !== props.status.today && (
          <Button
            variant="link"
            size="sm"
            onClick={() => props.onDateChange(props.status.today)}
          >
            Go to today
          </Button>
        )}
        {loading && <Spinner className="text-muted-foreground" />}
      </div>

      <UnappliedFilters
        filters={props.filters}
        supported={[
          'project',
          'language',
          'branch',
          'category',
          'editor',
          'machine',
        ]}
        source="The day timeline"
      />

      {failure?.key === key && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Couldn’t load this day</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      )}

      {loaded === null && failure?.key !== key && (
        <div className="space-y-4">
          <Skeleton className="h-[86px] rounded-xl" />
          <Skeleton className="h-[480px] rounded-xl" />
        </div>
      )}

      {loaded !== null && heartbeats.length === 0 && failure?.key !== key && (
        <EmptyState title="No activity on this day" />
      )}

      {heartbeats.length > 0 && first !== undefined && last !== undefined && (
        <>
          <StatGrid>
            <Stat
              label="Coded"
              value={formatDuration(total)}
              detail={`${heartbeats.length} heartbeats`}
            />
            <Stat
              label="Day span"
              value={`${formatClock(first.time, timeZone)} – ${formatClock(last.time + last.duration, timeZone)}`}
            />
            <Stat
              label="Sessions"
              value={timeline.sessions.length}
              detail={`${timeline.breaks.length} breaks`}
            />
            <Stat
              label="Longest break"
              value={
                longestBreak === null
                  ? '—'
                  : formatDuration(longestBreak.end - longestBreak.start)
              }
              detail={
                longestBreak === null
                  ? undefined
                  : `${formatClock(longestBreak.start, timeZone)} – ${formatClock(longestBreak.end, timeZone)}`
              }
            />
            <Stat
              label="Files"
              value={
                new Set(heartbeats.map((heartbeat) => heartbeat.entity)).size
              }
              detail={`${heartbeats.filter((heartbeat) => heartbeat.is_write).length} saves`}
            />
            <Stat
              label="Line changes"
              value={sum(
                heartbeats,
                (heartbeat) =>
                  (heartbeat.human_line_changes ?? 0) +
                  (heartbeat.ai_line_changes ?? 0)
              )}
              detail={`${sum(heartbeats, (heartbeat) => heartbeat.human_line_changes ?? 0)} human · ${sum(heartbeats, (heartbeat) => heartbeat.ai_line_changes ?? 0)} AI`}
            />
          </StatGrid>

          <Panel
            title="Timeline"
            description={`Sessions and breaks, then each project with its top ${filesPerProject} files · scroll to zoom · click a project to filter`}
          >
            <Chart
              option={timeline.option}
              height={timeline.height}
              onClick={(event) => {
                const segment = timeline.segments[event.dataIndex]
                const row =
                  segment === undefined ? undefined : timeline.rows[segment.row]
                if (row !== undefined && row.kind !== 'sessions') {
                  props.onFilter('project', row.project)
                }
              }}
            />
            {timeline.hiddenFiles > 0 && (
              <p className="text-muted-foreground mt-2 text-[11px]">
                {timeline.hiddenFiles} smaller files not shown
              </p>
            )}
          </Panel>

          {timeline.breaks.length > 0 && (
            <Panel
              title="Breaks"
              description="Gaps longer than 15 minutes between heartbeats"
            >
              <ul className="flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums">
                {timeline.breaks.map((item) => (
                  <li key={item.start} className="text-muted-foreground">
                    {formatClock(item.start, timeZone)} –{' '}
                    {formatClock(item.end, timeZone)}{' '}
                    <span className="text-foreground">
                      {formatDuration(item.end - item.start)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  )
}
