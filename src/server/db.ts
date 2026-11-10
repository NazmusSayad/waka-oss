import { createClient } from '@libsql/client/web'
import { requiredEnv } from './env.ts'

export type Statement = { sql: string; args: (string | number | null)[] }

export const db = createClient({
  url: requiredEnv('TURSO_DATABASE_URL'),
  authToken: requiredEnv('TURSO_AUTH_TOKEN'),
})
