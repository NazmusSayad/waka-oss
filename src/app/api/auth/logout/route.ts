import { cookies } from 'next/headers'
import { sessionCookie } from '@/server/session.ts'

export async function POST() {
  const cookieStore = await cookies()
  cookieStore.delete(sessionCookie)
  return new Response(null, { status: 204 })
}
