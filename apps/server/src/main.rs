mod import;
mod ingest;
mod rollups;
mod stats;

use std::{env, time::Duration};

use axum::{
    Router,
    extract::{Request, State},
    http::{
        StatusCode, Uri,
        header::{AUTHORIZATION, CONTENT_TYPE},
    },
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get, post, put},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono_tz::Tz;
use rust_embed::RustEmbed;
use tower_http::compression::CompressionLayer;
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous},
};

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub tz: Tz,
    pub api_key: String,
    pub forward_api_url: Option<String>,
    pub http: reqwest::Client,
}

#[derive(RustEmbed)]
#[folder = "../web/dist"]
#[allow_missing = true]
struct Assets;

pub struct AppError(sqlx::Error);

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        AppError(error)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        eprintln!("database error: {}", self.0);
        (StatusCode::INTERNAL_SERVER_ERROR, "database error").into_response()
    }
}

fn required_env(name: &str) -> String {
    env::var(name).unwrap_or_else(|_| panic!("environment variable {name} must be set"))
}

#[tokio::main]
async fn main() {
    match dotenvy::dotenv() {
        Ok(_) => {}
        Err(e) if e.not_found() => {}
        Err(e) => panic!("failed to load .env: {e}"),
    }

    let database_path = required_env("DATABASE_PATH");
    let tz: Tz = required_env("TIMEZONE")
        .parse()
        .expect("TIMEZONE must be an IANA timezone name");

    let options = SqliteConnectOptions::new()
        .filename(&database_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(5));
    let db = SqlitePool::connect_with(options)
        .await
        .expect("failed to open database");
    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .expect("failed to run migrations");

    let args: Vec<String> = env::args().collect();
    match args.as_slice() {
        [_] => {}
        [_, command, export, user_agents, machine_names] if command == "import" => {
            import::run(db, tz, export, user_agents, machine_names).await;
            return;
        }
        _ => panic!("usage: server [import <export.json> <user_agents.json> <machine_names.json>]"),
    }

    let port: u16 = required_env("PORT").parse().expect("PORT must be a port number");
    let api_key = required_env("WAKATIME_API_KEY");
    let forward_api_url = match env::var("FORWARD_API_URL") {
        Ok(url) => Some(url.trim_end_matches('/').to_string()),
        Err(env::VarError::NotPresent) => None,
        Err(e) => panic!("FORWARD_API_URL is invalid: {e}"),
    };

    let state = AppState {
        db,
        tz,
        api_key,
        forward_api_url,
        http: reqwest::Client::new(),
    };

    let ingest_routes = Router::new()
        .route("/api/v1/users/current/heartbeats.bulk", post(ingest::heartbeats_bulk))
        .route("/api/v1/users/current/statusbar/today", get(ingest::statusbar_today))
        .route("/api/v1/{*rest}", any(ingest::pass_through))
        .route_layer(middleware::from_fn_with_state(state.clone(), ingest_auth));

    let dashboard_routes = Router::new()
        .route("/api/status", get(stats::status))
        .route("/api/settings", put(stats::update_settings))
        .route("/api/activity", get(stats::activity))
        .route("/api/sessions", get(stats::sessions))
        .route("/api/files", get(stats::files))
        .route("/api/dependencies", get(stats::dependencies))
        .route("/api/day", get(stats::day))
        .route("/api/parallel", get(stats::parallel))
        .fallback(ui);

    let app = ingest_routes
        .merge(dashboard_routes)
        .layer(CompressionLayer::new())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("failed to bind port");
    println!("listening on port {port}");
    axum::serve(listener, app).await.expect("server failed");
}

async fn ingest_auth(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let header = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let key = if let Some(encoded) = header.and_then(|value| value.strip_prefix("Basic ")) {
        STANDARD
            .decode(encoded)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
    } else if let Some(token) = header.and_then(|value| value.strip_prefix("Bearer ")) {
        Some(token.to_string())
    } else {
        None
    };
    if key.as_deref() != Some(state.api_key.as_str()) {
        return (StatusCode::UNAUTHORIZED, "invalid api key").into_response();
    }
    next.run(request).await
}

async fn ui(uri: Uri) -> Response {
    if uri.path().starts_with("/api/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    let path = uri.path().trim_start_matches('/');
    match Assets::get(path).or_else(|| Assets::get("index.html")) {
        Some(file) => (
            [(CONTENT_TYPE, file.metadata.mimetype().to_string())],
            file.data,
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
