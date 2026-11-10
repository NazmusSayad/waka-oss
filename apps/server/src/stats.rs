use axum::{
    Json,
    extract::{Query, State},
    http::{StatusCode, header::CONTENT_TYPE},
    response::{IntoResponse, Response},
};
use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDate, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::{AppError, AppState, rollups};

#[derive(Deserialize)]
pub struct DateRange {
    from: NaiveDate,
    to: NaiveDate,
}

#[derive(Deserialize)]
pub struct DayQuery {
    date: NaiveDate,
}

#[derive(Deserialize)]
pub struct Settings {
    idle_timeout_minutes: i64,
}

#[derive(Deserialize)]
pub struct ParallelQuery {
    from: NaiveDate,
    to: NaiveDate,
    filters: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Dimension {
    Project,
    Language,
    Branch,
    Category,
    Editor,
    Os,
    Machine,
}

#[derive(Deserialize)]
struct Filter {
    dimension: Dimension,
    value: Option<String>,
}

#[derive(Default)]
struct ParallelHour {
    wall_seconds: f64,
    lane_seconds: f64,
    parallel_seconds: f64,
    peak_lanes: i64,
}

#[derive(FromRow, Serialize)]
struct LastHeartbeat {
    time: f64,
    entity: String,
    project: Option<String>,
    language: Option<String>,
    branch: Option<String>,
    category: Option<String>,
    editor: Option<String>,
    machine: Option<String>,
}

pub async fn status(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let now = Utc::now();
    let first_date: Option<String> = sqlx::query_scalar("SELECT MIN(local_date) FROM heartbeats")
        .fetch_one(&state.db)
        .await?;
    let last_heartbeat: Option<LastHeartbeat> = sqlx::query_as(
        "SELECT time, entity, project, language, branch, category, editor, machine
        FROM heartbeats ORDER BY time DESC LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await?;
    let idle_timeout_minutes: i64 = sqlx::query_scalar("SELECT idle_timeout_minutes FROM settings")
        .fetch_one(&state.db)
        .await?;
    Ok(Json(json!({
        "timezone": state.tz.name(),
        "today": now.with_timezone(&state.tz).date_naive().to_string(),
        "server_time": now.timestamp_micros() as f64 / 1_000_000.0,
        "first_date": first_date,
        "last_heartbeat": last_heartbeat,
        "idle_timeout_minutes": idle_timeout_minutes,
    })))
}

pub async fn update_settings(State(state): State<AppState>, Json(settings): Json<Settings>) -> Result<Response, AppError> {
    if !(1..=120).contains(&settings.idle_timeout_minutes) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": "idle_timeout_minutes must be between 1 and 120" }))).into_response());
    }
    let mut tx = state.db.begin().await?;
    let changed = sqlx::query("UPDATE settings SET idle_timeout_minutes = ?1 WHERE idle_timeout_minutes != ?1")
        .bind(settings.idle_timeout_minutes)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if changed == 1 {
        rollups::refresh_all(&mut tx, state.tz).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

pub async fn activity(State(state): State<AppState>, Query(range): Query<DateRange>) -> Result<Response, AppError> {
    let body: String = sqlx::query_scalar(
        "SELECT json_object('rows', json_group_array(json_object(
            'date', date, 'hour', hour, 'project', project, 'language', language, 'branch', branch,
            'category', category, 'editor', editor, 'os', os, 'machine', machine, 'seconds', seconds,
            'heartbeats', heartbeats, 'writes', writes, 'human_lines', human_lines, 'ai_lines', ai_lines,
            'ai_input_tokens', ai_input_tokens, 'ai_output_tokens', ai_output_tokens, 'lane_seconds', lane_seconds
        ) ORDER BY date, hour, seconds DESC))
        FROM activity
        WHERE date BETWEEN ?1 AND ?2",
    )
    .bind(range.from.to_string())
    .bind(range.to.to_string())
    .fetch_one(&state.db)
    .await?;
    Ok(json_response(body))
}

pub async fn sessions(State(state): State<AppState>, Query(range): Query<DateRange>) -> Result<Response, AppError> {
    let body: String = sqlx::query_scalar(
        "SELECT json_object('sessions', json_group_array(json_object(
            'date', date, 'start', start, 'end', \"end\", 'seconds', seconds, 'heartbeats', heartbeats,
            'main_project', main_project, 'projects', json(projects), 'languages', json(languages),
            'file_switches', file_switches
        ) ORDER BY start))
        FROM sessions
        WHERE date BETWEEN ?1 AND ?2",
    )
    .bind(range.from.to_string())
    .bind(range.to.to_string())
    .fetch_one(&state.db)
    .await?;
    Ok(json_response(body))
}

pub async fn files(State(state): State<AppState>, Query(range): Query<DateRange>) -> Result<Response, AppError> {
    let body: String = sqlx::query_scalar(
        "SELECT json_object('rows', json_group_array(json_object(
            'project', project, 'entity', entity, 'type', type, 'language', language, 'seconds', seconds,
            'heartbeats', heartbeats, 'writes', writes, 'human_lines', human_lines, 'ai_lines', ai_lines
        ) ORDER BY seconds DESC))
        FROM (
            SELECT project, entity, type, language, TOTAL(seconds) AS seconds, SUM(heartbeats) AS heartbeats,
                SUM(writes) AS writes, SUM(human_lines) AS human_lines, SUM(ai_lines) AS ai_lines
            FROM file_activity
            WHERE date BETWEEN ?1 AND ?2
            GROUP BY project, entity, type, language
        )",
    )
    .bind(range.from.to_string())
    .bind(range.to.to_string())
    .fetch_one(&state.db)
    .await?;
    Ok(json_response(body))
}

pub async fn dependencies(State(state): State<AppState>, Query(range): Query<DateRange>) -> Result<Response, AppError> {
    let body: String = sqlx::query_scalar(
        "SELECT json_object('rows', json_group_array(json_object(
            'project', project, 'dependency', dependency, 'seconds', seconds
        ) ORDER BY seconds DESC))
        FROM (
            SELECT project, dependency, TOTAL(seconds) AS seconds
            FROM dependency_activity
            WHERE date BETWEEN ?1 AND ?2
            GROUP BY project, dependency
        )",
    )
    .bind(range.from.to_string())
    .bind(range.to.to_string())
    .fetch_one(&state.db)
    .await?;
    Ok(json_response(body))
}

pub async fn day(State(state): State<AppState>, Query(query): Query<DayQuery>) -> Result<Response, AppError> {
    let body: String = sqlx::query_scalar(
        "SELECT json_object('heartbeats', json_group_array(json_object(
            'time', time, 'duration', duration, 'entity', entity, 'type', type, 'category', category,
            'project', project, 'branch', branch, 'language', language, 'editor', editor, 'machine', machine,
            'is_write', CASE WHEN is_write IS NULL THEN NULL WHEN is_write THEN json('true') ELSE json('false') END,
            'lineno', lineno, 'human_line_changes', human_line_changes, 'ai_line_changes', ai_line_changes
        ) ORDER BY time, id))
        FROM heartbeats
        WHERE local_date = ?1",
    )
    .bind(query.date.to_string())
    .fetch_one(&state.db)
    .await?;
    Ok(json_response(body))
}

pub async fn parallel(State(state): State<AppState>, Query(query): Query<ParallelQuery>) -> Result<Response, AppError> {
    let filters: Vec<Filter> = match serde_json::from_str(&query.filters) {
        Ok(filters) => filters,
        Err(e) => {
            return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": e.to_string() }))).into_response());
        }
    };
    let mut values_by_column: BTreeMap<&str, Vec<Option<String>>> = BTreeMap::new();
    for filter in filters {
        let column = match filter.dimension {
            Dimension::Project => "project",
            Dimension::Language => "language",
            Dimension::Branch => "branch",
            Dimension::Category => "category",
            Dimension::Editor => "editor",
            Dimension::Os => "os",
            Dimension::Machine => "machine",
        };
        values_by_column.entry(column).or_default().push(filter.value);
    }
    let mut sql = String::from(
        "SELECT time, lane_duration FROM heartbeats
        WHERE time BETWEEN unixepoch(?, '-2 days') AND unixepoch(?, '+3 days') AND lane_duration > 0",
    );
    for (column, values) in &values_by_column {
        sql.push_str(&format!(" AND ({})", vec![format!("{column} IS ?"); values.len()].join(" OR ")));
    }
    let mut select = sqlx::query_as::<_, (f64, f64)>(sqlx::AssertSqlSafe(sql))
        .bind(query.from.to_string())
        .bind(query.to.to_string());
    for value in values_by_column.into_values().flatten() {
        select = select.bind(value);
    }
    let heartbeats = select.fetch_all(&state.db).await?;

    let mut events: Vec<(f64, i64)> = Vec::new();
    for (time, lane_duration) in heartbeats {
        events.push((time, 1));
        events.push((time + lane_duration, -1));
    }
    events.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));

    let mut hours: BTreeMap<(NaiveDate, u32), ParallelHour> = BTreeMap::new();
    let mut levels: BTreeMap<i64, f64> = BTreeMap::new();
    let mut active = 0;
    let mut previous = 0.0;
    let mut slot = i64::MIN;
    let mut local = (NaiveDate::MIN, 0);
    for (time, delta) in events {
        if active > 0 && time > previous {
            if (previous / 900.0).floor() as i64 != slot {
                slot = (previous / 900.0).floor() as i64;
                let start = DateTime::from_timestamp(slot * 900, 0)
                    .expect("time was validated on insert")
                    .with_timezone(&state.tz);
                local = (start.date_naive(), start.hour());
            }
            if local.0 >= query.from && local.0 <= query.to {
                let seconds = time - previous;
                let hour = hours.entry(local).or_default();
                hour.wall_seconds += seconds;
                hour.lane_seconds += seconds * active as f64;
                if active > 1 {
                    hour.parallel_seconds += seconds;
                }
                hour.peak_lanes = hour.peak_lanes.max(active);
                *levels.entry(active).or_default() += seconds;
            }
        }
        active += delta;
        previous = time;
    }

    Ok(Json(json!({
        "hours": hours.iter().map(|(key, hour)| json!({
            "date": key.0.to_string(),
            "hour": key.1,
            "wall_seconds": hour.wall_seconds,
            "lane_seconds": hour.lane_seconds,
            "parallel_seconds": hour.parallel_seconds,
            "peak_lanes": hour.peak_lanes,
        })).collect::<Vec<_>>(),
        "levels": levels.iter().map(|(lanes, seconds)| json!({ "lanes": lanes, "seconds": seconds })).collect::<Vec<_>>(),
    }))
    .into_response())
}

fn json_response(body: String) -> Response {
    ([(CONTENT_TYPE, "application/json")], body).into_response()
}
