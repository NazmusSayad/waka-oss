import type { Range } from '@/types/dashboard'
import {
  addDays,
  datesInRange,
  daysBetween,
  formatDate,
  weekdayIndex,
} from '@/utils/date'

export type Granularity = 'hour' | 'day' | 'week' | 'month'

export function granularityFor(range: Range): Granularity {
  const days = daysBetween(range.from, range.to) + 1
  if (days === 1) {
    return 'hour'
  }
  if (days <= 92) {
    return 'day'
  }
  if (days <= 730) {
    return 'week'
  }
  return 'month'
}

export function bucketOf(
  row: { date: string; hour: number },
  granularity: Granularity
) {
  if (granularity === 'hour') {
    return `${String(row.hour).padStart(2, '0')}:00`
  }
  if (granularity === 'day') {
    return row.date
  }
  if (granularity === 'week') {
    return addDays(row.date, -weekdayIndex(row.date))
  }
  return row.date.slice(0, 7)
}

export function bucketsFor(range: Range, granularity: Granularity) {
  if (granularity === 'hour') {
    return Array.from(
      { length: 24 },
      (_, hour) => `${String(hour).padStart(2, '0')}:00`
    )
  }
  const buckets = new Set<string>()
  for (const date of datesInRange(range)) {
    buckets.add(bucketOf({ date, hour: 0 }, granularity))
  }
  return [...buckets]
}

export function formatBucket(bucket: string, granularity: Granularity) {
  if (granularity === 'hour') {
    return bucket
  }
  if (granularity === 'month') {
    return formatDate(`${bucket}-01`, { month: 'short', year: 'numeric' })
  }
  return formatDate(bucket, { month: 'short', day: 'numeric' })
}
