import { idleTimeouts } from '@/constants/idle-timeouts.ts'
import { db } from '@/server/db.ts'
import { item, unpack, type DayActivity } from '@/server/rollups.ts'
import { summaryTime } from '@/server/ingest.ts'
import { localTime, timezone } from '@/server/time.ts'

export async function GET() {
  const now = new Date()
  const date = localTime(now.getTime() / 1000).date
  const result = await db.execute({
    sql: 'SELECT settings.idle_timeout_minutes, day_cache.activity FROM settings LEFT JOIN day_cache ON day_cache.date = ?1',
    args: [date],
  })
  const settings = result.rows[0]
  if (settings === undefined) {
    throw new Error('settings row is missing')
  }
  const idleIndex = idleTimeouts.indexOf(Number(settings[0]))
  if (idleIndex === -1) {
    throw new Error(`unsupported idle timeout ${String(settings[0])}`)
  }
  const totals = new Map<string | null, number>()
  if (settings[1] !== null) {
    const activity: DayActivity[] = unpack(settings[1])
    for (const row of activity) {
      totals.set(row.category, (totals.get(row.category) ?? 0) + item(row.seconds, idleIndex))
    }
  }
  const categories = [...totals.entries()]
    .map((entry) => ({ name: entry[0], seconds: entry[1] }))
    .toSorted((a, b) => b.seconds - a.seconds)
  const total = categories.reduce((sum, category) => sum + category.seconds, 0)
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
    .formatToParts(now)
    .find((part) => part.type === 'timeZoneName')
  if (offset === undefined) {
    throw new Error('missing timezone offset')
  }
  const suffix = offset.value === 'GMT' ? '+00:00' : offset.value.replace('GMT', '')

  return Response.json({
    cached_at: now.toISOString(),
    data: {
      grand_total: summaryTime(total),
      categories: categories.map((category) => ({
        ...summaryTime(category.seconds),
        name: category.name,
        percent: total > 0 ? (category.seconds / total) * 100 : 0,
        seconds: Math.trunc(category.seconds) % 60,
      })),
      projects: [],
      languages: [],
      editors: [],
      machines: [],
      operating_systems: [],
      dependencies: [],
      range: {
        date,
        start: `${date}T00:00:00${suffix}`,
        end: `${date}T23:59:59${suffix}`,
        text: 'Today',
        timezone,
      },
    },
    has_team_features: false,
  })
}
