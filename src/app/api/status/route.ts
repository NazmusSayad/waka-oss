import { db } from '@/server/db.ts'
import { rebuildIfDirty } from '@/server/rollups.ts'
import { localTime, timezone } from '@/server/time.ts'

export async function GET() {
  await rebuildIfDirty()
  const now = Date.now() / 1000
  const [first, last, settings] = await db.batch(
    [
      'SELECT MIN(local_date) FROM heartbeats',
      `SELECT time, entity, project, language, branch, category, editor, machine
        FROM heartbeats ORDER BY time DESC LIMIT 1`,
      'SELECT idle_timeout_minutes FROM settings',
    ],
    'read'
  )
  const lastRow = last?.rows[0]
  return Response.json({
    timezone,
    today: localTime(now).date,
    server_time: now,
    first_date: first?.rows[0]?.[0] ?? null,
    last_heartbeat:
      lastRow === undefined
        ? null
        : {
            time: Number(lastRow[0]),
            entity: lastRow[1],
            project: lastRow[2],
            language: lastRow[3],
            branch: lastRow[4],
            category: lastRow[5],
            editor: lastRow[6],
            machine: lastRow[7],
          },
    idle_timeout_minutes: Number(settings?.rows[0]?.[0]),
  })
}
