import { db } from '@/server/db.ts'
import { computeParallel } from '@/server/parallel.ts'
import {
  cacheControl,
  daysStatement,
  filtersSchema,
  parallelRows,
  parallelStatement,
  readDate,
  readIdle,
} from '@/server/stats.ts'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const from = readDate(params, 'from')
  const to = readDate(params, 'to')
  if (from === null || to === null) {
    return Response.json({ error: 'from and to must be YYYY-MM-DD dates' }, { status: 400 })
  }
  const idle = readIdle(params)
  if (idle === null) {
    return Response.json({ error: 'idle must be a supported idle timeout in minutes' }, { status: 400 })
  }
  let filters
  try {
    filters = filtersSchema.parse(JSON.parse(params.get('filters') ?? ''))
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 })
  }
  if (filters.length === 0) {
    const days = await db.execute(daysStatement('parallel', from, to))
    return Response.json(parallelRows(days.rows, idle.index), { headers: { 'cache-control': cacheControl } })
  }
  const result = await db.execute(parallelStatement(from, to, filters, idle.minutes))
  const heartbeats = result.rows.map((row): [number, number] => [Number(row[0]), Number(row[1])])
  return Response.json(computeParallel(heartbeats, from, to), { headers: { 'cache-control': cacheControl } })
}
