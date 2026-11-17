import { createClient } from '@libsql/client/web'
import { env } from '../env.ts'

export type Statement = { sql: string; args: (string | number | null | Uint8Array)[] }

export const db = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
})
