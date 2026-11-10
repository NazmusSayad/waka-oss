import { db, type Statement } from './db.ts'

export async function rebuildIfDirty(minSecondsSinceLastRebuild: number) {
  const plan = await rebuildPlan(minSecondsSinceLastRebuild, async (statement) => (await db.execute(statement)).rows)
  if (plan !== null) {
    await db.batch(plan, 'write')
  }
}

export async function rebuildPlan(
  minSecondsSinceLastRebuild: number,
  read: (statement: Statement) => Promise<ArrayLike<unknown>[]>
) {
  const rows = await read({
    sql: `SELECT EXISTS (SELECT 1 FROM heartbeats WHERE duration IS NULL), idle_timeout_minutes * 60.0, rebuilt_at
      FROM settings`,
    args: [],
  })
  const row = rows[0]
  if (row === undefined) {
    throw new Error('settings row is missing')
  }
  if (row[0] === 0) {
    return null
  }
  if (row[0] !== 1) {
    throw new Error('unexpected pending check result')
  }
  const now = Date.now() / 1000
  const rebuiltAt = row[2]
  if (typeof rebuiltAt === 'number' && now - rebuiltAt < minSecondsSinceLastRebuild) {
    return null
  }
  return [...rebuildStatements(Number(row[1])), { sql: 'UPDATE settings SET rebuilt_at = ?1', args: [now] }]
}

export function rebuildStatements(idle: number): Statement[] {
  const args = [idle]
  return [
    {
      sql: `UPDATE heartbeats SET duration = NULL
        WHERE duration IS NOT NULL AND id IN (
          SELECT (SELECT b.id FROM heartbeats AS b
              WHERE b.time BETWEEN p.time - ?1 AND p.time AND (b.time, b.id) < (p.time, p.id)
              ORDER BY b.time DESC, b.id DESC LIMIT 1)
          FROM heartbeats AS p WHERE p.duration IS NULL
          UNION
          SELECT (SELECT b.id FROM heartbeats AS b
              WHERE b.time BETWEEN p.time - ?1 AND p.time AND (b.time, b.id) < (p.time, p.id)
                AND b.ai_session IS p.ai_session
              ORDER BY b.time DESC, b.id DESC LIMIT 1)
          FROM heartbeats AS p WHERE p.duration IS NULL
        )`,
      args,
    },
    {
      sql: `INSERT INTO rebuild_hours
        SELECT DISTINCT local_date, local_hour FROM heartbeats INDEXED BY heartbeats_pending WHERE duration IS NULL`,
      args: [],
    },
    {
      sql: `INSERT INTO rebuild_ranges
        WITH touched AS (
          SELECT
            MIN(p.time, COALESCE((
              SELECT CASE WHEN s.start <= p.time + ?1 THEN s.start END
              FROM sessions AS s WHERE s."end" >= p.time - ?1 ORDER BY s."end" LIMIT 1
            ), p.time)) AS lo,
            MAX(p.time, COALESCE((
              SELECT CASE WHEN s."end" >= p.time - ?1 THEN s."end" END
              FROM sessions AS s WHERE s.start <= p.time + ?1 ORDER BY s.start DESC LIMIT 1
            ), p.time)) AS hi
          FROM heartbeats AS p INDEXED BY heartbeats_pending
          WHERE p.duration IS NULL
        ),
        marked AS (
          SELECT lo, hi,
            CASE WHEN lo - MAX(hi) OVER (ORDER BY lo, hi ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) <= ?1
              THEN 0 ELSE 1 END AS starts_island
          FROM touched
        ),
        islands AS (
          SELECT lo, hi, SUM(starts_island) OVER (ORDER BY lo, hi ROWS UNBOUNDED PRECEDING) AS island FROM marked
        )
        SELECT MIN(lo), MAX(hi) FROM islands GROUP BY island`,
      args,
    },
    {
      sql: `DELETE FROM sessions WHERE rowid IN (
          SELECT s.rowid FROM rebuild_ranges AS r CROSS JOIN sessions AS s
          WHERE s."end" BETWEEN r.start AND r."end" AND s.start >= r.start
        )`,
      args: [],
    },
    {
      sql: `UPDATE heartbeats SET
          duration = COALESCE((
            SELECT CASE WHEN n.time - heartbeats.time <= ?1 THEN n.time - heartbeats.time ELSE 0.0 END
            FROM heartbeats AS n
            WHERE n.time BETWEEN heartbeats.time AND heartbeats.time + ?1 + 1
              AND (n.time, n.id) > (heartbeats.time, heartbeats.id)
            ORDER BY n.time, n.id LIMIT 1
          ), 0.0),
          lane_duration = COALESCE((
            SELECT CASE WHEN n.time - heartbeats.time <= ?1 THEN n.time - heartbeats.time ELSE 0.0 END
            FROM heartbeats AS n
            WHERE n.time BETWEEN heartbeats.time AND heartbeats.time + ?1 + 1
              AND (n.time, n.id) > (heartbeats.time, heartbeats.id)
              AND n.ai_session IS heartbeats.ai_session
            ORDER BY n.time, n.id LIMIT 1
          ), 0.0)
        WHERE duration IS NULL`,
      args,
    },
    {
      sql: `DELETE FROM activity WHERE rowid IN (
          SELECT a.rowid FROM rebuild_hours AS r CROSS JOIN activity AS a WHERE a.date = r.date AND a.hour = r.hour
        )`,
      args: [],
    },
    {
      sql: `INSERT INTO activity
        SELECT h.local_date, h.local_hour, h.project, h.language, h.branch, h.category, h.editor, h.os, h.machine,
          TOTAL(h.duration),
          COUNT(*),
          SUM(CASE WHEN h.is_write THEN 1 ELSE 0 END),
          COALESCE(SUM(h.human_line_changes), 0),
          COALESCE(SUM(h.ai_line_changes), 0),
          COALESCE(SUM(h.ai_input_tokens), 0),
          COALESCE(SUM(h.ai_output_tokens), 0),
          TOTAL(h.lane_duration)
        FROM rebuild_hours AS r CROSS JOIN heartbeats AS h
        WHERE h.local_date = r.date AND h.local_hour = r.hour
        GROUP BY h.local_date, h.local_hour, h.project, h.language, h.branch, h.category, h.editor, h.os, h.machine`,
      args: [],
    },
    {
      sql: 'DELETE FROM file_activity WHERE date IN (SELECT date FROM rebuild_hours)',
      args: [],
    },
    {
      sql: `INSERT INTO file_activity
        SELECT local_date, project, entity, type, language,
          TOTAL(duration),
          COUNT(*),
          SUM(CASE WHEN is_write THEN 1 ELSE 0 END),
          COALESCE(SUM(human_line_changes), 0),
          COALESCE(SUM(ai_line_changes), 0)
        FROM heartbeats
        WHERE local_date IN (SELECT date FROM rebuild_hours)
        GROUP BY local_date, project, entity, type, language`,
      args: [],
    },
    {
      sql: 'DELETE FROM dependency_activity WHERE date IN (SELECT date FROM rebuild_hours)',
      args: [],
    },
    {
      sql: `INSERT INTO dependency_activity
        SELECT g.local_date, g.project, j.value, TOTAL(g.seconds)
        FROM (
          SELECT local_date, project, dependencies, TOTAL(duration) AS seconds
          FROM heartbeats
          WHERE local_date IN (SELECT date FROM rebuild_hours) AND dependencies IS NOT NULL
          GROUP BY local_date, project, dependencies
        ) AS g, json_each(g.dependencies) AS j
        GROUP BY g.local_date, g.project, j.value`,
      args: [],
    },
    {
      sql: `WITH s AS MATERIALIZED (
          SELECT r.start AS island, h.id, h.time, h.entity, h.project, h.language, h.local_date, h.duration,
            CASE WHEN h.time - LAG(h.time) OVER w <= ?1 THEN 0 ELSE 1 END AS starts_session,
            CASE WHEN h.time - LAG(h.time) OVER w <= ?1 AND h.entity IS NOT LAG(h.entity) OVER w THEN 1 ELSE 0 END
              AS switched
          FROM rebuild_ranges AS r CROSS JOIN heartbeats AS h
          WHERE h.time BETWEEN r.start AND r."end"
          WINDOW w AS (PARTITION BY r.start ORDER BY h.time, h.id)
        ),
        numbered AS MATERIALIZED (
          SELECT *, SUM(starts_session) OVER (PARTITION BY island ORDER BY time, id ROWS UNBOUNDED PRECEDING) AS session
          FROM s
        ),
        grouped AS MATERIALIZED (
          SELECT island, session, MIN(local_date) AS date, MIN(time) AS start, MAX(time) AS finish,
            TOTAL(duration) AS seconds, COUNT(*) AS heartbeats, SUM(switched) AS file_switches
          FROM numbered
          GROUP BY island, session
        ),
        projects AS MATERIALIZED (
          SELECT island, session, json_group_array(project) AS projects
          FROM (SELECT island, session, project, TOTAL(duration) AS seconds FROM numbered
            WHERE project IS NOT NULL GROUP BY island, session, project ORDER BY island, session, seconds DESC, project)
          GROUP BY island, session
        ),
        languages AS MATERIALIZED (
          SELECT island, session, json_group_array(language) AS languages
          FROM (SELECT island, session, language, TOTAL(duration) AS seconds FROM numbered
            WHERE language IS NOT NULL GROUP BY island, session, language ORDER BY island, session, seconds DESC, language)
          GROUP BY island, session
        )
        INSERT INTO sessions
        SELECT grouped.date, grouped.start, grouped.finish, grouped.seconds, grouped.heartbeats,
          json_extract(projects.projects, '$[0]'),
          COALESCE(projects.projects, '[]'),
          COALESCE(languages.languages, '[]'),
          grouped.file_switches
        FROM grouped
        LEFT JOIN projects ON projects.island = grouped.island AND projects.session = grouped.session
        LEFT JOIN languages ON languages.island = grouped.island AND languages.session = grouped.session`,
      args,
    },
    { sql: 'DELETE FROM rebuild_hours', args: [] },
    { sql: 'DELETE FROM rebuild_ranges', args: [] },
  ]
}
