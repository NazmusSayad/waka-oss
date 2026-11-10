import type { Session } from '@/api/types'
import type { Range } from '@/types/dashboard'
import { groupSum, sum } from '@/utils/aggregate'
import { cssColor } from '@/utils/colors'
import {
  datesInRange,
  formatDate,
  formatHourOfDay,
  secondsIntoDay,
} from '@/utils/date'
import { formatDuration } from '@/utils/format'

const lengthBuckets = [
  { label: '<15m', max: 900 },
  { label: '15–30m', max: 1800 },
  { label: '30m–1h', max: 3600 },
  { label: '1–2h', max: 7200 },
  { label: '2–4h', max: 14400 },
  { label: '4h+', max: Number.POSITIVE_INFINITY },
]

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

export function sessionCharts(
  sessions: Session[],
  range: Range,
  timeZone: string
) {
  const byDate = new Map<string, { first: number; last: number }>()
  for (const session of sessions) {
    const start = secondsIntoDay(session.start, timeZone)
    const end = start + (session.end - session.start)
    const existing = byDate.get(session.date)
    byDate.set(session.date, {
      first: existing === undefined ? start : Math.min(existing.first, start),
      last: existing === undefined ? end : Math.max(existing.last, end),
    })
  }
  const dates = datesInRange(range)
  const spans = dates.map((date) => byDate.get(date))
  const maxLast = Math.max(
    24 * 3600,
    ...[...byDate.values()].map((span) => span.last)
  )
  const firstLast = {
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: { dataIndex: number }[]) => {
        const index = params[0]?.dataIndex ?? 0
        const span = spans[index]
        const date = dates[index] ?? ''
        const title = formatDate(date, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
        if (span === undefined) {
          return `${title}<br/>No sessions`
        }
        return `${title}<br/><b>${formatHourOfDay(span.first)} – ${formatHourOfDay(span.last)}</b><br/>${formatDuration(span.last - span.first)} from first to last`
      },
    },
    xAxis: {
      type: 'category',
      data: dates.map((date) =>
        formatDate(date, { month: 'short', day: 'numeric' })
      ),
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: Math.ceil(maxLast / 3600) * 3600,
      interval: 3 * 3600,
      inverse: true,
      axisLabel: { formatter: (value: number) => formatHourOfDay(value) },
    },
    series: [
      {
        type: 'bar',
        stack: 'span',
        silent: true,
        itemStyle: { color: 'transparent' },
        data: spans.map((span) => (span === undefined ? null : span.first)),
      },
      {
        type: 'bar',
        stack: 'span',
        barMaxWidth: 14,
        itemStyle: { color: cssColor('--chart-5'), borderRadius: 3 },
        data: spans.map((span) =>
          span === undefined ? null : span.last - span.first
        ),
      },
    ],
  }

  const lengths = lengthBuckets.map((bucket, index) => {
    const min = index === 0 ? 0 : (lengthBuckets[index - 1]?.max ?? 0)
    const matching = sessions.filter(
      (session) => session.seconds >= min && session.seconds < bucket.max
    )
    return {
      label: bucket.label,
      count: matching.length,
      seconds: sum(matching, (session) => session.seconds),
    }
  })
  const histogram = {
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: { dataIndex: number }[]) => {
        const bucket = lengths[params[0]?.dataIndex ?? 0]
        return bucket === undefined
          ? ''
          : `${bucket.label}<br/><b>${bucket.count} sessions</b> · ${formatDuration(bucket.seconds)}`
      },
    },
    xAxis: { type: 'category', data: lengths.map((bucket) => bucket.label) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        type: 'bar',
        barMaxWidth: 40,
        itemStyle: { color: cssColor('--chart-2'), borderRadius: [3, 3, 0, 0] },
        data: lengths.map((bucket) => bucket.count),
      },
    ],
  }

  const switchesByDate = groupSum(
    sessions,
    (session) => session.date,
    (session) => session.file_switches
  )
  const secondsByDate = groupSum(
    sessions,
    (session) => session.date,
    (session) => session.seconds
  )
  const totalSwitches = sum(sessions, (session) => session.file_switches)
  const totalSeconds = sum(sessions, (session) => session.seconds)
  const switches = {
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: number | null) =>
        value === null ? 'no coding' : `${value.toFixed(1)} switches / hour`,
    },
    xAxis: {
      type: 'category',
      data: dates.map((date) =>
        formatDate(date, { month: 'short', day: 'numeric' })
      ),
    },
    yAxis: { type: 'value' },
    series: [
      {
        type: dates.length === 1 ? 'bar' : 'line',
        color: cssColor('--chart-4'),
        barMaxWidth: 40,
        symbolSize: 4,
        connectNulls: false,
        data: dates.map((date) => {
          const seconds = secondsByDate.get(date) ?? 0
          return seconds < 60
            ? null
            : (switchesByDate.get(date) ?? 0) / (seconds / 3600)
        }),
      },
    ],
  }

  const activeSpans = [...byDate.values()]
  return {
    firstLast,
    histogram,
    switches,
    longest: [...sessions].sort((a, b) => b.seconds - a.seconds).slice(0, 10),
    switchRate: totalSeconds === 0 ? 0 : totalSwitches / (totalSeconds / 3600),
    averageSession: sessions.length === 0 ? 0 : totalSeconds / sessions.length,
    medianFirst:
      activeSpans.length === 0
        ? null
        : median(activeSpans.map((span) => span.first)),
    medianLast:
      activeSpans.length === 0
        ? null
        : median(activeSpans.map((span) => span.last)),
  }
}
