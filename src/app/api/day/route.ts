import { db } from '@/server/db.ts'
import { dayStatement, jsonText, readDate } from '@/server/stats.ts'

export async function GET(request: Request) {
  const date = readDate(new URL(request.url).searchParams, 'date')
  if (date === null) {
    return Response.json({ error: 'date must be a YYYY-MM-DD date' }, { status: 400 })
  }
  const result = await db.execute(dayStatement(date))
  return new Response(jsonText(result.rows), { headers: { 'content-type': 'application/json' } })
}
