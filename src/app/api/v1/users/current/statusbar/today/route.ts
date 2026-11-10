import { db } from '@/server/db.ts'
import { summaryTime } from '@/server/ingest.ts'
import { localTime, timezone } from '@/server/time.ts'

export async function GET() {
  const now = new Date()
  const date = localTime(now.getTime() / 1000).date
  const result = await db.execute({
    sql: `SELECT category, TOTAL(seconds) AS seconds FROM activity
      WHERE date = ?1
      GROUP BY category ORDER BY seconds DESC`,
    args: [date],
  })
  const categories = result.rows.map((row) => ({ name: row[0] as string | null, seconds: Number(row[1]) }))
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
