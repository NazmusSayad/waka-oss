import { gunzipSync, gzipSync } from 'node:zlib'
import { idleTimeouts } from '../constants/idle-timeouts.ts'
import { db, type Statement } from './db.ts'
import { computeParallel } from './parallel.ts'
import { localTime } from './time.ts'

type Read = (statements: Statement[]) => Promise<ArrayLike<unknown>[][]>
type Write = (statements: Statement[]) => Promise<void>
type Heartbeat = ReturnType<typeof parseHeartbeat>

export type DayActivity = {
  hour: number
  project: string | null
  language: string | null
  branch: string | null
  category: string | null
  editor: string | null
  os: string | null
  machine: string | null
  heartbeats: number
  writes: number
  human_lines: number
  ai_lines: number
  ai_input_tokens: number
  ai_output_tokens: number
  seconds: number[]
  lane_seconds: number[]
}

export type DayFile = {
  project: string | null
  entity: string
  type: string | null
  language: string | null
  heartbeats: number
  writes: number
  human_lines: number
  ai_lines: number
  seconds: number[]
}

export type DayDependency = {
  project: string | null
  dependency: string
  seconds: number[]
}

export type DayParallel = {
  hours: { hour: number; wall_seconds: number; lane_seconds: number; parallel_seconds: number; peak_lanes: number }[]
  levels: { lanes: number; seconds: number }[]
}

export type DaySession = {
  start: number
  end: number
  seconds: number
  heartbeats: number
  projects: string[]
  languages: string[]
  file_switches: number
}

const idleSeconds = idleTimeouts.map((minutes) => minutes * 60)
const maxIdle = Math.max(...idleSeconds)
const parallelEdgeHours = Math.ceil((2 * maxIdle) / 3600) + 1

const saveDay = `INSERT INTO day_cache (date, chain_end, activity, files, dependencies, sessions, parallel)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  ON CONFLICT (date) DO UPDATE SET chain_end = excluded.chain_end, activity = excluded.activity, files = excluded.files,
    dependencies = excluded.dependencies, sessions = excluded.sessions, parallel = excluded.parallel`

const heartbeatColumns = `time, entity, type, category, project, branch, language, is_write,
  human_line_changes, ai_line_changes, ai_session, ai_input_tokens, ai_output_tokens, editor, os, machine,
  local_date, local_hour, id`

function followingStatement(after: number): Statement {
  return {
    sql: `SELECT ${heartbeatColumns} FROM heartbeats WHERE time > ?1 AND time <= ?1 + ?2 ORDER BY time, id`,
    args: [after, maxIdle],
  }
}

export async function rebuildIfDirty(minSecondsSinceLastRebuild: number) {
  await rebuild(
    minSecondsSinceLastRebuild,
    async (statements) => (await db.batch(statements, 'read')).map((result) => result.rows),
    async (statements) => {
      await db.batch(statements, 'write')
    }
  )
}

export async function rebuild(minSecondsSinceLastRebuild: number, read: Read, write: Write) {
  const settings = item(
    item(await read([{ sql: 'SELECT built_id, rebuilt_at, (SELECT MAX(id) FROM heartbeats) FROM settings', args: [] }]), 0),
    0
  )
  const builtId = number(settings[0])
  const rebuiltAt = numberOrNull(settings[1])
  const maxId = numberOrNull(settings[2])
  if (maxId === null || maxId <= builtId) {
    return
  }
  const now = Date.now() / 1000
  if (rebuiltAt !== null && now - rebuiltAt < minSecondsSinceLastRebuild) {
    return
  }

  const pending = await read([
    {
      sql: `WITH pending AS MATERIALIZED (
          SELECT local_date, MIN(time) AS first, MAX(time) AS last FROM heartbeats NOT INDEXED
          WHERE id > ?1 AND id <= ?2 GROUP BY local_date
        )
        SELECT local_date, first, last FROM pending
        UNION ALL
        SELECT day_cache.date, NULL, NULL FROM pending
        JOIN day_cache ON day_cache.chain_end >= pending.first - ?3 AND day_cache.date < pending.local_date`,
      args: [builtId, maxId, maxIdle],
    },
  ])
  const dirty = new Set<string>()
  for (const row of item(pending, 0)) {
    dirty.add(text(row[0]))
    const last = numberOrNull(row[2])
    if (last !== null) {
      dirty.add(localTime(number(row[1]) - 2 * maxIdle).date)
      dirty.add(localTime(last + maxIdle).date)
    }
  }
  if (dirty.size === 0) {
    throw new Error('pending heartbeats did not produce any dirty days')
  }

  const dates = [...dirty].toSorted()
  for (let index = 0; index < dates.length; index++) {
    const statements = [await buildDay(item(dates, index), read)]
    if (index === dates.length - 1) {
      statements.push({ sql: 'UPDATE settings SET built_id = ?1, rebuilt_at = ?2', args: [maxId, now] })
    }
    await write(statements)
  }
}

async function buildDay(date: string, read: Read): Promise<Statement> {
  const day = await read([
    { sql: `SELECT ${heartbeatColumns} FROM heartbeats WHERE local_date = ?1`, args: [date] },
    {
      sql: `SELECT project, dependencies,
          ${idleSeconds.map((idle) => `TOTAL(CASE WHEN gap <= ${idle} THEN gap ELSE 0 END)`).join(', ')}
        FROM (
          SELECT project, dependencies, COALESCE(
              LEAD(time) OVER (ORDER BY time, id),
              (SELECT MIN(next.time) FROM heartbeats AS next WHERE next.time > heartbeats.time)
            ) - time AS gap
          FROM heartbeats WHERE local_date = ?1
        )
        WHERE dependencies IS NOT NULL
        GROUP BY project, dependencies`,
      args: [date],
    },
    {
      sql: `SELECT time, id, ai_session FROM heartbeats WHERE local_date = ?1 AND local_hour >= ?2
        UNION ALL
        SELECT time, id, ai_session FROM heartbeats WHERE local_date = ?3 AND local_hour <= ?4`,
      args: [shiftDate(date, -1), 24 - parallelEdgeHours, shiftDate(date, 1), parallelEdgeHours],
    },
  ])
  const heartbeats = item(day, 0)
    .map(parseHeartbeat)
    .toSorted((a, b) => a.time - b.time || a.id - b.id)

  const parallelWindow = [
    ...item(day, 2).map((row) => ({ time: number(row[0]), id: number(row[1]), ai_session: textOrNull(row[2]) })),
    ...heartbeats,
  ].toSorted((a, b) => a.time - b.time || a.id - b.id)
  const parallelLanes = parallelWindow.map(() => Infinity)
  const nextInParallelLane = new Map<string | null, number>()
  for (let index = parallelWindow.length - 1; index >= 0; index--) {
    const heartbeat = item(parallelWindow, index)
    const next = nextInParallelLane.get(heartbeat.ai_session)
    if (next !== undefined) {
      parallelLanes[index] = item(parallelWindow, next).time - heartbeat.time
    }
    nextInParallelLane.set(heartbeat.ai_session, index)
  }
  const parallel: DayParallel[] = idleSeconds.map((idle) => {
    const lanes: [number, number][] = []
    for (let index = 0; index < parallelWindow.length; index++) {
      const lane = item(parallelLanes, index)
      if (lane > 0 && lane <= idle) {
        lanes.push([item(parallelWindow, index).time, lane])
      }
    }
    const result = computeParallel(lanes, date, date)
    return {
      hours: result.hours.map((hour) => ({
        hour: hour.hour,
        wall_seconds: round(hour.wall_seconds),
        lane_seconds: round(hour.lane_seconds),
        parallel_seconds: round(hour.parallel_seconds),
        peak_lanes: hour.peak_lanes,
      })),
      levels: result.levels.map((level) => ({ lanes: level.lanes, seconds: round(level.seconds) })),
    }
  })

  if (heartbeats.length === 0) {
    if (parallel.every((result) => result.hours.length === 0)) {
      return { sql: 'DELETE FROM day_cache WHERE date = ?1', args: [date] }
    }
    return { sql: saveDay, args: [date, null, pack([]), pack([]), pack([]), pack(idleSeconds.map(() => [])), pack(parallel)] }
  }

  const around = await read([
    { sql: 'SELECT MAX(time) FROM heartbeats WHERE time < ?1', args: [item(heartbeats, 0).time] },
    followingStatement(item(heartbeats, heartbeats.length - 1).time),
  ])
  const previousTime = numberOrNull(item(item(around, 0), 0)[0])
  const all = [...heartbeats]
  let following = item(around, 1)
  while (following.length > 0) {
    all.push(...following.map(parseHeartbeat))
    following = item(await read([followingStatement(item(all, all.length - 1).time)]), 0)
  }

  const gaps = all.map((heartbeat, index) => {
    const next = all[index + 1]
    return next === undefined ? Infinity : next.time - heartbeat.time
  })
  const laneGaps = all.map(() => Infinity)
  const nextInLane = new Map<string | null, number>()
  for (let index = all.length - 1; index >= 0; index--) {
    const heartbeat = item(all, index)
    const next = nextInLane.get(heartbeat.ai_session)
    if (next !== undefined) {
      laneGaps[index] = item(all, next).time - heartbeat.time
    }
    nextInLane.set(heartbeat.ai_session, index)
  }
  const chainEnds = all.map((heartbeat) => heartbeat.time)
  for (let index = all.length - 2; index >= 0; index--) {
    if (item(gaps, index) <= maxIdle) {
      chainEnds[index] = item(chainEnds, index + 1)
    }
  }

  const sessions: DaySession[][] = idleSeconds.map(() => [])
  for (let idleIndex = 0; idleIndex < idleSeconds.length; idleIndex++) {
    const idle = item(idleSeconds, idleIndex)
    let session: ReturnType<typeof startSession> | null = null
    function finish() {
      if (session === null) {
        return
      }
      item(sessions, idleIndex).push({
        start: session.start,
        end: session.end,
        seconds: round(session.seconds),
        heartbeats: session.heartbeats,
        projects: ranked(session.projects),
        languages: ranked(session.languages),
        file_switches: session.fileSwitches,
      })
    }
    for (let index = 0; index < all.length; index++) {
      const heartbeat = item(all, index)
      const previous = index === 0 ? previousTime : item(all, index - 1).time
      const continues = previous !== null && heartbeat.time - previous <= idle
      if (!continues) {
        finish()
        if (index >= heartbeats.length) {
          session = null
          break
        }
        session = startSession(heartbeat)
      } else if (session !== null && heartbeat.entity !== item(all, index - 1).entity) {
        session.fileSwitches++
      }
      if (session !== null) {
        const seconds = item(gaps, index) <= idle ? item(gaps, index) : 0
        session.end = heartbeat.time
        session.heartbeats++
        session.seconds += seconds
        addTo(session.projects, heartbeat.project, seconds)
        addTo(session.languages, heartbeat.language, seconds)
      }
    }
    finish()
  }

  const activity = new Map<string, DayActivity>()
  const files = new Map<string, DayFile>()
  for (let index = 0; index < heartbeats.length; index++) {
    const heartbeat = item(heartbeats, index)
    const gap = item(gaps, index)

    const activityId = JSON.stringify([
      heartbeat.local_hour,
      heartbeat.project,
      heartbeat.language,
      heartbeat.branch,
      heartbeat.category,
      heartbeat.editor,
      heartbeat.os,
      heartbeat.machine,
    ])
    const activityRow = activity.get(activityId) ?? {
      hour: heartbeat.local_hour,
      project: heartbeat.project,
      language: heartbeat.language,
      branch: heartbeat.branch,
      category: heartbeat.category,
      editor: heartbeat.editor,
      os: heartbeat.os,
      machine: heartbeat.machine,
      ...counters(),
      ai_input_tokens: 0,
      ai_output_tokens: 0,
      lane_seconds: idleSeconds.map(() => 0),
    }
    count(activityRow, heartbeat, gap)
    activityRow.ai_input_tokens += heartbeat.ai_input_tokens ?? 0
    activityRow.ai_output_tokens += heartbeat.ai_output_tokens ?? 0
    addDurations(activityRow.lane_seconds, item(laneGaps, index))
    activity.set(activityId, activityRow)

    const fileId = JSON.stringify([heartbeat.project, heartbeat.entity, heartbeat.type, heartbeat.language])
    const fileRow = files.get(fileId) ?? {
      project: heartbeat.project,
      entity: heartbeat.entity,
      type: heartbeat.type,
      language: heartbeat.language,
      ...counters(),
    }
    count(fileRow, heartbeat, gap)
    files.set(fileId, fileRow)
  }

  const dependencies = new Map<string, DayDependency>()
  for (const row of item(day, 1)) {
    const project = textOrNull(row[0])
    for (const name of dependencyNames(text(row[1]))) {
      const id = JSON.stringify([project, name])
      const dependency = dependencies.get(id) ?? { project, dependency: name, seconds: idleSeconds.map(() => 0) }
      for (let idleIndex = 0; idleIndex < idleSeconds.length; idleIndex++) {
        dependency.seconds[idleIndex] = item(dependency.seconds, idleIndex) + number(row[idleIndex + 2])
      }
      dependencies.set(id, dependency)
    }
  }

  return {
    sql: saveDay,
    args: [
      date,
      item(chainEnds, heartbeats.length - 1),
      pack([...activity.values()].map((row) => ({ ...row, seconds: row.seconds.map(round), lane_seconds: row.lane_seconds.map(round) }))),
      pack([...files.values()].map((row) => ({ ...row, seconds: row.seconds.map(round) }))),
      pack([...dependencies.values()].map((row) => ({ ...row, seconds: row.seconds.map(round) }))),
      pack(sessions),
      pack(parallel),
    ],
  }
}

function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

function counters() {
  return { heartbeats: 0, writes: 0, human_lines: 0, ai_lines: 0, seconds: idleSeconds.map(() => 0) }
}

function count(row: ReturnType<typeof counters>, heartbeat: Heartbeat, gap: number) {
  row.heartbeats++
  row.writes += heartbeat.is_write === 1 ? 1 : 0
  row.human_lines += heartbeat.human_line_changes ?? 0
  row.ai_lines += heartbeat.ai_line_changes ?? 0
  addDurations(row.seconds, gap)
}

function addDurations(target: number[], gap: number) {
  for (let index = 0; index < idleSeconds.length; index++) {
    if (gap <= item(idleSeconds, index)) {
      target[index] = item(target, index) + gap
    }
  }
}

function startSession(heartbeat: Heartbeat) {
  return {
    date: heartbeat.local_date,
    start: heartbeat.time,
    end: heartbeat.time,
    seconds: 0,
    heartbeats: 0,
    fileSwitches: 0,
    projects: new Map<string, number>(),
    languages: new Map<string, number>(),
  }
}

function addTo(totals: Map<string, number>, name: string | null, seconds: number) {
  if (name !== null) {
    totals.set(name, (totals.get(name) ?? 0) + seconds)
  }
}

function ranked(totals: Map<string, number>) {
  return [...totals.entries()]
    .toSorted((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map((entry) => entry[0])
}

function dependencyNames(json: string) {
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed)) {
    throw new Error(`dependencies is not an array: ${json}`)
  }
  return parsed.map((name) => text(name))
}

function pack(value: unknown) {
  return gzipSync(JSON.stringify(value))
}

export function unpack(value: unknown) {
  if (!(value instanceof ArrayBuffer) && !(value instanceof Uint8Array)) {
    throw new Error('expected a compressed day cache')
  }
  return JSON.parse(gunzipSync(new Uint8Array(value)).toString())
}

function round(seconds: number) {
  return Math.round(seconds * 1000) / 1000
}

function parseHeartbeat(row: ArrayLike<unknown>) {
  return {
    time: number(row[0]),
    entity: text(row[1]),
    type: textOrNull(row[2]),
    category: textOrNull(row[3]),
    project: textOrNull(row[4]),
    branch: textOrNull(row[5]),
    language: textOrNull(row[6]),
    is_write: numberOrNull(row[7]),
    human_line_changes: numberOrNull(row[8]),
    ai_line_changes: numberOrNull(row[9]),
    ai_session: textOrNull(row[10]),
    ai_input_tokens: numberOrNull(row[11]),
    ai_output_tokens: numberOrNull(row[12]),
    editor: textOrNull(row[13]),
    os: textOrNull(row[14]),
    machine: textOrNull(row[15]),
    local_date: text(row[16]),
    local_hour: number(row[17]),
    id: number(row[18]),
  }
}

export function item<T>(array: ArrayLike<T>, index: number) {
  const value = array[index]
  if (value === undefined) {
    throw new Error(`missing item ${index}`)
  }
  return value
}

export function text(value: unknown) {
  if (typeof value !== 'string') {
    throw new Error(`expected text, got ${String(value)}`)
  }
  return value
}

export function textOrNull(value: unknown) {
  return value === null ? null : text(value)
}

export function number(value: unknown) {
  if (typeof value !== 'number') {
    throw new Error(`expected a number, got ${String(value)}`)
  }
  return value
}

export function numberOrNull(value: unknown) {
  return value === null ? null : number(value)
}
