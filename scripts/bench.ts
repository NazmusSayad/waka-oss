import { readFileSync } from 'node:fs'
import { db, type Statement } from '../src/server/db.ts'
import { requiredEnv } from '../src/server/env.ts'
import { insertStatements, type Heartbeat } from '../src/server/ingest.ts'
import { idleStatement, rangeStatement, refreshStatements } from '../src/server/rollups.ts'
import {
  activityStatement,
  computeParallel,
  dayStatement,
  dependenciesStatement,
  filesStatement,
  parallelStatement,
  sessionsStatement,
} from '../src/server/stats.ts'
import { localTime } from '../src/server/time.ts'

type HranaValue =
  | { type: 'null' }
  | { type: 'integer'; value: string }
  | { type: 'float'; value: number }
  | { type: 'text'; value: string }

type ExecuteResult = {
  rows: HranaValue[][]
  rows_read: number
  rows_written: number
  query_duration_ms: number
}

type PipelineResponse = {
  results: (
    | { type: 'ok'; response: { type: 'execute'; result: ExecuteResult } | { type: 'close' } }
    | { type: 'error'; error: { message: string } }
  )[]
}

const endpoint = `${requiredEnv('TURSO_DATABASE_URL').replace(/^libsql:/, 'https:')}/v2/pipeline`
const token = requiredEnv('TURSO_AUTH_TOKEN')

function encode(value: string | number | null): HranaValue {
  if (value === null) {
    return { type: 'null' }
  }
  if (typeof value === 'string') {
    return { type: 'text', value }
  }
  if (Number.isInteger(value)) {
    return { type: 'integer', value: String(value) }
  }
  return { type: 'float', value }
}

function decode(value: HranaValue) {
  if (value.type === 'null') {
    return null
  }
  if (value.type === 'integer') {
    return Number(value.value)
  }
  return value.value
}

async function pipeline(statements: Statement[], transaction: boolean) {
  const steps = transaction
    ? [{ sql: 'BEGIN', args: [] }, ...statements, { sql: 'COMMIT', args: [] }]
    : statements
  const started = performance.now()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      requests: [
        ...steps.map((step) => ({
          type: 'execute',
          stmt: { sql: step.sql, args: step.args.map(encode) },
        })),
        { type: 'close' },
      ],
    }),
  })
  if (!response.ok) {
    throw new Error(`pipeline failed: ${response.status} ${await response.text()}`)
  }
  const json = (await response.json()) as PipelineResponse
  const wallMs = performance.now() - started
  const results: ExecuteResult[] = []
  for (const item of json.results) {
    if (item.type === 'error') {
      throw new Error(item.error.message)
    }
    if (item.response.type === 'execute') {
      results.push(item.response.result)
    }
  }
  return {
    results,
    wallMs,
    dbMs: results.reduce((sum, result) => sum + result.query_duration_ms, 0),
    rowsRead: results.reduce((sum, result) => sum + result.rows_read, 0),
    rowsWritten: results.reduce((sum, result) => sum + result.rows_written, 0),
  }
}

function random(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = random(42)
const pick = <T>(items: T[]): T => {
  const item = items[Math.floor(rand() * items.length)]
  if (item === undefined) {
    throw new Error('cannot pick from an empty list')
  }
  return item
}

const languages = ['TypeScript', 'TSX', 'Rust', 'Markdown', 'JSON', 'Python', 'CSS', 'SQL', 'YAML', 'Bash']
const extensions = ['ts', 'tsx', 'rs', 'md', 'json', 'py', 'css', 'sql', 'yaml', 'sh']
const dependencyPool = Array.from({ length: 80 }, (_, index) => `package-${index}`)
const projects = Array.from({ length: 40 }, (_, index) => ({
  name: `project-${index}`,
  files: Array.from({ length: 60 }, (_, file) => file),
  branches: ['main', ...Array.from({ length: 7 }, (_, branch) => `feature/task-${index}-${branch}`)],
  dependencies: Array.from({ length: 10 }, () => pick(dependencyPool)),
}))
const userAgents = [
  'wakatime/v1.130.0 (linux-6.18.33.2-microsoft-standard-WSL2-x86_64) go1.25.0 claude-code/2.1.319 claude-code-wakatime/4.1.0',
  'wakatime/v1.130.0 (linux-6.18.0-x86_64) go1.25.0 vscode/1.106.0 vscode-wakatime/25.0.0',
]

function fakeHeartbeat(time: number, project: (typeof projects)[number], aiSession: string | null): Heartbeat {
  const file = pick(project.files)
  const language = file % languages.length
  const ai = aiSession !== null
  return {
    time,
    entity: `/home/dev/${project.name}/src/file-${file}.${extensions[language]}`,
    type: 'file',
    category: ai ? 'ai coding' : 'coding',
    project: project.name,
    branch: pick(project.branches),
    language: languages[language],
    dependencies: project.dependencies.slice(0, 6),
    lines: 50 + Math.floor(rand() * 900),
    lineno: Math.floor(rand() * 500),
    cursorpos: Math.floor(rand() * 20000),
    is_write: rand() < 0.25,
    human_line_changes: ai ? null : Math.floor(rand() * 10),
    ai_line_changes: ai ? Math.floor(rand() * 40) : null,
    ai_session: aiSession,
    ai_input_tokens: ai ? Math.floor(rand() * 20000) : null,
    ai_output_tokens: ai ? Math.floor(rand() * 4000) : null,
    user_agent: ai ? userAgents[0] : userAgents[1],
  }
}

function fakeYear(now: number) {
  const heartbeats: Heartbeat[] = []
  const todayStart = now - 14 * 3600
  for (let day = 364; day >= 0; day--) {
    if (rand() < 0.12) {
      continue
    }
    const count = Math.round(1000 * (0.3 + 1.4 * rand()) * (rand() < 0.05 ? 2.5 : 1))
    const dayProjects = Array.from({ length: 3 + Math.floor(rand() * 4) }, () => pick(projects))
    let time = todayStart - day * 86400 + rand() * 3600
    let project = pick(dayProjects)
    let sessions = [`session-${day}-0`]
    for (let index = 0; index < count && time < now; index++) {
      if (rand() < 0.02) {
        project = pick(dayProjects)
      }
      if (rand() < 0.03) {
        sessions = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, lane) => `session-${day}-${index}-${lane}`)
      }
      heartbeats.push(fakeHeartbeat(time, project, rand() < 0.67 ? pick(sessions) : null))
      time += rand() < 0.005 ? 1200 + rand() * 4200 : 1 + rand() * 25
    }
  }
  return heartbeats
}

function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

const schema = readFileSync(new URL('../src/server/schema.sql', import.meta.url), 'utf8')
const tables = ['heartbeats', 'activity', 'file_activity', 'dependency_activity', 'sessions', 'settings']

const existing = await db.execute('SELECT COUNT(*) FROM heartbeats')
if (Number(existing.rows[0]?.[0]) !== 0) {
  throw new Error('heartbeats table is not empty; the benchmark only runs on an empty database')
}

try {
  const now = Date.now() / 1000
  const heartbeats = fakeYear(now)
  const loadStarted = performance.now()
  const chunks: Statement[][] = []
  for (let index = 0; index < heartbeats.length; index += 1000) {
    chunks.push(
      heartbeats.slice(index, index + 1000).map((heartbeat) => {
        const [insert] = insertStatements(heartbeat, heartbeat.ai_session === null ? 'desktop' : 'laptop')
        if (insert === undefined) {
          throw new Error('missing insert statement')
        }
        return insert
      })
    )
  }
  for (let index = 0; index < chunks.length; index += 4) {
    await Promise.all(chunks.slice(index, index + 4).map((chunk) => db.batch(chunk, 'write')))
  }
  console.log(
    `loaded ${heartbeats.length} fake heartbeats (${Math.round(heartbeats.length / 365)}/day) in ${((performance.now() - loadStarted) / 1000).toFixed(0)}s`
  )

  const idle = Number((await db.execute(idleStatement)).rows[0]?.[0])
  const range = (await db.execute(rangeStatement)).rows[0]
  const full = await pipeline(refreshStatements(Number(range?.[0]), Number(range?.[1]), idle), true)
  const report: Record<string, Record<string, number>> = {}
  report['full rebuild (settings change)'] = {
    db_ms: Math.round(full.dbMs),
    rows_read: full.rowsRead,
    rows_written: full.rowsWritten,
  }

  let time = Number(range?.[1])
  const single: Awaited<ReturnType<typeof pipeline>>[] = []
  for (let index = 0; index < 20; index++) {
    time += 8
    const heartbeat = fakeHeartbeat(time, pick(projects), 'live-session')
    single.push(
      await pipeline([...insertStatements(heartbeat, 'laptop'), ...refreshStatements(time, time, idle)], true)
    )
  }
  const average = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  report['ingest: 1 heartbeat (avg of 20)'] = {
    db_ms: average(single.map((run) => run.dbMs)),
    rows_read: average(single.map((run) => run.rowsRead)),
    rows_written: average(single.map((run) => run.rowsWritten)),
  }
  const bulk = Array.from({ length: 25 }, () => {
    time += 8
    return fakeHeartbeat(time, pick(projects), 'live-session')
  })
  const bulkRun = await pipeline(
    [...bulk.flatMap((heartbeat) => insertStatements(heartbeat, 'laptop')), ...refreshStatements(bulk[0]?.time ?? time, time, idle)],
    true
  )
  report['ingest: 25 heartbeats (offline sync)'] = {
    db_ms: Math.round(bulkRun.dbMs),
    rows_read: bulkRun.rowsRead,
    rows_written: bulkRun.rowsWritten,
  }

  const today = localTime(now).date
  const ranges = [
    ['today', today],
    ['7d', shiftDate(today, -6)],
    ['30d', shiftDate(today, -29)],
    ['365d', shiftDate(today, -364)],
  ] as const
  const sizes: Record<string, number> = {}
  for (const [label, from] of ranges) {
    for (const [name, statement] of [
      ['activity', activityStatement(from, today)],
      ['sessions', sessionsStatement(from, today)],
      ['files', filesStatement(from, today)],
      ['dependencies', dependenciesStatement(from, today)],
    ] as const) {
      const run = await pipeline([statement], false)
      const text = run.results[0]?.rows[0]?.[0]
      report[`${name} ${label}`] = { db_ms: Math.round(run.dbMs), rows_read: run.rowsRead, rows_written: 0 }
      sizes[`${name} ${label}`] = text?.type === 'text' ? text.value.length : 0
    }
    const parallel = await pipeline([parallelStatement(from, today, [])], false)
    const rows = (parallel.results[0]?.rows ?? []).map((row): [number, number] => [
      Number(decode(row[0] ?? { type: 'null' })),
      Number(decode(row[1] ?? { type: 'null' })),
    ])
    const computeStarted = performance.now()
    computeParallel(rows, from, today)
    report[`parallel ${label}`] = {
      db_ms: Math.round(parallel.dbMs),
      rows_read: parallel.rowsRead,
      rows_written: 0,
      js_ms: Math.round(performance.now() - computeStarted),
    }
  }
  const day = await pipeline([dayStatement(today)], false)
  report['day timeline (today)'] = { db_ms: Math.round(day.dbMs), rows_read: day.rowsRead, rows_written: 0 }

  const pings: number[] = []
  for (let index = 0; index < 5; index++) {
    pings.push((await pipeline([{ sql: 'SELECT 1', args: [] }], false)).wallMs)
  }

  console.table(report)
  console.log('response sizes (KB):')
  console.table(Object.fromEntries(Object.entries(sizes).map(([key, value]) => [key, Math.round(value / 1024)])))
  console.log(`network round trip from this machine to Turso: ${Math.round(pings.toSorted((a, b) => a - b)[2] ?? 0)} ms`)
} finally {
  await db.batch(tables.map((table) => `DROP TABLE IF EXISTS ${table}`), 'write')
  await db.executeMultiple(schema)
  console.log('fake data deleted, empty schema recreated')
}
