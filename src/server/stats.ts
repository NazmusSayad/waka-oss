import { z } from 'zod'
import { idleTimeouts } from '../constants/idle-timeouts.ts'
import type { Statement } from './db.ts'
import {
  item,
  number,
  numberOrNull,
  text,
  textOrNull,
  unpack,
  type DayActivity,
  type DayDependency,
  type DayFile,
  type DayParallel,
  type DaySession,
} from './rollups.ts'

export const cacheControl = 'private, max-age=31536000, immutable'

const datePattern = /^\d{4}-\d{2}-\d{2}$/

export function readDate(params: URLSearchParams, name: string) {
  const value = params.get(name)
  if (value === null || !datePattern.test(value) || Number.isNaN(Date.parse(value))) {
    return null
  }
  return value
}

export function readIdle(params: URLSearchParams) {
  const minutes = Number(params.get('idle'))
  const index = idleTimeouts.indexOf(minutes)
  return index === -1 ? null : { minutes, index }
}

export function daysStatement(
  column: 'activity' | 'files' | 'dependencies' | 'sessions' | 'parallel',
  from: string,
  to: string
): Statement {
  return { sql: `SELECT date, ${column} FROM day_cache WHERE date BETWEEN ?1 AND ?2 ORDER BY date`, args: [from, to] }
}

export function activityRows(days: ArrayLike<unknown>[], idleIndex: number) {
  return days.flatMap((day) => {
    const date = text(day[0])
    const activity: DayActivity[] = unpack(day[1])
    return activity
      .map((row) => ({
        date,
        hour: row.hour,
        project: row.project,
        language: row.language,
        branch: row.branch,
        category: row.category,
        editor: row.editor,
        os: row.os,
        machine: row.machine,
        seconds: item(row.seconds, idleIndex),
        heartbeats: row.heartbeats,
        writes: row.writes,
        human_lines: row.human_lines,
        ai_lines: row.ai_lines,
        ai_input_tokens: row.ai_input_tokens,
        ai_output_tokens: row.ai_output_tokens,
        lane_seconds: item(row.lane_seconds, idleIndex),
      }))
      .toSorted((a, b) => a.hour - b.hour || b.seconds - a.seconds)
  })
}

export function sessionRows(days: ArrayLike<unknown>[], idleIndex: number) {
  return days.flatMap((day) => {
    const date = text(day[0])
    const sessions: DaySession[][] = unpack(day[1])
    return item(sessions, idleIndex).map((session) => ({
      date,
      start: session.start,
      end: session.end,
      seconds: session.seconds,
      heartbeats: session.heartbeats,
      main_project: session.projects[0] ?? null,
      projects: session.projects,
      languages: session.languages,
      file_switches: session.file_switches,
    }))
  })
}

export function fileRows(days: ArrayLike<unknown>[], idleIndex: number) {
  const totals = new Map<string, Omit<DayFile, 'seconds'> & { seconds: number }>()
  for (const day of days) {
    const files: DayFile[] = unpack(day[1])
    for (const file of files) {
      const id = JSON.stringify([file.project, file.entity, file.type, file.language])
      const total = totals.get(id) ?? {
        project: file.project,
        entity: file.entity,
        type: file.type,
        language: file.language,
        seconds: 0,
        heartbeats: 0,
        writes: 0,
        human_lines: 0,
        ai_lines: 0,
      }
      total.seconds += item(file.seconds, idleIndex)
      total.heartbeats += file.heartbeats
      total.writes += file.writes
      total.human_lines += file.human_lines
      total.ai_lines += file.ai_lines
      totals.set(id, total)
    }
  }
  return [...totals.values()].toSorted((a, b) => b.seconds - a.seconds)
}

export function dependencyRows(days: ArrayLike<unknown>[], idleIndex: number) {
  const totals = new Map<string, { project: string | null; dependency: string; seconds: number }>()
  for (const day of days) {
    const dependencies: DayDependency[] = unpack(day[1])
    for (const dependency of dependencies) {
      const id = JSON.stringify([dependency.project, dependency.dependency])
      const total = totals.get(id) ?? { project: dependency.project, dependency: dependency.dependency, seconds: 0 }
      total.seconds += item(dependency.seconds, idleIndex)
      totals.set(id, total)
    }
  }
  return [...totals.values()].toSorted((a, b) => b.seconds - a.seconds)
}

export function parallelRows(days: ArrayLike<unknown>[], idleIndex: number) {
  const hours: ({ date: string } & DayParallel['hours'][number])[] = []
  const levels = new Map<number, number>()
  for (const day of days) {
    const date = text(day[0])
    const parallel: DayParallel[] = unpack(day[1])
    const result = item(parallel, idleIndex)
    for (const hour of result.hours) {
      hours.push({
        date,
        hour: hour.hour,
        wall_seconds: hour.wall_seconds,
        lane_seconds: hour.lane_seconds,
        parallel_seconds: hour.parallel_seconds,
        peak_lanes: hour.peak_lanes,
      })
    }
    for (const level of result.levels) {
      levels.set(level.lanes, (levels.get(level.lanes) ?? 0) + level.seconds)
    }
  }
  return {
    hours,
    levels: [...levels.entries()]
      .toSorted((a, b) => a[0] - b[0])
      .map((entry) => ({ lanes: entry[0], seconds: entry[1] })),
  }
}

export function dayStatement(date: string): Statement {
  return {
    sql: `SELECT time, entity, type, category, project, branch, language, editor, machine, is_write, lineno,
        human_line_changes, ai_line_changes, id
      FROM heartbeats WHERE local_date = ?1`,
    args: [date],
  }
}

export function dayHeartbeats(rows: ArrayLike<unknown>[], nextTime: number | null, idleMinutes: number) {
  const heartbeats = rows
    .map((row) => ({
      time: number(row[0]),
      entity: text(row[1]),
      type: textOrNull(row[2]),
      category: textOrNull(row[3]),
      project: textOrNull(row[4]),
      branch: textOrNull(row[5]),
      language: textOrNull(row[6]),
      editor: textOrNull(row[7]),
      machine: textOrNull(row[8]),
      is_write: row[9] === null ? null : number(row[9]) !== 0,
      lineno: numberOrNull(row[10]),
      human_line_changes: numberOrNull(row[11]),
      ai_line_changes: numberOrNull(row[12]),
      id: number(row[13]),
    }))
    .toSorted((a, b) => a.time - b.time || a.id - b.id)
  return heartbeats.map((heartbeat, index) => {
    const next = heartbeats[index + 1]?.time ?? nextTime
    const gap = next === null ? Infinity : next - heartbeat.time
    return {
      time: heartbeat.time,
      duration: gap <= idleMinutes * 60 ? gap : 0,
      entity: heartbeat.entity,
      type: heartbeat.type,
      category: heartbeat.category,
      project: heartbeat.project,
      branch: heartbeat.branch,
      language: heartbeat.language,
      editor: heartbeat.editor,
      machine: heartbeat.machine,
      is_write: heartbeat.is_write,
      lineno: heartbeat.lineno,
      human_line_changes: heartbeat.human_line_changes,
      ai_line_changes: heartbeat.ai_line_changes,
    }
  })
}

export const filtersSchema = z.array(
  z.object({
    dimension: z.enum(['project', 'language', 'branch', 'category', 'editor', 'os', 'machine']),
    value: z.string().nullable(),
  })
)

export function parallelStatement(
  from: string,
  to: string,
  filters: z.infer<typeof filtersSchema>,
  idleMinutes: number
): Statement {
  const valuesByColumn = new Map<string, (string | null)[]>()
  for (const filter of filters) {
    const values = valuesByColumn.get(filter.dimension) ?? []
    values.push(filter.value)
    valuesByColumn.set(filter.dimension, values)
  }
  const conditions: string[] = []
  const args: (string | null)[] = []
  for (const column of [...valuesByColumn.keys()].toSorted()) {
    const values = valuesByColumn.get(column) ?? []
    conditions.push(`(${values.map(() => `${column} IS ?`).join(' OR ')})`)
    args.push(...values)
  }
  return {
    sql: `SELECT time, lane FROM (
        SELECT time, ${conditions.length === 0 ? '1' : conditions.join(' AND ')} AS keep,
          LEAD(time) OVER (PARTITION BY ai_session ORDER BY time, id) - time AS lane
        FROM heartbeats
        WHERE time BETWEEN unixepoch(?, '-2 days') AND unixepoch(?, '+3 days')
      )
      WHERE keep AND lane > 0 AND lane <= ?`,
    args: [...args, from, to, idleMinutes * 60],
  }
}
