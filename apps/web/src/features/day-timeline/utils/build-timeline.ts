import type { CustomSeriesRenderItemAPI } from 'echarts'
import type { DayHeartbeat } from '@/api/types'
import { groupSum, sortedEntries } from '@/utils/aggregate'
import { colorFor, cssColor } from '@/utils/colors'
import { formatClock, secondsIntoDay } from '@/utils/date'
import { formatDuration, label } from '@/utils/format'

type Row = {
  kind: 'sessions' | 'project' | 'file'
  name: string
  project: string | null
}

type Segment = {
  row: number
  start: number
  end: number
  color: string
  opacity: number
  title: string
  detail: string
}

const rowHeight = 24

export const filesPerProject = 8

function shortPath(path: string) {
  return path
    .split(/[\\/]/)
    .filter((part) => part !== '')
    .slice(-2)
    .join('/')
}

function richSafe(text: string) {
  return text.replace(/[{}|]/g, '')
}

export function buildTimeline(heartbeats: DayHeartbeat[], timeZone: string) {
  const projectTotals = sortedEntries(
    groupSum(
      heartbeats,
      (heartbeat) => heartbeat.project,
      (heartbeat) => heartbeat.duration
    )
  )
  const rows: Row[] = [{ kind: 'sessions', name: 'Sessions', project: null }]
  const rowIndex = new Map<string, number>()
  let hiddenFiles = 0
  for (const projectEntry of projectTotals) {
    const project = projectEntry[0]
    rowIndex.set(`project:${project}`, rows.length)
    rows.push({ kind: 'project', name: label(project), project })
    const files = sortedEntries(
      groupSum(
        heartbeats.filter((heartbeat) => heartbeat.project === project),
        (heartbeat) => heartbeat.entity,
        (heartbeat) => heartbeat.duration
      )
    ).filter((entry) => entry[1] > 0)
    hiddenFiles += Math.max(0, files.length - filesPerProject)
    for (const fileEntry of files.slice(0, filesPerProject)) {
      rowIndex.set(`file:${project}:${fileEntry[0]}`, rows.length)
      rows.push({ kind: 'file', name: fileEntry[0], project })
    }
  }

  const segments: Segment[] = []
  const lastByRow = new Map<number, Segment>()
  function extend(
    row: number | undefined,
    heartbeat: DayHeartbeat,
    color: string,
    opacity: number,
    text: { title: string; detail: string }
  ) {
    if (row === undefined) {
      return
    }
    const end = heartbeat.time + heartbeat.duration
    const last = lastByRow.get(row)
    if (last !== undefined && heartbeat.time - last.end < 1) {
      last.end = Math.max(last.end, end)
      return
    }
    const segment = {
      row,
      start: heartbeat.time,
      end,
      color,
      opacity,
      title: text.title,
      detail: text.detail,
    }
    segments.push(segment)
    lastByRow.set(row, segment)
  }

  const sessions: { start: number; end: number; seconds: number }[] = []
  let previous: DayHeartbeat | null = null
  for (const heartbeat of heartbeats) {
    const current = sessions[sessions.length - 1]
    if (
      previous === null ||
      current === undefined ||
      heartbeat.time - previous.time > 900
    ) {
      sessions.push({
        start: heartbeat.time,
        end: heartbeat.time + heartbeat.duration,
        seconds: heartbeat.duration,
      })
    } else {
      current.end = Math.max(current.end, heartbeat.time + heartbeat.duration)
      current.seconds += heartbeat.duration
    }
    previous = heartbeat
    if (heartbeat.duration <= 0) {
      continue
    }
    const color = colorFor(heartbeat.project)
    extend(
      rowIndex.get(`project:${heartbeat.project}`),
      heartbeat,
      color,
      0.9,
      {
        title: label(heartbeat.project),
        detail: '',
      }
    )
    extend(
      rowIndex.get(`file:${heartbeat.project}:${heartbeat.entity}`),
      heartbeat,
      color,
      0.55,
      {
        title: heartbeat.entity,
        detail: [
          label(heartbeat.language),
          heartbeat.branch === null ? null : `on ${heartbeat.branch}`,
          label(heartbeat.category),
        ]
          .filter((part) => part !== null)
          .join(' · '),
      }
    )
  }

  const breaks: { start: number; end: number }[] = []
  sessions.forEach((session, index) => {
    segments.push({
      row: 0,
      start: session.start,
      end: session.end,
      color: cssColor('--chart-6'),
      opacity: 0.9,
      title: 'Session',
      detail: `${formatDuration(session.seconds)} coded`,
    })
    const next = sessions[index + 1]
    if (next !== undefined) {
      breaks.push({ start: session.end, end: next.start })
      segments.push({
        row: 0,
        start: session.end,
        end: next.start,
        color: cssColor('--chart-other'),
        opacity: 0.6,
        title: 'Break',
        detail: '',
      })
    }
  })

  const first = heartbeats[0]
  const last = heartbeats[heartbeats.length - 1]
  const min =
    first === undefined
      ? 0
      : first.time - (secondsIntoDay(first.time, timeZone) % 3600)
  const lastEnd = last === undefined ? 0 : last.time + last.duration
  const max = lastEnd + (3600 - (secondsIntoDay(lastEnd, timeZone) % 3600))
  const span = max - min
  const interval = span <= 8 * 3600 ? 3600 : span <= 16 * 3600 ? 7200 : 10800

  const option = {
    grid: {
      left: 8,
      right: 16,
      top: 8,
      height: rows.length * rowHeight,
      containLabel: true,
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: { dataIndex: number }) => {
        const segment = segments[params.dataIndex]
        if (segment === undefined) {
          return ''
        }
        return [
          `<b>${segment.title}</b>`,
          `${formatClock(segment.start, timeZone)} – ${formatClock(segment.end, timeZone)} · ${formatDuration(segment.end - segment.start)}`,
          segment.detail,
        ]
          .filter((line) => line !== '')
          .join('<br/>')
      },
    },
    dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'weakFilter' }],
    xAxis: {
      type: 'value',
      position: 'top',
      min,
      max,
      interval,
      axisLabel: { formatter: (value: number) => formatClock(value, timeZone) },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map((_, index) => String(index)),
      splitLine: { show: true, lineStyle: { color: cssColor('--border') } },
      axisLabel: {
        formatter: (_: string, index: number) => {
          const row = rows[index]
          if (row === undefined) {
            return ''
          }
          if (row.kind === 'file') {
            const name = shortPath(row.name)
            return `{file|${richSafe(name.length > 36 ? `…${name.slice(-35)}` : name)}}`
          }
          return `{${row.kind}|${richSafe(row.name.length > 28 ? `${row.name.slice(0, 27)}…` : row.name)}}`
        },
        rich: {
          sessions: {
            color: cssColor('--chart-6'),
            fontWeight: 600,
            fontSize: 11,
          },
          project: {
            color: cssColor('--foreground'),
            fontWeight: 600,
            fontSize: 11,
          },
          file: { color: cssColor('--muted-foreground'), fontSize: 11 },
        },
      },
    },
    series: [
      {
        type: 'custom',
        clip: true,
        renderItem: (
          params: { dataIndex: number },
          api: CustomSeriesRenderItemAPI
        ) => {
          const segment = segments[params.dataIndex]
          const start = api.coord([api.value(1), api.value(0)])
          const end = api.coord([api.value(2), api.value(0)])
          if (
            segment === undefined ||
            start[0] === undefined ||
            start[1] === undefined ||
            end[0] === undefined
          ) {
            return null
          }
          const height = segment.row === 0 ? 14 : 12
          return {
            type: 'rect',
            shape: {
              x: start[0],
              y: start[1] - height / 2,
              width: Math.max(end[0] - start[0], 1.5),
              height,
              r: 2,
            },
            style: { fill: segment.color, opacity: segment.opacity },
          }
        },
        encode: { x: [1, 2], y: 0 },
        data: segments.map((segment) => [
          segment.row,
          segment.start,
          segment.end,
        ]),
      },
    ],
  }

  return {
    rows,
    segments,
    sessions,
    breaks,
    hiddenFiles,
    option,
    height: rows.length * rowHeight + 40,
  }
}
