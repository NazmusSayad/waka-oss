import type { Row } from '@libsql/client/web'
import { z } from 'zod'
import type { Statement } from './db.ts'
import { localTime } from './time.ts'

export const cacheControl = 'private, max-age=31536000, immutable'

const datePattern = /^\d{4}-\d{2}-\d{2}$/

export function readDate(params: URLSearchParams, name: string) {
  const value = params.get(name)
  if (value === null || !datePattern.test(value) || Number.isNaN(Date.parse(value))) {
    return null
  }
  return value
}

export function jsonText(rows: Row[]) {
  const value = rows[0]?.[0]
  if (typeof value !== 'string') {
    throw new Error('query did not return a JSON string')
  }
  return value
}

export function activityStatement(from: string, to: string): Statement {
  return {
    sql: `SELECT json_object('rows', json_group_array(json_object(
        'date', date, 'hour', hour, 'project', project, 'language', language, 'branch', branch,
        'category', category, 'editor', editor, 'os', os, 'machine', machine, 'seconds', seconds,
        'heartbeats', heartbeats, 'writes', writes, 'human_lines', human_lines, 'ai_lines', ai_lines,
        'ai_input_tokens', ai_input_tokens, 'ai_output_tokens', ai_output_tokens, 'lane_seconds', lane_seconds
      )))
      FROM (SELECT * FROM activity WHERE date BETWEEN ?1 AND ?2 ORDER BY date, hour, seconds DESC)`,
    args: [from, to],
  }
}

export function sessionsStatement(from: string, to: string): Statement {
  return {
    sql: `SELECT json_object('sessions', json_group_array(json_object(
        'date', date, 'start', start, 'end', "end", 'seconds', seconds, 'heartbeats', heartbeats,
        'main_project', main_project, 'projects', json(projects), 'languages', json(languages),
        'file_switches', file_switches
      )))
      FROM (SELECT * FROM sessions WHERE date BETWEEN ?1 AND ?2 ORDER BY start)`,
    args: [from, to],
  }
}

export function filesStatement(from: string, to: string): Statement {
  return {
    sql: `SELECT json_object('rows', json_group_array(json_object(
        'project', project, 'entity', entity, 'type', type, 'language', language, 'seconds', seconds,
        'heartbeats', heartbeats, 'writes', writes, 'human_lines', human_lines, 'ai_lines', ai_lines
      )))
      FROM (
        SELECT project, entity, type, language, TOTAL(seconds) AS seconds, SUM(heartbeats) AS heartbeats,
          SUM(writes) AS writes, SUM(human_lines) AS human_lines, SUM(ai_lines) AS ai_lines
        FROM file_activity
        WHERE date BETWEEN ?1 AND ?2
        GROUP BY project, entity, type, language
        ORDER BY seconds DESC
      )`,
    args: [from, to],
  }
}

export function dependenciesStatement(from: string, to: string): Statement {
  return {
    sql: `SELECT json_object('rows', json_group_array(json_object(
        'project', project, 'dependency', dependency, 'seconds', seconds
      )))
      FROM (
        SELECT project, dependency, TOTAL(seconds) AS seconds
        FROM dependency_activity
        WHERE date BETWEEN ?1 AND ?2
        GROUP BY project, dependency
        ORDER BY seconds DESC
      )`,
    args: [from, to],
  }
}

export function dayStatement(date: string): Statement {
  return {
    sql: `SELECT json_object('heartbeats', json_group_array(json_object(
        'time', time, 'duration', COALESCE(duration, 0), 'entity', entity, 'type', type, 'category', category,
        'project', project, 'branch', branch, 'language', language, 'editor', editor, 'machine', machine,
        'is_write', CASE WHEN is_write IS NULL THEN NULL WHEN is_write THEN json('true') ELSE json('false') END,
        'lineno', lineno, 'human_line_changes', human_line_changes, 'ai_line_changes', ai_line_changes
      )))
      FROM (SELECT * FROM heartbeats WHERE local_date = ?1 ORDER BY time, id)`,
    args: [date],
  }
}

export const filtersSchema = z.array(
  z.object({
    dimension: z.enum(['project', 'language', 'branch', 'category', 'editor', 'os', 'machine']),
    value: z.string().nullable(),
  })
)

export function parallelStatement(from: string, to: string, filters: z.infer<typeof filtersSchema>): Statement {
  const valuesByColumn = new Map<string, (string | null)[]>()
  for (const filter of filters) {
    const values = valuesByColumn.get(filter.dimension) ?? []
    values.push(filter.value)
    valuesByColumn.set(filter.dimension, values)
  }
  const columns = [...valuesByColumn.keys()].toSorted()
  let sql = `SELECT time, lane_duration FROM heartbeats
    WHERE time BETWEEN unixepoch(?, '-2 days') AND unixepoch(?, '+3 days') AND lane_duration > 0`
  const args: (string | null)[] = [from, to]
  for (const column of columns) {
    const values = valuesByColumn.get(column) ?? []
    sql += ` AND (${values.map(() => `${column} IS ?`).join(' OR ')})`
    args.push(...values)
  }
  return { sql, args }
}

type ParallelHour = {
  wall_seconds: number
  lane_seconds: number
  parallel_seconds: number
  peak_lanes: number
}

export function computeParallel(heartbeats: [number, number][], from: string, to: string) {
  const events: [number, number][] = []
  for (const [time, laneDuration] of heartbeats) {
    events.push([time, 1], [time + laneDuration, -1])
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  const hours = new Map<string, { date: string; hour: number } & ParallelHour>()
  const levels = new Map<number, number>()
  let active = 0
  let previous = 0
  let slot = Number.NEGATIVE_INFINITY
  let local = { date: '', hour: 0 }
  for (const [time, delta] of events) {
    if (active > 0 && time > previous) {
      const currentSlot = Math.floor(previous / 900)
      if (currentSlot !== slot) {
        slot = currentSlot
        local = localTime(slot * 900)
      }
      if (local.date >= from && local.date <= to) {
        const seconds = time - previous
        const key = `${local.date} ${String(local.hour).padStart(2, '0')}`
        const hour = hours.get(key) ?? {
          date: local.date,
          hour: local.hour,
          wall_seconds: 0,
          lane_seconds: 0,
          parallel_seconds: 0,
          peak_lanes: 0,
        }
        hour.wall_seconds += seconds
        hour.lane_seconds += seconds * active
        if (active > 1) {
          hour.parallel_seconds += seconds
        }
        hour.peak_lanes = Math.max(hour.peak_lanes, active)
        hours.set(key, hour)
        levels.set(active, (levels.get(active) ?? 0) + seconds)
      }
    }
    active += delta
    previous = time
  }

  return {
    hours: [...hours.entries()].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, hour]) => hour),
    levels: [...levels.entries()]
      .toSorted(([a], [b]) => a - b)
      .map(([lanes, seconds]) => ({ lanes, seconds })),
  }
}
