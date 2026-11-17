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
    UNIQUE (time, entity)
);

CREATE INDEX heartbeats_time ON heartbeats (time);
CREATE INDEX heartbeats_local_hour ON heartbeats (local_date, local_hour);

CREATE TABLE day_cache (
    date TEXT PRIMARY KEY,
    chain_end REAL,
    activity BLOB NOT NULL,
    files BLOB NOT NULL,
    dependencies BLOB NOT NULL,
    sessions BLOB NOT NULL,
    parallel BLOB NOT NULL
);

CREATE INDEX day_cache_chain_end ON day_cache (chain_end);

CREATE TABLE settings (
    idle_timeout_minutes INTEGER NOT NULL,
    built_id INTEGER NOT NULL DEFAULT 0,
    rebuilt_at REAL
);

INSERT INTO settings (idle_timeout_minutes) VALUES (15);
