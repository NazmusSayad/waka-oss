import type { ActivityRow } from '@/api/types'
import type { Range } from '@/types/dashboard'
import { groupSum } from '@/utils/aggregate'
import { cssColor } from '@/utils/colors'
import {
  addDays,
  datesInRange,
  formatDate,
  weekdayIndex,
  weekdayNames,
} from '@/utils/date'
import { formatDuration } from '@/utils/format'
import { hoursAxis } from '@/utils/hours-axis'

function streaks(dayTotals: Map<string, number>, range: Range, today: string) {
  let longest = { length: 0, from: '', to: '' }
  let runLength = 0
  let runStart = ''
  for (const date of datesInRange(range)) {
    if ((dayTotals.get(date) ?? 0) > 0) {
      runStart = runLength === 0 ? date : runStart
      runLength += 1
      if (runLength > longest.length) {
        longest = { length: runLength, from: runStart, to: date }
      }
      continue
    }
    runLength = 0
  }
  let cursor = range.to
  if ((dayTotals.get(cursor) ?? 0) === 0 && cursor === today) {
    cursor = addDays(cursor, -1)
  }
  let current = 0
  while (cursor >= range.from && (dayTotals.get(cursor) ?? 0) > 0) {
    current += 1
    cursor = addDays(cursor, -1)
  }
  return { longest, current }
}

export function dailyCharts(rows: ActivityRow[], range: Range, today: string) {
  const heat = { color: [cssColor('--chart-1')], colorAlpha: [0.25, 1] }
  const dates = datesInRange(range)
  const dayTotals = groupSum(
    rows,
    (row) => row.date,
    (row) => row.seconds
  )
  const maxDay = Math.max(0, ...dayTotals.values())
  const years: Range[] = []
  for (
    let year = Number(range.from.slice(0, 4));
    year <= Number(range.to.slice(0, 4));
    year++
  ) {
    years.push({
      from: range.from > `${year}-01-01` ? range.from : `${year}-01-01`,
      to: range.to < `${year}-12-31` ? range.to : `${year}-12-31`,
    })
  }
  const calendarData = years.map((year) =>
    [...dayTotals.entries()].filter(
      (entry) => entry[0] >= year.from && entry[0] <= year.to && entry[1] > 0
    )
  )
  const calendar = {
    tooltip: {
      formatter: (params: { value: [string, number] }) =>
        `${formatDate(params.value[0], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}<br/><b>${formatDuration(params.value[1])}</b>`,
    },
    visualMap: {
      show: false,
      min: 0,
      max: maxDay === 0 ? 1 : maxDay,
      inRange: heat,
    },
    calendar: years.map((year, index) => ({
      top: 24 + index * 150,
      left: 48,
      cellSize: 16,
      range: [year.from, year.to],
      orient: 'horizontal',
      splitLine: { show: false },
      itemStyle: {
        color: cssColor('--muted'),
        borderColor: cssColor('--card'),
        borderWidth: 3,
      },
      yearLabel: {
        show: true,
        position: 'left',
        color: cssColor('--muted-foreground'),
        fontSize: 12,
      },
      monthLabel: { color: cssColor('--muted-foreground'), fontSize: 11 },
      dayLabel: {
        firstDay: 1,
        color: cssColor('--muted-foreground'),
        fontSize: 10,
        nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
      },
    })),
    series: calendarData.map((data, index) => ({
      type: 'heatmap',
      coordinateSystem: 'calendar',
      calendarIndex: index,
      data,
    })),
  }

  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0]
  for (const date of dates) {
    weekdayCounts[weekdayIndex(date)] =
      (weekdayCounts[weekdayIndex(date)] ?? 0) + 1
  }
  const grid = new Map<string, number>()
  for (const row of rows) {
    const key = `${weekdayIndex(row.date)}:${row.hour}`
    grid.set(key, (grid.get(key) ?? 0) + row.seconds)
  }
  const gridData = [...grid.entries()].map((entry) => {
    const parts = entry[0].split(':')
    return [Number(parts[1]), Number(parts[0]), entry[1]]
  })
  const hourly = {
    grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      formatter: (params: { value: [number, number, number] }) => {
        const count = weekdayCounts[params.value[1]] ?? 0
        return `${weekdayNames[params.value[1]]} ${String(params.value[0]).padStart(2, '0')}:00<br/><b>${formatDuration(params.value[2])}</b> total · ${formatDuration(count === 0 ? 0 : params.value[2] / count)} avg`
      },
    },
    visualMap: {
      show: false,
      min: 0,
      max: Math.max(1, ...grid.values()),
      inRange: heat,
    },
    xAxis: {
      type: 'category',
      data: Array.from({ length: 24 }, (_, hour) =>
        String(hour).padStart(2, '0')
      ),
      splitArea: { show: false },
    },
    yAxis: { type: 'category', data: weekdayNames, inverse: true },
    series: [
      {
        type: 'heatmap',
        data: gridData,
        itemStyle: {
          borderColor: cssColor('--card'),
          borderWidth: 2,
          borderRadius: 2,
        },
      },
    ],
  }

  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0]
  for (const entry of dayTotals) {
    weekdayTotals[weekdayIndex(entry[0])] =
      (weekdayTotals[weekdayIndex(entry[0])] ?? 0) + entry[1]
  }
  const weekdayAverages = weekdayTotals.map((total, index) => {
    const count = weekdayCounts[index] ?? 0
    return count === 0 ? 0 : total / count
  })
  const weekdayDays =
    (weekdayCounts[0] ?? 0) +
    (weekdayCounts[1] ?? 0) +
    (weekdayCounts[2] ?? 0) +
    (weekdayCounts[3] ?? 0) +
    (weekdayCounts[4] ?? 0)
  const weekendDays = (weekdayCounts[5] ?? 0) + (weekdayCounts[6] ?? 0)
  const weekdayTotal = weekdayTotals
    .slice(0, 5)
    .reduce((total, value) => total + value, 0)
  const weekendTotal = weekdayTotals
    .slice(5)
    .reduce((total, value) => total + value, 0)
  const weekdays = {
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (value: number) => `${formatDuration(value)} avg`,
    },
    xAxis: { type: 'category', data: weekdayNames },
    yAxis: hoursAxis(Math.max(0, ...weekdayAverages)),
    series: [
      {
        type: 'bar',
        barMaxWidth: 36,
        data: weekdayAverages.map((value, index) => ({
          value,
          itemStyle: {
            color: index >= 5 ? cssColor('--chart-3') : cssColor('--chart-1'),
            borderRadius: [3, 3, 0, 0],
          },
        })),
      },
    ],
  }

  return {
    calendarData,
    calendar,
    calendarHeight: years.length * 150 + 8,
    hourly,
    weekdays,
    activeDays: [...dayTotals.values()].filter((value) => value > 0).length,
    totalDays: dates.length,
    weekdayAverage: weekdayDays === 0 ? 0 : weekdayTotal / weekdayDays,
    weekendAverage: weekendDays === 0 ? 0 : weekendTotal / weekendDays,
    weekendShare:
      weekdayTotal + weekendTotal === 0
        ? 0
        : weekendTotal / (weekdayTotal + weekendTotal),
    streak: streaks(dayTotals, range, today),
  }
}
