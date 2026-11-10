import { db } from '@/server/db.ts'
import { heartbeatsSchema, insertStatements } from '@/server/ingest.ts'

export async function POST(request: Request) {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 })
  }
  const result = heartbeatsSchema.safeParse(parsed)
  if (!result.success) {
    return Response.json({ error: result.error.message }, { status: 400 })
  }
  const heartbeats = result.data
  const machine = request.headers.get('x-machine-name')

  const ids: string[] = []
  if (heartbeats.length > 0) {
    const results = await db.batch(
      heartbeats.flatMap((heartbeat) => insertStatements(heartbeat, machine)),
      'write'
    )
    for (let index = 0; index < heartbeats.length; index++) {
      ids.push(String(results[index * 2 + 1]?.rows[0]?.[0]))
    }
  }

  return Response.json(
    { responses: ids.map((id) => [{ data: { id } }, 201]) },
    { status: 202 }
  )
}
