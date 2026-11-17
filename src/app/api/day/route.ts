import { db } from '@/server/db.ts'
import { cacheControl, dayHeartbeats, dayStatement, readDate, readIdle } from '@/server/stats.ts'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const date = readDate(params, 'date')
  const idle = readIdle(params)
  if (date === null) {
    return Response.json({ error: 'date must be a YYYY-MM-DD date' }, { status: 400 })
  }
  if (idle === null) {
    return Response.json({ error: 'idle must be a supported idle timeout in minutes' }, { status: 400 })
  }
  const result = await db.execute(dayStatement(date))
  const last = Math.max(...result.rows.map((row) => Number(row[0])))
  const next =
    result.rows.length === 0
      ? null
      : (await db.execute({ sql: 'SELECT MIN(time) FROM heartbeats WHERE time > ?1', args: [last] })).rows[0]?.[0]
  if (next !== null && typeof next !== 'number') {
    throw new Error('next heartbeat time is not a number')
  }
  return Response.json(
    { heartbeats: dayHeartbeats(result.rows, next, idle.minutes) },
    { headers: { 'cache-control': cacheControl } }
  )
}
