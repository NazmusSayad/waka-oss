import type { Range } from '@/types/dashboard'

function dayNumber(date: string) {
  return Date.parse(`${date}T00:00:00Z`) / 86400000
}

export function addDays(date: string, days: number) {
  return new Date((dayNumber(date) + days) * 86400000)
    .toISOString()
    .slice(0, 10)
}

export function daysBetween(from: string, to: string) {
  return Math.round(dayNumber(to) - dayNumber(from))
}

export function datesInRange(range: Range) {
  const dates: string[] = []
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    dates.push(date)
  }
  return dates
}

export function weekdayIndex(date: string) {
  return (new Date(dayNumber(date) * 86400000).getUTCDay() + 6) % 7
}

export const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: 'UTC',
  }).format(dayNumber(date) * 86400000)
}

export function formatRange(range: Range) {
  if (range.from === range.to) {
    return formatDate(range.from, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4)
  const from = formatDate(
    range.from,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' }
  )
  return `${from} – ${formatDate(range.to, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export function previousRange(range: Range): Range {
  const length = daysBetween(range.from, range.to) + 1
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) }
}

const clockFormats = new Map<string, Intl.DateTimeFormat>()

function clockFormat(timeZone: string) {
  const existing = clockFormats.get(timeZone)
  if (existing !== undefined) {
    return existing
  }
  const created = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  clockFormats.set(timeZone, created)
  return created
}

export function secondsIntoDay(time: number, timeZone: string) {
  const parts = clockFormat(timeZone).formatToParts(time * 1000)
  let total = 0
  for (const part of parts) {
    if (part.type === 'hour') {
      total += Number(part.value) * 3600
    }
    if (part.type === 'minute') {
      total += Number(part.value) * 60
    }
    if (part.type === 'second') {
      total += Number(part.value)
    }
  }
  return total
}

export function formatClock(time: number, timeZone: string) {
  return clockFormat(timeZone)
    .format(time * 1000)
    .slice(0, 5)
}

export function formatHourOfDay(secondsOfDay: number) {
  const totalMinutes = Math.round(secondsOfDay / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = String(totalMinutes % 60).padStart(2, '0')
  if (hours >= 24) {
    return `${String(hours - 24).padStart(2, '0')}:${minutes} +1d`
  }
  return `${String(hours).padStart(2, '0')}:${minutes}`
}
