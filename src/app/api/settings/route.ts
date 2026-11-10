import { z } from 'zod'
import { db } from '@/server/db.ts'

const settingsSchema = z.object({ idle_timeout_minutes: z.int().min(1).max(120) })

export async function PUT(request: Request) {
  const result = settingsSchema.safeParse(await request.json())
  if (!result.success) {
    return Response.json({ error: 'idle_timeout_minutes must be between 1 and 120' }, { status: 400 })
  }
  await db.execute({
    sql: `UPDATE settings SET idle_timeout_minutes = ?1, dirty_from = (SELECT MIN(time) FROM heartbeats),
      rebuilt_at = NULL
      WHERE idle_timeout_minutes != ?1`,
    args: [result.data.idle_timeout_minutes],
  })
  return new Response(null, { status: 204 })
}
