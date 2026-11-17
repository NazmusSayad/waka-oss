import { db } from '@/server/db.ts'
import { cacheControl, activityRows, daysStatement, readDate, readIdle } from '@/server/stats.ts'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const from = readDate(params, 'from')
  const to = readDate(params, 'to')
  const idle = readIdle(params)
  if (from === null || to === null) {
    return Response.json({ error: 'from and to must be YYYY-MM-DD dates' }, { status: 400 })
  }
  if (idle === null) {
    return Response.json({ error: 'idle must be a supported idle timeout in minutes' }, { status: 400 })
  }
  const result = await db.execute(daysStatement('activity', from, to))
  return Response.json({ rows: activityRows(result.rows, idle.index) }, { headers: { 'cache-control': cacheControl } })
}
