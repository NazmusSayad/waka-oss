use chrono::DateTime;
use chrono_tz::Tz;
use sqlx::SqliteConnection;

pub async fn refresh(connection: &mut SqliteConnection, tz: Tz, earliest: f64, latest: f64) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE heartbeats SET duration = d.duration
        FROM (
            SELECT id, CASE WHEN LEAD(time) OVER w - time <= 900 THEN LEAD(time) OVER w - time ELSE 0.0 END AS duration
            FROM heartbeats
            WHERE time BETWEEN ?1 - 900 AND ?2 + 900
            WINDOW w AS (ORDER BY time, id)
        ) AS d
        WHERE heartbeats.id = d.id AND heartbeats.time BETWEEN ?1 - 900 AND ?2",
    )
    .bind(earliest)
    .bind(latest)
    .execute(&mut *connection)
    .await?;
    let local_date = |time: f64| {
        DateTime::from_timestamp_micros((time * 1_000_000.0).round() as i64)
            .expect("time was validated on insert")
            .with_timezone(&tz)
            .format("%Y-%m-%d")
            .to_string()
    };
    rebuild(connection, &local_date(earliest - 900.0), &local_date(latest)).await
}

async fn rebuild(connection: &mut SqliteConnection, from: &str, to: &str) -> Result<(), sqlx::Error> {
    for statement in [
        "DELETE FROM activity WHERE date BETWEEN ?1 AND ?2",
        "INSERT INTO activity
        SELECT local_date, local_hour, project, language, branch, category, editor, os, machine,
            TOTAL(duration),
            COUNT(*),
            SUM(CASE WHEN is_write THEN 1 ELSE 0 END),
            COALESCE(SUM(human_line_changes), 0),
            COALESCE(SUM(ai_line_changes), 0),
            COALESCE(SUM(ai_input_tokens), 0),
            COALESCE(SUM(ai_output_tokens), 0)
        FROM heartbeats
        WHERE local_date BETWEEN ?1 AND ?2
        GROUP BY local_date, local_hour, project, language, branch, category, editor, os, machine",
        "DELETE FROM file_activity WHERE date BETWEEN ?1 AND ?2",
        "INSERT INTO file_activity
        SELECT local_date, project, entity, type, language,
            TOTAL(duration),
            COUNT(*),
            SUM(CASE WHEN is_write THEN 1 ELSE 0 END),
            COALESCE(SUM(human_line_changes), 0),
            COALESCE(SUM(ai_line_changes), 0)
        FROM heartbeats
        WHERE local_date BETWEEN ?1 AND ?2
        GROUP BY local_date, project, entity, type, language",
        "DELETE FROM dependency_activity WHERE date BETWEEN ?1 AND ?2",
        "INSERT INTO dependency_activity
        SELECT h.local_date, h.project, j.value, TOTAL(h.duration)
        FROM heartbeats AS h, json_each(h.dependencies) AS j
        WHERE h.local_date BETWEEN ?1 AND ?2
        GROUP BY h.local_date, h.project, j.value",
        "DELETE FROM sessions WHERE date BETWEEN date(?1, '-1 day') AND ?2",
        "WITH s AS MATERIALIZED (
            SELECT time, entity, project, language, local_date, duration,
                CASE WHEN time - LAG(time) OVER w <= 900 THEN 0 ELSE 1 END AS starts_session,
                CASE WHEN time - LAG(time) OVER w <= 900 AND entity IS NOT LAG(entity) OVER w THEN 1 ELSE 0 END AS switched
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
            SELECT session, json_group_array(project ORDER BY seconds DESC, project) AS projects
            FROM (SELECT session, project, TOTAL(duration) AS seconds FROM numbered
                WHERE project IS NOT NULL GROUP BY session, project)
            GROUP BY session
        ),
        languages AS MATERIALIZED (
            SELECT session, json_group_array(language ORDER BY seconds DESC, language) AS languages
            FROM (SELECT session, language, TOTAL(duration) AS seconds FROM numbered
                WHERE language IS NOT NULL GROUP BY session, language)
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
        LEFT JOIN languages ON languages.session = grouped.session",
    ] {
        sqlx::query(statement).bind(from).bind(to).execute(&mut *connection).await?;
    }
    Ok(())
}
