import { z } from 'zod'
import { idleTimeouts } from '@/constants/idle-timeouts.ts'
import { db } from '@/server/db.ts'

const settingsSchema = z.object({
  idle_timeout_minutes: z.int().refine((minutes) => idleTimeouts.includes(minutes)),
})

export async function PUT(request: Request) {
  const result = settingsSchema.safeParse(await request.json())
  if (!result.success) {
    return Response.json({ error: `idle_timeout_minutes must be one of ${idleTimeouts.join(', ')}` }, { status: 400 })
  }
  await db.execute({ sql: 'UPDATE settings SET idle_timeout_minutes = ?1', args: [result.data.idle_timeout_minutes] })
  return new Response(null, { status: 204 })
}
