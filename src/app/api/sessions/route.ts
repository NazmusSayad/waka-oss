import { db } from '@/server/db.ts'
import { sessionsStatement, jsonText, readDate } from '@/server/stats.ts'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const from = readDate(params, 'from')
  const to = readDate(params, 'to')
  if (from === null || to === null) {
    return Response.json({ error: 'from and to must be YYYY-MM-DD dates' }, { status: 400 })
  }
  const result = await db.execute(sessionsStatement(from, to))
  return new Response(jsonText(result.rows), { headers: { 'content-type': 'application/json' } })
}
