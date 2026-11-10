CREATE TABLE heartbeats (
    id INTEGER PRIMARY KEY,
    time REAL NOT NULL,
    entity TEXT NOT NULL,
    type TEXT,
    category TEXT,
    project TEXT,
    branch TEXT,
    language TEXT,
    dependencies TEXT,
    lines INTEGER,
    lineno INTEGER,
    cursorpos INTEGER,
    is_write INTEGER,
    project_root_count INTEGER,
    human_line_changes INTEGER,
    ai_line_changes INTEGER,
    ai_session TEXT,
    ai_input_tokens INTEGER,
    ai_output_tokens INTEGER,
    ai_cached_input_tokens INTEGER,
    ai_prompt_length INTEGER,
    ai_subscription_plan TEXT,
    user_agent TEXT,
    editor TEXT,
    os TEXT,
    machine TEXT,
    local_date TEXT NOT NULL,
    local_hour INTEGER NOT NULL,
    duration REAL NOT NULL DEFAULT 0,
    lane_duration REAL NOT NULL DEFAULT 0,
    UNIQUE (time, entity)
);

CREATE INDEX heartbeats_time ON heartbeats (time);
CREATE INDEX heartbeats_local_date ON heartbeats (local_date);

CREATE TABLE activity (
    date TEXT NOT NULL,
    hour INTEGER NOT NULL,
    project TEXT,
    language TEXT,
    branch TEXT,
    category TEXT,
    editor TEXT,
    os TEXT,
    machine TEXT,
    seconds REAL NOT NULL,
    heartbeats INTEGER NOT NULL,
    writes INTEGER NOT NULL,
    human_lines INTEGER NOT NULL,
    ai_lines INTEGER NOT NULL,
    ai_input_tokens INTEGER NOT NULL,
    ai_output_tokens INTEGER NOT NULL,
    lane_seconds REAL NOT NULL DEFAULT 0
);

CREATE INDEX activity_date ON activity (date);

CREATE TABLE file_activity (
    date TEXT NOT NULL,
    project TEXT,
    entity TEXT NOT NULL,
    type TEXT,
    language TEXT,
    seconds REAL NOT NULL,
    heartbeats INTEGER NOT NULL,
    writes INTEGER NOT NULL,
    human_lines INTEGER NOT NULL,
    ai_lines INTEGER NOT NULL
);

CREATE INDEX file_activity_date ON file_activity (date);

CREATE TABLE dependency_activity (
    date TEXT NOT NULL,
    project TEXT,
    dependency TEXT NOT NULL,
    seconds REAL NOT NULL
);

CREATE INDEX dependency_activity_date ON dependency_activity (date);

CREATE TABLE sessions (
    date TEXT NOT NULL,
    start REAL NOT NULL,
    "end" REAL NOT NULL,
    seconds REAL NOT NULL,
    heartbeats INTEGER NOT NULL,
    main_project TEXT,
    projects TEXT NOT NULL,
    languages TEXT NOT NULL,
    file_switches INTEGER NOT NULL
);

CREATE INDEX sessions_date ON sessions (date);
CREATE INDEX sessions_end ON sessions ("end");

CREATE TABLE settings (
    idle_timeout_minutes INTEGER NOT NULL,
    dirty_from REAL,
    rebuilt_at REAL
);

INSERT INTO settings (idle_timeout_minutes) VALUES (15);
