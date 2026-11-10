import { db, type Statement } from './db.ts'
import { localTime } from './time.ts'

export function markDirtyStatement(earliest: number): Statement {
  return {
    sql: 'UPDATE settings SET dirty_from = MIN(COALESCE(dirty_from, ?1), ?1)',
    args: [earliest],
  }
}

export async function rebuildIfDirty() {
  const state = await db.execute(`SELECT dirty_from, idle_timeout_minutes * 60.0,
      (SELECT MIN(start) FROM sessions WHERE "end" >= settings.dirty_from - settings.idle_timeout_minutes * 60.0)
    FROM settings`)
  const row = state.rows[0]
  const dirtyFrom = row?.[0]
  if (dirtyFrom === null) {
    return
  }
  if (typeof dirtyFrom !== 'number') {
    throw new Error('settings row is missing')
  }
  const idle = Number(row?.[1])
  const sessionFrom = row?.[2]
  await db.batch(
    [
      ...rebuildStatements(dirtyFrom, idle, typeof sessionFrom === 'number' ? sessionFrom : dirtyFrom),
      { sql: 'UPDATE settings SET dirty_from = NULL WHERE dirty_from = ?1', args: [dirtyFrom] },
    ],
    'write'
  )
}

export function rebuildStatements(dirtyFrom: number, idle: number, sessionFrom: number): Statement[] {
  const start = dirtyFrom - idle
  const local = localTime(start)
  const hour = [local.date, local.hour]
  const date = [local.date]
  return [
    {
      sql: `UPDATE heartbeats SET duration = d.duration, lane_duration = d.lane_duration
        FROM (
          SELECT id,
            CASE WHEN LEAD(time) OVER w - time <= ?2 THEN LEAD(time) OVER w - time ELSE 0.0 END AS duration,
            CASE WHEN LEAD(time) OVER lane - time <= ?2 THEN LEAD(time) OVER lane - time ELSE 0.0 END AS lane_duration
          FROM heartbeats
          WHERE time >= ?1
          WINDOW w AS (ORDER BY time, id), lane AS (PARTITION BY ai_session ORDER BY time, id)
        ) AS d
        WHERE heartbeats.id = d.id`,
      args: [start, idle],
    },
    { sql: 'DELETE FROM activity WHERE date >= ?1 AND (date > ?1 OR hour >= ?2)', args: hour },
    {
      sql: `INSERT INTO activity
        SELECT local_date, local_hour, project, language, branch, category, editor, os, machine,
          TOTAL(duration),
          COUNT(*),
          SUM(CASE WHEN is_write THEN 1 ELSE 0 END),
          COALESCE(SUM(human_line_changes), 0),
          COALESCE(SUM(ai_line_changes), 0),
          COALESCE(SUM(ai_input_tokens), 0),
          COALESCE(SUM(ai_output_tokens), 0),
          TOTAL(lane_duration)
        FROM heartbeats
        WHERE local_date >= ?1 AND (local_date > ?1 OR local_hour >= ?2)
        GROUP BY local_date, local_hour, project, language, branch, category, editor, os, machine`,
      args: hour,
    },
    { sql: 'DELETE FROM file_activity WHERE date >= ?1', args: date },
    {
      sql: `INSERT INTO file_activity
        SELECT local_date, project, entity, type, language,
          TOTAL(duration),
          COUNT(*),
          SUM(CASE WHEN is_write THEN 1 ELSE 0 END),
          COALESCE(SUM(human_line_changes), 0),
          COALESCE(SUM(ai_line_changes), 0)
        FROM heartbeats
        WHERE local_date >= ?1
        GROUP BY local_date, project, entity, type, language`,
      args: date,
    },
    { sql: 'DELETE FROM dependency_activity WHERE date >= ?1', args: date },
    {
      sql: `INSERT INTO dependency_activity
        SELECT h.local_date, h.project, j.value, TOTAL(h.duration)
        FROM heartbeats AS h, json_each(h.dependencies) AS j
        WHERE h.local_date >= ?1
        GROUP BY h.local_date, h.project, j.value`,
      args: date,
    },
    { sql: 'DELETE FROM sessions WHERE "end" >= ?1', args: [sessionFrom] },
    {
      sql: `WITH s AS MATERIALIZED (
          SELECT time, entity, project, language, local_date, duration,
            CASE WHEN time - LAG(time) OVER w <= ?2 THEN 0 ELSE 1 END AS starts_session,
            CASE WHEN time - LAG(time) OVER w <= ?2 AND entity IS NOT LAG(entity) OVER w THEN 1 ELSE 0 END AS switched
          FROM heartbeats
          WHERE time >= ?1
          WINDOW w AS (ORDER BY time, id)
        ),
        numbered AS MATERIALIZED (
          SELECT *, SUM(starts_session) OVER (ORDER BY time ROWS UNBOUNDED PRECEDING) AS session FROM s
        ),
        grouped AS MATERIALIZED (
          SELECT session, MIN(local_date) AS date, MIN(time) AS start, MAX(time) AS finish,
            TOTAL(duration) AS seconds, COUNT(*) AS heartbeats, SUM(switched) AS file_switches
          FROM numbered
          GROUP BY session
        ),
        projects AS MATERIALIZED (
          SELECT session, json_group_array(project) AS projects
          FROM (SELECT session, project, TOTAL(duration) AS seconds FROM numbered
            WHERE project IS NOT NULL GROUP BY session, project ORDER BY session, seconds DESC, project)
          GROUP BY session
        ),
        languages AS MATERIALIZED (
          SELECT session, json_group_array(language) AS languages
          FROM (SELECT session, language, TOTAL(duration) AS seconds FROM numbered
            WHERE language IS NOT NULL GROUP BY session, language ORDER BY session, seconds DESC, language)
          GROUP BY session
        )
        INSERT INTO sessions
        SELECT grouped.date, grouped.start, grouped.finish, grouped.seconds, grouped.heartbeats,
          json_extract(projects.projects, '$[0]'),
          COALESCE(projects.projects, '[]'),
          COALESCE(languages.languages, '[]'),
          grouped.file_switches
        FROM grouped
        LEFT JOIN projects ON projects.session = grouped.session
        LEFT JOIN languages ON languages.session = grouped.session`,
      args: [sessionFrom, idle],
    },
  ]
}
