import { cookies } from 'next/headers'
import { z } from 'zod'
import { requiredEnv } from '@/server/env.ts'
import { createSession, sessionCookie, sessionMaxAgeSeconds } from '@/server/session.ts'

const loginSchema = z.object({ key: z.string() })

export async function POST(request: Request) {
  const result = loginSchema.safeParse(await request.json())
  if (!result.success) {
    return Response.json({ error: 'key is required' }, { status: 400 })
  }
  if (result.data.key !== requiredEnv('API_KEY')) {
    return Response.json({ error: 'wrong key' }, { status: 401 })
  }
  const cookieStore = await cookies()
  cookieStore.set(sessionCookie, createSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionMaxAgeSeconds,
  })
  return new Response(null, { status: 204 })
}
