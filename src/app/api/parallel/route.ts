import { db } from '@/server/db.ts'
import { cacheControl, computeParallel, filtersSchema, parallelStatement, readDate } from '@/server/stats.ts'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const from = readDate(params, 'from')
  const to = readDate(params, 'to')
  if (from === null || to === null) {
    return Response.json({ error: 'from and to must be YYYY-MM-DD dates' }, { status: 400 })
  }
  let filters
  try {
    filters = filtersSchema.parse(JSON.parse(params.get('filters') ?? ''))
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 })
  }
  const result = await db.execute(parallelStatement(from, to, filters))
  const heartbeats = result.rows.map((row): [number, number] => [Number(row[0]), Number(row[1])])
  return Response.json(computeParallel(heartbeats, from, to), { headers: { 'cache-control': cacheControl } })
}
