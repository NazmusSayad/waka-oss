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
import { dailyCharts } from '@/features/patterns/utils/daily-charts'
import { sessionCharts } from '@/features/patterns/utils/session-charts'
import type { Filter, Range } from '@/types/dashboard'
import {
  datesInRange,
  formatClock,
  formatDate,
  formatHourOfDay,
} from '@/utils/date'
import { formatDuration, label } from '@/utils/format'

export function Patterns(props: {
  status: Status
  rows: ActivityRow[]
  sessions: Session[]
  range: Range
  filters: Filter[]
  onOpenDay: (date: string) => void
}) {
  const timeZone = props.status.timezone
  const daily = useMemo(
    () => dailyCharts(props.rows, props.range, props.status.today),
    [props.rows, props.range, props.status.today]
  )
  const sessionStats = useMemo(
    () => sessionCharts(props.sessions, props.range, timeZone),
    [props.sessions, props.range, timeZone]
  )

  if (props.rows.length === 0) {
    return (
      <EmptyState title="No activity in this range">
        Try a longer range or remove some filters.
      </EmptyState>
    )
  }

  const streak = daily.streak

  return (
    <div className="space-y-4">
      <StatGrid>
        <Stat
          label={
            props.range.to === props.status.today
              ? 'Current streak'
              : 'Streak at range end'
          }
          value={`${streak.current} ${streak.current === 1 ? 'day' : 'days'}`}
        />
        <Stat
          label="Longest streak"
          value={`${streak.longest.length} ${streak.longest.length === 1 ? 'day' : 'days'}`}
          detail={
            streak.longest.length === 0
              ? undefined
              : `${formatDate(streak.longest.from, { month: 'short', day: 'numeric' })} – ${formatDate(streak.longest.to, { month: 'short', day: 'numeric' })}`
          }
        />
        <Stat
          label="Active days"
          value={`${daily.activeDays} / ${daily.totalDays}`}
        />
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
            sessionStats.medianFirst === null ||
            sessionStats.medianLast === null
              ? '—'
              : `${formatHourOfDay(sessionStats.medianFirst)} – ${formatHourOfDay(sessionStats.medianLast)}`
          }
          detail="median first and last activity"
        />
      </StatGrid>

      <Panel
        title="Daily activity"
        description="Click a day to open its timeline"
      >
        <Chart
          option={daily.calendar}
          height={daily.calendarHeight}
          onClick={(event) => {
            const entry =
              daily.calendarData[event.seriesIndex ?? -1]?.[event.dataIndex]
            if (entry !== undefined) {
              props.onOpenDay(entry[0])
            }
          }}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Panel
          title="Hour × weekday"
          description="Total time in each hour of the week"
        >
          <Chart option={daily.hourly} height={240} />
        </Panel>
        <Panel
          title="Average by weekday"
          description="Per calendar day, including idle days"
        >
          <Chart option={daily.weekdays} height={240} />
        </Panel>
      </div>

      <UnappliedFilters
        filters={props.filters}
        supported={['project', 'language']}
        source="Sessions"
      />

      <Panel
        title="First and last activity"
        description="Span from the first session start to the last session end of each day"
      >
        <Chart
          option={sessionStats.firstLast}
          height={260}
          onClick={(event) => {
            const date = datesInRange(props.range)[event.dataIndex]
            if (date !== undefined) {
              props.onOpenDay(date)
            }
          }}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Session lengths"
          description="Sessions end after 15 minutes without a heartbeat"
        >
          <Chart option={sessionStats.histogram} height={220} />
        </Panel>
        <Panel
          title="Context switches per hour"
          description="File switches per hour of coding, by day"
        >
          <Chart option={sessionStats.switches} height={220} />
        </Panel>
      </div>

      <Panel title="Longest focus sessions">
        {sessionStats.longest.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-xs">
            No sessions
          </p>
        ) : (
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="text-right">Length</TableHead>
                <TableHead>Main project</TableHead>
                <TableHead>Languages</TableHead>
                <TableHead className="text-right">Switches / h</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {sessionStats.longest.map((session) => (
                <TableRow
                  key={session.start}
                  onClick={() => props.onOpenDay(session.date)}
                  className="cursor-pointer"
                >
                  <TableCell>
                    {formatDate(session.date, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatClock(session.start, timeZone)} –{' '}
                    {formatClock(session.end, timeZone)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatDuration(session.seconds)}
                  </TableCell>
                  <TableCell>{label(session.main_project)}</TableCell>
                  <TableCell className="text-muted-foreground max-w-[240px] truncate">
                    {session.languages.map(label).join(', ')}
                  </TableCell>
                  <TableCell className="text-right">
                    {session.seconds === 0
                      ? '—'
                      : (
                          session.file_switches /
                          (session.seconds / 3600)
                        ).toFixed(1)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  )
}
