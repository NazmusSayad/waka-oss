use axum::{
    Json,
    extract::{Query, State},
    http::header::CONTENT_TYPE,
    response::{IntoResponse, Response},
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::{AppError, AppState};

#[derive(Deserialize)]
pub struct DateRange {
    from: NaiveDate,
    to: NaiveDate,
}

#[derive(Deserialize)]
pub struct DayQuery {
    date: NaiveDate,
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
    Ok(Json(json!({
        "timezone": state.tz.name(),
        "today": now.with_timezone(&state.tz).date_naive().to_string(),
        "server_time": now.timestamp_micros() as f64 / 1_000_000.0,
        "first_date": first_date,
        "last_heartbeat": last_heartbeat,
    })))
}

pub async fn activity(State(state): State<AppState>, Query(range): Query<DateRange>) -> Result<Response, AppError> {
    let body: String = sqlx::query_scalar(
        "SELECT json_object('rows', json_group_array(json_object(
            'date', date, 'hour', hour, 'project', project, 'language', language, 'branch', branch,
            'category', category, 'editor', editor, 'os', os, 'machine', machine, 'seconds', seconds,
            'heartbeats', heartbeats, 'writes', writes, 'human_lines', human_lines, 'ai_lines', ai_lines,
            'ai_input_tokens', ai_input_tokens, 'ai_output_tokens', ai_output_tokens
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

fn json_response(body: String) -> Response {
    ([(CONTENT_TYPE, "application/json")], body).into_response()
}
