ALTER TABLE heartbeats ADD COLUMN lane_duration REAL NOT NULL DEFAULT 0;
ALTER TABLE activity ADD COLUMN lane_seconds REAL NOT NULL DEFAULT 0;

UPDATE heartbeats SET lane_duration = d.lane_duration
FROM (
    SELECT id, CASE WHEN LEAD(time) OVER lane - time <= (SELECT idle_timeout_minutes * 60.0 FROM settings)
        THEN LEAD(time) OVER lane - time ELSE 0.0 END AS lane_duration
    FROM heartbeats
    WINDOW lane AS (PARTITION BY ai_session ORDER BY time, id)
) AS d
WHERE heartbeats.id = d.id;

DELETE FROM activity;
INSERT INTO activity
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
GROUP BY local_date, local_hour, project, language, branch, category, editor, os, machine;
