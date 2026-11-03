# WakaTime Deep Analytics — Plan

Personal coding analytics that run on any server. The app receives heartbeats directly from `wakatime-cli`, stores every field, and forwards each heartbeat to WakaTime. Its dashboard goes deeper than WakaTime or Wakapi. Reloading the page shows the latest data.

## Architecture

```
Editor plugins → wakatime-cli ──POST──► Rust server /api/v1/... ──► SQLite (raw heartbeats)
                                          │
                                          └─ background task ─► api.wakatime.com (forward)

Browser (React dashboard) ──GET /api/...──► Rust server: SQL aggregation → JSON
```

- **Backend:** Rust, using `axum`, `tokio`, `sqlx` with SQLite (including its migrations), `reqwest` with `rustls` for forwarding (no OpenSSL, which keeps the `musl` build simple), `chrono-tz` for timezones, and `rust-embed` to build the UI into the server program.
- **Database:** SQLite, a single file (`data.db`) next to the server program. It was picked over Postgres for speed: it runs inside the server process, so queries skip the network round trip to a separate Postgres server. With one person's data, that makes it as fast or faster. For more speed it uses WAL mode, `synchronous=NORMAL`, and indexes that cover the dashboard queries.
- **Frontend:** Vite, React, TypeScript and ECharts.
- **Deployment:** one program file that contains the server and the built UI, plus `data.db`. No Docker and no separate database server. A Dockerfile can be added later if a host only accepts containers.
- **Dashboard protection:** HTTP Basic auth on the dashboard and `/api/*` routes. The password comes from the `DASHBOARD_PASSWORD` environment variable, and the browser shows its own login prompt, so no login UI is needed.
- **Ingest protection:** the `/api/v1/*` routes check the API key that wakatime-cli sends against `WAKATIME_API_KEY`.

## Monorepo layout

```
waka-oss/
├── Cargo.toml            # Cargo workspace: members = ["apps/server"]
├── package.json          # root scripts: dev, build
├── pnpm-workspace.yaml   # packages: ["apps/web"]
├── apps/
│   ├── server/           # Rust crate
│   │   ├── Cargo.toml
│   │   ├── migrations/
│   │   └── src/
│   └── web/              # Vite + React app
│       ├── package.json
│       ├── vite.config.ts
│       └── src/
└── PLAN.md
```

- **Development:** Run `cargo run -p server` (port 3000) and `pnpm --filter web dev` (Vite). Vite proxies `/api` to port 3000. Point wakatime-cli at the server with `api_url = http://localhost:3000/api/v1` in `~/.wakatime.cfg`. The server's embedded UI folder is set with `allow_missing = true`, so `cargo run` works before the web app has ever been built.
- **Release build:** the root `pnpm build` script builds the web app into `apps/web/dist`, then runs `cargo build --release --target x86_64-unknown-linux-musl`. `rust-embed` puts `dist` inside the program, and the `musl` target makes it run on any Linux server, whatever system libraries it has. The result is one file: `target/x86_64-unknown-linux-musl/release/server`.
- **Types:** the API's TypeScript types are written by hand in `apps/web`. There are only a few endpoints, so generating them from Rust isn't needed yet.

## Data model (SQLite)

**`heartbeats`**: one row per heartbeat, with every field wakatime-cli sends:
`time, entity, type, category, project, branch, language, dependencies (JSON), lines, lineno, cursorpos, is_write, project_root_count, human_line_changes, ai_line_changes, ai_session, ai_input_tokens, ai_output_tokens, ai_cached_input_tokens, ai_prompt_length, ai_subscription_plan, user_agent`

The server also adds these columns:
- `editor` and `os`, parsed from the user agent.
- `machine`, from the `X-Machine-Name` header.
- `local_date` and `local_hour`, computed in Rust with the `TIMEZONE` environment variable (an IANA timezone name). SQLite can't handle timezones correctly across daylight-saving changes.

A missing `category` is stored as `coding` (wakatime-cli leaves it out for plain coding), and an empty `branch` is stored as `null`.

Duplicates are skipped with `UNIQUE(time, entity)` and `INSERT OR IGNORE`, because wakatime-cli can resend heartbeats from its offline queue.

Indexes: `(time)` and `(local_date)`.

## How time is computed

This follows WakaTime's method. Each heartbeat gets the time until the next heartbeat. If that gap is more than **15 minutes**, the heartbeat gets 0 seconds and the session ends there. Time that runs past midnight or an hour boundary is counted in the hour the heartbeat started.

Durations are stored in `heartbeats.duration`. Whenever heartbeats are written (live ingest or import), the server recomputes durations around the new heartbeats, then rebuilds the summary tables for the affected local dates:

- `activity`: one row per `(date, hour, project, language, branch, category, editor, os, machine)`.
- `file_activity`: one row per `(date, project, entity, type, language)`.
- `dependency_activity`: one row per `(date, project, dependency)`.
- `sessions`: one row per session (sessions are rebuilt from one day before the affected range).

Dashboard routes read only these tables, and SQLite builds the JSON response itself. Responses are compressed (gzip/brotli). With 3 years of real data (743k heartbeats), a full-history request takes 0.15–0.35 s.

## API

### Configuration (environment variables, `.env` loaded in development)

| Variable | Meaning |
|---|---|
| `PORT` | HTTP port |
| `DATABASE_PATH` | SQLite file path, created if missing |
| `TIMEZONE` | IANA timezone used for `local_date` / `local_hour`, e.g. `Asia/Dhaka` |
| `WAKATIME_API_KEY` | Key wakatime-cli must send |
| `DASHBOARD_PASSWORD` | Password for the dashboard (any username) |
| `FORWARD_API_URL` | Optional. Base URL heartbeats are forwarded to, same format as wakatime-cli's `api_url` (e.g. `https://api.wakatime.com/api/v1` or `https://wakapi.dev/api`). When unset, nothing is forwarded and pass-through routes return 404. |

### Ingest routes (wakatime-cli, `api_url = http(s)://<host>/api/v1`)

Auth: `Authorization: Basic base64(<key>)` (what wakatime-cli sends) or `Authorization: Bearer <key>`. Wrong or missing key → 401.

| Route | Behavior |
|---|---|
| `POST /api/v1/users/current/heartbeats.bulk` | Body: JSON array of heartbeats. Store with `INSERT OR IGNORE`, then forward the original body and the `Authorization`, `User-Agent`, `X-Machine-Name` and `Timezone` headers to `FORWARD_API_URL` + `/users/current/heartbeats.bulk` in a background task. Reply `202` with `{"responses": [[{"data": {"id": "<id>"}}, 201], ...]}`, one entry per heartbeat, in order. |
| `GET /api/v1/users/current/statusbar/today` | WakaTime summary shape built from our own data: `{"cached_at", "data": {"grand_total": {"decimal", "digital", "hours", "minutes", "text", "total_seconds"}, "categories": [{"name", "percent", "decimal", "digital", "hours", "minutes", "seconds", "text", "total_seconds"}], "projects": [], "languages": [], "editors": [], "machines": [], "operating_systems": [], "dependencies": [], "range": {"date", "start", "end", "text", "timezone"}}, "has_team_features": false}`. `text` looks like `3 hrs 12 mins`. |
| any other `/api/v1/*` | Passed to `FORWARD_API_URL` + the rest of the path and query, with method, body and the same headers; the response is returned as-is. |

### Dashboard routes

Auth: HTTP Basic, any username, password `DASHBOARD_PASSWORD`. Missing or wrong → `401` with `WWW-Authenticate: Basic realm="waka"`. Applies to `/api/*` (except `/api/v1/*`) and to the UI.

Dates are local dates (`YYYY-MM-DD`) in `TIMEZONE`; `from` and `to` are both inclusive. Times are unix seconds (float). Missing string values are `null`.

Durations: heartbeats ordered by `time`; each heartbeat's `duration` is `next.time - time` when that gap is ≤ 900 s, otherwise 0. The duration is counted in the heartbeat's own `local_date` and `local_hour`. For the last heartbeat in a range, the next heartbeat after the range is used.

Sessions: consecutive heartbeats where each gap is ≤ 900 s. A session belongs to the `local_date` of its first heartbeat.

**`GET /api/status`**
```json
{ "timezone": "Asia/Dhaka", "today": "2026-11-03", "server_time": 1793700000.0,
  "first_date": "2025-01-14",
  "last_heartbeat": { "time": 1793699900.0, "entity": "/x/main.rs", "project": "waka-oss", "language": "Rust", "branch": "main", "category": "coding", "editor": "vscode", "machine": "desktop" } }
```
`first_date` and `last_heartbeat` are `null` when the database is empty.

**`GET /api/activity?from&to`** — one row per `(date, hour, project, language, branch, category, editor, os, machine)`:
```json
{ "rows": [ { "date": "2026-11-03", "hour": 14, "project": "waka-oss", "language": "Rust", "branch": "main",
  "category": "coding", "editor": "vscode", "os": "linux", "machine": "desktop",
  "seconds": 1234.5, "heartbeats": 40, "writes": 3, "human_lines": 12, "ai_lines": 4,
  "ai_input_tokens": 0, "ai_output_tokens": 0 } ] }
```

**`GET /api/sessions?from&to`**
```json
{ "sessions": [ { "date": "2026-11-03", "start": 1793690000.0, "end": 1793697000.0, "seconds": 7000.0,
  "heartbeats": 120, "main_project": "waka-oss", "projects": ["waka-oss", "notes"],
  "languages": ["Rust", "TypeScript"], "file_switches": 34 } ] }
```
`seconds` is the sum of the session's heartbeat durations. `main_project` is the project with the most seconds. `file_switches` counts consecutive heartbeats whose `entity` differs.

**`GET /api/files?from&to`** — one row per `(project, entity, type, language)`:
```json
{ "rows": [ { "project": "waka-oss", "entity": "/x/src/main.rs", "type": "file", "language": "Rust",
  "seconds": 900.0, "heartbeats": 30, "writes": 5, "human_lines": 40, "ai_lines": 10 } ] }
```

**`GET /api/dependencies?from&to`** — one row per `(project, dependency)`, seconds of heartbeats whose `dependencies` include it:
```json
{ "rows": [ { "project": "waka-oss", "dependency": "axum", "seconds": 600.0 } ] }
```

**`GET /api/day?date`** — every heartbeat of that local date, ordered by time:
```json
{ "heartbeats": [ { "time": 1793690000.0, "duration": 45.2, "entity": "/x/main.rs", "type": "file",
  "category": "coding", "project": "waka-oss", "branch": "main", "language": "Rust", "editor": "vscode",
  "machine": "desktop", "is_write": true, "lineno": 10, "human_line_changes": 2, "ai_line_changes": 0 } ] }
```

Everything else that isn't `/api/*` serves the embedded UI, with `index.html` for unknown paths.

**Filtering:** the browser loads `/api/activity` once for the selected range and computes every chart, filter and drill-down from those rows.

## Dashboard

**Global controls (every view):**
- A date range with presets: today, 7 days, 30 days, this year, all time, or custom.
- A comparison with the previous period of the same length.
- Filter chips: click any project, language or branch in any chart to filter every view.
- A refresh button.

**Views:**
1. **Overview:**
   - Today, week and month totals, with the change from the previous period.
   - "Working on now", shown if the last heartbeat was under 15 minutes ago.
   - Daily totals.
   - Top projects and languages.
2. **Explore:**
   - A breakdown by any dimension: project, language, editor, OS, machine, branch or category.
   - Each breakdown shows as a share donut and as a stacked area over time.
   - A sankey chart linking project → language → category.
3. **Patterns:**
   - A GitHub-style calendar heatmap, plus an hour × weekday heatmap.
   - First and last activity of each day.
   - Session lengths and the longest focus sessions.
   - Context switches per hour.
   - Streaks.
   - Weekdays compared with weekends.
4. **Day timeline:** a Gantt view of one day, with a row for each project and file, showing sessions, gaps and breaks.
5. **Code:**
   - A treemap of time per folder and file.
   - The most edited files.
   - Time spent writing compared with time spent reading.
   - Line changes.
   - Dependencies used per project.
6. **AI vs human:**
   - `ai coding` time compared with human coding time.
   - AI line changes compared with human line changes.
   - Tokens per session and per project.
7. **Branches:** time per branch (a rough cost per feature or pull request) and how long each branch was active.

## Implementation steps

1. **Scaffold:** set up the monorepo layout, the root scripts, the Rust crate with config from environment variables (see Configuration), and the SQLite migration. Then set up the Vite and React app with the `/api` proxy.
2. **Ingest:**
   - Add the bulk heartbeat route, the API key check and the user-agent parsing.
   - Store the heartbeats, forward them, and add `statusbar/today` and the pass-through route.
   - Test by pointing `~/.wakatime.cfg` at the local server and coding for a few minutes.
3. **Stats API:** write the SQL for durations and sessions, then the `activity`, `sessions`, `files` and `day` endpoints.
4. **Dashboard:** build the layout and global controls, then views 1 to 7.
5. **History import:** `server import <export.json> <user_agents.json> <machine_names.json>`. The WakaTime export has editor/OS/machine only as IDs, so the two lookup files (every page of `/api/v1/users/current/user_agents` and `/machine_names`) translate them. Categories are lowercased to match wakatime-cli. It stops before writing anything if any ID is missing from the lookups.
6. **Release build:** add the root `pnpm build` script, then check locally that the program file alone serves the dashboard and receives heartbeats.
7. **Deploy (later):** copy the program file to any VPS and run it as a `systemd` service, which starts it on boot and restarts it after a crash. Put Caddy in front for HTTPS. Then set `api_url = https://<your-domain>/api/v1` on every machine. Backups are copies of `data.db`, made with SQLite's `.backup` command or `VACUUM INTO` so a write in progress can't corrupt the copy.

## Open items and risks

- **Always on:** the server should run all the time. If it's down, wakatime-cli keeps heartbeats in its offline queue and resends them later, so short outages lose no data.
- **Forwarding:** if WakaTime is down when a heartbeat arrives, that heartbeat is missing on WakaTime's side only.
- **One timezone:** days are split using the timezone in `TIMEZONE`. While you travel, days still follow your home timezone.
- **Check during step 2:** whether `human_line_changes` and `ai_line_changes` are net or total changes.
