import { rebuildIfDirty } from '@/server/rollups.ts'

export async function POST() {
  await rebuildIfDirty(5 * 60)
  return new Response(null, { status: 204 })
}
