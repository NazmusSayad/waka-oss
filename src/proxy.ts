import { NextResponse, type NextRequest } from 'next/server'
import { requiredEnv } from '@/server/env.ts'
import { isValidSession, sessionCookie } from '@/server/session.ts'

function decodeBasic(header: string | null) {
  if (header === null || !header.startsWith('Basic ')) {
    return null
  }
  return Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  if (pathname.startsWith('/api/v1/')) {
    const header = request.headers.get('authorization')
    const key =
      header !== null && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : decodeBasic(header)
    if (key !== requiredEnv('API_KEY')) {
      return new NextResponse('invalid api key', { status: 401 })
    }
    return NextResponse.next()
  }
  if (pathname === '/api/auth/login' || pathname === '/api/auth/logout') {
    return NextResponse.next()
  }
  if (!isValidSession(request.cookies.get(sessionCookie)?.value)) {
    return Response.json({ error: 'login required' }, { status: 401 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
