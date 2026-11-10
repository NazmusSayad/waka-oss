import { forward, forwardApiUrl } from '@/server/ingest.ts'

async function passThrough(request: Request) {
  const base = forwardApiUrl()
  if (base === null) {
    return new Response(null, { status: 404 })
  }
  const url = new URL(request.url)
  const target = `${base}${url.pathname.slice('/api/v1'.length)}${url.search}`
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer()

  let upstream: Response
  try {
    upstream = await forward(request.method, target, request.headers, body)
  } catch (error) {
    return new Response(String(error), { status: 502 })
  }
  const headers = new Headers(upstream.headers)
  for (const name of ['transfer-encoding', 'connection', 'content-encoding', 'content-length']) {
    headers.delete(name)
  }
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers })
}

export const GET = passThrough
export const POST = passThrough
export const PUT = passThrough
export const PATCH = passThrough
export const DELETE = passThrough
