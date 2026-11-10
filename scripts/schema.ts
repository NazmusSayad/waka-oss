import { readFileSync } from 'node:fs'
import { db } from '../src/server/db.ts'

await db.executeMultiple(readFileSync(new URL('../src/server/schema.sql', import.meta.url), 'utf8'))
console.log('schema created')
