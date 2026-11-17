import { idleTimeouts } from '../src/constants/idle-timeouts.ts'
import { db } from '../src/server/db.ts'
import { rebuildIfDirty } from '../src/server/rollups.ts'

const minutes = Number((await db.execute('SELECT idle_timeout_minutes FROM settings')).rows[0]?.[0])
if (!idleTimeouts.includes(minutes)) {
  throw new Error(`idle timeout ${minutes} is not supported; set it to one of ${idleTimeouts.join(', ')} first`)
}

await db.batch(
  [
    'DROP TABLE activity',
    'DROP TABLE file_activity',
    'DROP TABLE dependency_activity',
    'DROP TABLE sessions',
    'DROP TABLE rebuild_hours',
    'DROP TABLE rebuild_ranges',
    'DROP INDEX heartbeats_pending',
    'ALTER TABLE heartbeats DROP COLUMN duration',
    'ALTER TABLE heartbeats DROP COLUMN lane_duration',
    `CREATE TABLE day_cache (
      date TEXT PRIMARY KEY,
      chain_end REAL,
      activity BLOB NOT NULL,
      files BLOB NOT NULL,
      dependencies BLOB NOT NULL,
      sessions BLOB NOT NULL,
      parallel BLOB NOT NULL
    )`,
    'CREATE INDEX day_cache_chain_end ON day_cache (chain_end)',
    'ALTER TABLE settings ADD COLUMN built_id INTEGER NOT NULL DEFAULT 0',
  ],
  'write'
)
console.log('schema migrated, building the day cache')
const started = performance.now()
await rebuildIfDirty(0)
console.log(`day cache built in ${((performance.now() - started) / 1000).toFixed(0)}s`)
