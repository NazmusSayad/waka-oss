import { z } from 'zod'
import { db } from '@/server/db.ts'

const settingsSchema = z.object({ idle_timeout_minutes: z.int().min(1).max(120) })

export async function PUT(request: Request) {
  const result = settingsSchema.safeParse(await request.json())
  if (!result.success) {
    return Response.json({ error: 'idle_timeout_minutes must be between 1 and 120' }, { status: 400 })
  }
  const args = [result.data.idle_timeout_minutes]
  await db.batch(
    [
      {
        sql: 'UPDATE heartbeats SET duration = NULL WHERE (SELECT idle_timeout_minutes FROM settings) != ?1',
        args,
      },
      { sql: 'DELETE FROM sessions WHERE (SELECT idle_timeout_minutes FROM settings) != ?1', args },
      {
        sql: 'UPDATE settings SET idle_timeout_minutes = ?1, rebuilt_at = NULL WHERE idle_timeout_minutes != ?1',
        args,
      },
    ],
    'write'
  )
  return new Response(null, { status: 204 })
}
