import type { Statement } from './db.ts'
import { localTime } from './time.ts'

export const idleStatement: Statement = {
  sql: 'SELECT idle_timeout_minutes * 60.0 FROM settings',
  args: [],
}

export const rangeStatement: Statement = {
  sql: 'SELECT MIN(time), MAX(time) FROM heartbeats',
  args: [],
}

export function refreshStatements(earliest: number, latest: number, idle: number): Statement[] {
  const update: Statement = {
    sql: `UPDATE heartbeats SET duration = d.duration, lane_duration = d.lane_duration
      FROM (
        SELECT id,
          CASE WHEN LEAD(time) OVER w - time <= ?3 THEN LEAD(time) OVER w - time ELSE 0.0 END AS duration,
          CASE WHEN LEAD(time) OVER lane - time <= ?3 THEN LEAD(time) OVER lane - time ELSE 0.0 END AS lane_duration
        FROM heartbeats
        WHERE time BETWEEN ?1 - ?3 AND ?2 + ?3
        WINDOW w AS (ORDER BY time, id), lane AS (PARTITION BY ai_session ORDER BY time, id)
      ) AS d
      WHERE heartbeats.id = d.id AND heartbeats.time BETWEEN ?1 - ?3 AND ?2`,
    args: [earliest, latest, idle],
  }
  const from = localTime(earliest - idle).date
  const to = localTime(latest).date
  const dates = [from, to]
  return [
    update,
    { sql: 'DELETE FROM activity WHERE date BETWEEN ?1 AND ?2', args: dates },
    { sql: `INSERT INTO activity
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
  WHERE local_date BETWEEN ?1 AND ?2
  GROUP BY local_date, local_hour, project, language, branch, category, editor, os, machine`, args: dates },
    { sql: 'DELETE FROM file_activity WHERE date BETWEEN ?1 AND ?2', args: dates },
    { sql: `INSERT INTO file_activity
  SELECT local_date, project, entity, type, language,
    TOTAL(duration),
    COUNT(*),
    SUM(CASE WHEN is_write THEN 1 ELSE 0 END),
    COALESCE(SUM(human_line_changes), 0),
    COALESCE(SUM(ai_line_changes), 0)
  FROM heartbeats
  WHERE local_date BETWEEN ?1 AND ?2
  GROUP BY local_date, project, entity, type, language`, args: dates },
    { sql: 'DELETE FROM dependency_activity WHERE date BETWEEN ?1 AND ?2', args: dates },
    { sql: `INSERT INTO dependency_activity
  SELECT h.local_date, h.project, j.value, TOTAL(h.duration)
  FROM heartbeats AS h, json_each(h.dependencies) AS j
  WHERE h.local_date BETWEEN ?1 AND ?2
  GROUP BY h.local_date, h.project, j.value`, args: dates },
    { sql: `DELETE FROM sessions WHERE date BETWEEN date(?1, '-1 day') AND ?2`, args: dates },
    { sql: `WITH s AS MATERIALIZED (
    SELECT time, entity, project, language, local_date, duration,
      CASE WHEN time - LAG(time) OVER w <= ?3 THEN 0 ELSE 1 END AS starts_session,
      CASE WHEN time - LAG(time) OVER w <= ?3 AND entity IS NOT LAG(entity) OVER w THEN 1 ELSE 0 END AS switched
    FROM heartbeats
    WHERE local_date BETWEEN date(?1, '-2 day') AND date(?2, '+1 day')
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
    HAVING MIN(local_date) BETWEEN date(?1, '-1 day') AND ?2
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
  LEFT JOIN languages ON languages.session = grouped.session`, args: [...dates, idle] },
  ]
}
