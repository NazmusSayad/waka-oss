import { z } from 'zod'
import { db } from '@/server/db.ts'
import { rangeStatement, refreshStatements } from '@/server/rollups.ts'

const settingsSchema = z.object({ idle_timeout_minutes: z.int().min(1).max(120) })

export async function PUT(request: Request) {
  const result = settingsSchema.safeParse(await request.json())
  if (!result.success) {
    return Response.json({ error: 'idle_timeout_minutes must be between 1 and 120' }, { status: 400 })
  }
  const minutes = result.data.idle_timeout_minutes
  const transaction = await db.transaction('write')
  try {
    const changed = await transaction.execute({
      sql: 'UPDATE settings SET idle_timeout_minutes = ?1 WHERE idle_timeout_minutes != ?1',
      args: [minutes],
    })
    if (changed.rowsAffected === 1) {
      const range = (await transaction.execute(rangeStatement)).rows[0]
      const earliest = range?.[0]
      const latest = range?.[1]
      if (typeof earliest === 'number' && typeof latest === 'number') {
        await transaction.batch(refreshStatements(earliest, latest, minutes * 60))
      }
    }
    await transaction.commit()
  } finally {
    transaction.close()
  }
  return new Response(null, { status: 204 })
}
