import { z } from 'zod'

export const env = z
  .object({
    TIMEZONE: z.string().min(1),
    API_KEY: z.string().min(1),
    TURSO_DATABASE_URL: z.url(),
    TURSO_AUTH_TOKEN: z.string().min(1).optional(),
  })
  .parse(process.env)
