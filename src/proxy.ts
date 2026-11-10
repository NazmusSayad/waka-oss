import { NextResponse, type NextRequest } from 'next/server'
import { requiredEnv } from '@/server/env.ts'

function decodeBasic(header: string | null) {
  if (header === null || !header.startsWith('Basic ')) {
    return null
  }
  return Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
}

export function proxy(request: NextRequest) {
  const header = request.headers.get('authorization')
  if (request.nextUrl.pathname.startsWith('/api/v1/')) {
    const key =
      header !== null && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : decodeBasic(header)
    if (key !== requiredEnv('WAKATIME_API_KEY')) {
      return new NextResponse('invalid api key', { status: 401 })
    }
    return NextResponse.next()
  }
  const credentials = decodeBasic(header)
  const password = credentials === null ? null : credentials.slice(credentials.indexOf(':') + 1)
  if (password !== requiredEnv('DASHBOARD_PASSWORD')) {
    return new NextResponse('login required', {
      status: 401,
      headers: { 'www-authenticate': 'Basic realm="waka"' },
    })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
