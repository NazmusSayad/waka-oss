use axum::{
    Json,
    body::{Body, Bytes},
    extract::State,
    http::{
        HeaderMap, HeaderName, Method, StatusCode, Uri,
        header::{AUTHORIZATION, CONNECTION, CONTENT_TYPE, TRANSFER_ENCODING, USER_AGENT},
    },
    response::{IntoResponse, Response},
};
use chrono::{DateTime, NaiveTime, Timelike, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use chrono_tz::Tz;
use sqlx::SqliteConnection;

use crate::{AppError, AppState, rollups};

#[derive(Deserialize)]
pub struct Heartbeat {
    pub time: f64,
    entity: String,
    #[serde(rename = "type")]
    kind: Option<String>,
    category: Option<String>,
    project: Option<String>,
    branch: Option<String>,
    language: Option<String>,
    dependencies: Option<Vec<String>>,
    lines: Option<i64>,
    lineno: Option<i64>,
    cursorpos: Option<i64>,
    is_write: Option<bool>,
    project_root_count: Option<i64>,
    human_line_changes: Option<i64>,
    ai_line_changes: Option<i64>,
    ai_session: Option<String>,
    ai_input_tokens: Option<i64>,
    ai_output_tokens: Option<i64>,
    ai_cached_input_tokens: Option<i64>,
    ai_prompt_length: Option<i64>,
    ai_subscription_plan: Option<String>,
    pub user_agent: Option<String>,
}

pub async fn heartbeats_bulk(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, AppError> {
    let heartbeats: Vec<Heartbeat> = match serde_json::from_slice(&body) {
        Ok(heartbeats) => heartbeats,
        Err(e) => {
            return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": e.to_string() }))).into_response());
        }
    };
    let machine = headers
        .get("x-machine-name")
        .and_then(|value| value.to_str().ok());

    let mut ids = Vec::new();
    let mut tx = state.db.begin().await?;
    for heartbeat in &heartbeats {
        let Some(utc) = DateTime::from_timestamp_micros((heartbeat.time * 1_000_000.0).round() as i64)
        else {
            return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid time" }))).into_response());
        };
        insert(&mut tx, heartbeat, machine, utc.with_timezone(&state.tz)).await?;

        let id: i64 = sqlx::query_scalar("SELECT id FROM heartbeats WHERE time = ? AND entity = ?")
            .bind(heartbeat.time)
            .bind(&heartbeat.entity)
            .fetch_one(&mut *tx)
            .await?;
        ids.push(id.to_string());
    }
    let times = heartbeats.iter().map(|heartbeat| heartbeat.time);
    let earliest = times.clone().fold(f64::INFINITY, f64::min);
    let latest = times.fold(f64::NEG_INFINITY, f64::max);
    if !heartbeats.is_empty() {
        rollups::refresh(&mut tx, state.tz, earliest, latest).await?;
    }
    tx.commit().await?;

    if let Some(base) = state.forward_api_url.clone() {
        tokio::spawn(async move {
            let url = format!("{base}/users/current/heartbeats.bulk");
            match forward(&state.http, Method::POST, &url, &headers, body).await {
                Ok(response) if response.status().is_success() => {}
                Ok(response) => eprintln!("forward to {url} returned {}", response.status()),
                Err(e) => eprintln!("forward to {url} failed: {e}"),
            }
        });
    }

    let responses: Vec<Value> = ids
        .iter()
        .map(|id| json!([{ "data": { "id": id } }, 201]))
        .collect();
    Ok((StatusCode::ACCEPTED, Json(json!({ "responses": responses }))).into_response())
}

pub async fn insert(
    connection: &mut SqliteConnection,
    heartbeat: &Heartbeat,
    machine: Option<&str>,
    local: DateTime<Tz>,
) -> Result<(), sqlx::Error> {
    let (os, editor) = match &heartbeat.user_agent {
        Some(user_agent) => parse_user_agent(user_agent),
        None => (None, None),
    };
    let dependencies = heartbeat
        .dependencies
        .as_ref()
        .map(|dependencies| serde_json::to_string(dependencies).expect("strings serialize"));
    let category = match &heartbeat.category {
        Some(category) => category.to_lowercase(),
        None => "coding".to_string(),
    };

    sqlx::query(
        "INSERT OR IGNORE INTO heartbeats (time, entity, type, category, project, branch, language,
            dependencies, lines, lineno, cursorpos, is_write, project_root_count, human_line_changes,
            ai_line_changes, ai_session, ai_input_tokens, ai_output_tokens, ai_cached_input_tokens,
            ai_prompt_length, ai_subscription_plan, user_agent, editor, os, machine, local_date, local_hour)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(heartbeat.time)
    .bind(&heartbeat.entity)
    .bind(&heartbeat.kind)
    .bind(category)
    .bind(&heartbeat.project)
    .bind(heartbeat.branch.as_deref().filter(|branch| !branch.is_empty()))
    .bind(&heartbeat.language)
    .bind(dependencies)
    .bind(heartbeat.lines)
    .bind(heartbeat.lineno)
    .bind(heartbeat.cursorpos)
    .bind(heartbeat.is_write)
    .bind(heartbeat.project_root_count)
    .bind(heartbeat.human_line_changes)
    .bind(heartbeat.ai_line_changes)
    .bind(&heartbeat.ai_session)
    .bind(heartbeat.ai_input_tokens)
    .bind(heartbeat.ai_output_tokens)
    .bind(heartbeat.ai_cached_input_tokens)
    .bind(heartbeat.ai_prompt_length)
    .bind(&heartbeat.ai_subscription_plan)
    .bind(&heartbeat.user_agent)
    .bind(editor)
    .bind(os)
    .bind(machine)
    .bind(local.format("%Y-%m-%d").to_string())
    .bind(local.hour())
    .execute(connection)
    .await?;
    Ok(())
}

pub async fn statusbar_today(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let now = Utc::now();
    let today = now.with_timezone(&state.tz).date_naive();
    let date = today.to_string();
    let categories: Vec<(Option<String>, f64)> = sqlx::query_as(
        "SELECT category, TOTAL(seconds) AS seconds FROM activity
        WHERE date = ?1
        GROUP BY category ORDER BY seconds DESC",
    )
    .bind(&date)
    .fetch_all(&state.db)
    .await?;

    let total: f64 = categories.iter().map(|(_, seconds)| seconds).sum();
    let categories: Vec<Value> = categories
        .iter()
        .map(|(name, seconds)| {
            let mut category = summary_time(*seconds);
            category["name"] = json!(name);
            category["percent"] = json!(if total > 0.0 { seconds / total * 100.0 } else { 0.0 });
            category["seconds"] = json!(*seconds as i64 % 60);
            category
        })
        .collect();
    let start = today.and_time(NaiveTime::MIN).and_local_timezone(state.tz).earliest();
    let end = today
        .and_hms_opt(23, 59, 59)
        .expect("valid time")
        .and_local_timezone(state.tz)
        .latest();

    Ok(Json(json!({
        "cached_at": now.to_rfc3339(),
        "data": {
            "grand_total": summary_time(total),
            "categories": categories,
            "projects": [],
            "languages": [],
            "editors": [],
            "machines": [],
            "operating_systems": [],
            "dependencies": [],
            "range": {
                "date": date,
                "start": start.map(|start| start.to_rfc3339()),
                "end": end.map(|end| end.to_rfc3339()),
                "text": "Today",
                "timezone": state.tz.name(),
            },
        },
        "has_team_features": false,
    })))
}

pub async fn pass_through(
    State(state): State<AppState>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(base) = &state.forward_api_url else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let rest = uri.path().strip_prefix("/api/v1").expect("route is under /api/v1");
    let url = match uri.query() {
        Some(query) => format!("{base}{rest}?{query}"),
        None => format!("{base}{rest}"),
    };

    let upstream = match forward(&state.http, method, &url, &headers, body).await {
        Ok(upstream) => upstream,
        Err(e) => return (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    };
    let mut response = Response::builder().status(upstream.status());
    for (name, value) in upstream.headers() {
        if name != TRANSFER_ENCODING && name != CONNECTION {
            response = response.header(name, value);
        }
    }
    match upstream.bytes().await {
        Ok(bytes) => response.body(Body::from(bytes)).expect("valid response"),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

async fn forward(
    http: &reqwest::Client,
    method: Method,
    url: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> reqwest::Result<reqwest::Response> {
    let mut request = http.request(method, url).body(body);
    for name in [
        AUTHORIZATION,
        USER_AGENT,
        CONTENT_TYPE,
        HeaderName::from_static("x-machine-name"),
        HeaderName::from_static("timezone"),
    ] {
        if let Some(value) = headers.get(&name) {
            request = request.header(name, value);
        }
    }
    request.send().await
}

pub fn parse_user_agent(user_agent: &str) -> (Option<String>, Option<String>) {
    if !user_agent.starts_with("wakatime/") {
        let mut tokens = user_agent.split_whitespace();
        let editor = tokens
            .next()
            .and_then(|token| token.split_once('/'))
            .map(|(name, _)| name.to_lowercase());
        let os = tokens.next().and_then(|platform| platform.split_once('_')).map(|(os, _)| match os {
            "win" => "windows".to_string(),
            "mac" => "darwin".to_string(),
            other => other.to_string(),
        });
        return (os, editor);
    }
    let os = user_agent
        .split_once('(')
        .and_then(|(_, rest)| rest.split_once(')'))
        .and_then(|(platform, _)| {
            if platform.contains("microsoft-standard-WSL") {
                return Some("wsl".to_string());
            }
            platform.split_once('-').map(|(os, _)| os.to_string())
        });
    let tools: Vec<&str> = match user_agent.split_once(") ") {
        Some((_, rest)) => rest
            .split_whitespace()
            .filter_map(|token| token.split_once('/').map(|(name, _)| name))
            .filter(|name| !name.ends_with("-wakatime"))
            .collect(),
        None => Vec::new(),
    };
    let editor = match tools.as_slice() {
        [] => None,
        [only] => Some(only.to_lowercase()),
        [_, second, ..] => Some(second.to_lowercase()),
    };
    (os, editor)
}

fn summary_time(total_seconds: f64) -> Value {
    let whole = total_seconds as i64;
    let (hours, minutes, seconds) = (whole / 3600, whole % 3600 / 60, whole % 60);
    let mut parts = Vec::new();
    if hours > 0 {
        parts.push(format!("{hours} {}", if hours == 1 { "hr" } else { "hrs" }));
    }
    if minutes > 0 {
        parts.push(format!("{minutes} {}", if minutes == 1 { "min" } else { "mins" }));
    }
    if parts.is_empty() {
        parts.push(format!("{seconds} {}", if seconds == 1 { "sec" } else { "secs" }));
    }
    json!({
        "decimal": format!("{:.2}", total_seconds / 3600.0),
        "digital": format!("{hours}:{minutes:02}"),
        "hours": hours,
        "minutes": minutes,
        "text": parts.join(" "),
        "total_seconds": total_seconds,
    })
}
