import { createHmac } from 'node:crypto'
import { env } from '@/env.ts'

export const sessionCookie = 'session'
export const sessionMaxAgeSeconds = 30 * 24 * 60 * 60

function sign(value: string) {
  return createHmac('sha256', env.API_KEY).update(value).digest('base64url')
}

export function createSession() {
  const expires = String(Date.now() + sessionMaxAgeSeconds * 1000)
  return `${expires}.${sign(expires)}`
}

export function isValidSession(token: string | undefined) {
  if (token === undefined) {
    return false
  }
  const separator = token.indexOf('.')
  if (separator === -1) {
    return false
  }
  const expires = token.slice(0, separator)
  return token.slice(separator + 1) === sign(expires) && Number(expires) > Date.now()
}
