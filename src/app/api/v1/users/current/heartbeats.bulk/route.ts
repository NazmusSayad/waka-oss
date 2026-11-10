import { after } from 'next/server'
import { db } from '@/server/db.ts'
import { forward, forwardApiUrl, heartbeatsSchema, insertStatements } from '@/server/ingest.ts'
import { idleStatement, refreshStatements } from '@/server/rollups.ts'

export async function POST(request: Request) {
  const body = await request.arrayBuffer()
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(body))
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
    const idle = Number((await db.execute(idleStatement)).rows[0]?.[0])
    const times = heartbeats.map((heartbeat) => heartbeat.time)
    const statements = [
      ...heartbeats.flatMap((heartbeat) => insertStatements(heartbeat, machine)),
      ...refreshStatements(Math.min(...times), Math.max(...times), idle),
    ]
    const results = await db.batch(statements, 'write')
    for (let index = 0; index < heartbeats.length; index++) {
      ids.push(String(results[index * 2 + 1]?.rows[0]?.[0]))
    }
  }

  const base = forwardApiUrl()
  if (base !== null) {
    after(async () => {
      const url = `${base}/users/current/heartbeats.bulk`
      try {
        const response = await forward('POST', url, request.headers, body)
        if (!response.ok) {
          console.error(`forward to ${url} returned ${response.status}`)
        }
      } catch (error) {
        console.error(`forward to ${url} failed: ${String(error)}`)
      }
    })
  }

  return Response.json(
    { responses: ids.map((id) => [{ data: { id } }, 201]) },
    { status: 202 }
  )
}
