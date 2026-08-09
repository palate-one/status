DROP INDEX check_samples_component_checked_at_idx;

CREATE INDEX check_samples_checked_at_id_idx
  ON check_samples (checked_at, id);

ALTER TABLE status_metadata ADD COLUMN latest_day TEXT
  CHECK (
    latest_day IS NULL OR (
      typeof(latest_day) = 'text' AND
      length(latest_day) = 10 AND
      latest_day GLOB '????-??-??' AND
      unixepoch(latest_day || 'T00:00:00Z') IS NOT NULL
    )
  );

ALTER TABLE status_metadata ADD COLUMN states_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(states_json) AND json_type(states_json) = 'array');

ALTER TABLE status_metadata ADD COLUMN daily_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(daily_json) AND json_type(daily_json) = 'array');

UPDATE status_metadata
SET
  latest_day = (SELECT MAX(day) FROM daily_uptime),
  states_json = (
    SELECT json_group_array(json_object(
      'component', component,
      'status', status,
      'consecutive_failures', consecutive_failures,
      'last_checked_at', last_checked_at,
      'last_success_at', last_success_at,
      'last_failure_at', last_failure_at
    ))
    FROM (
      SELECT *
      FROM component_state
      ORDER BY component
    )
  ),
  daily_json = (
    SELECT json_group_array(json_object(
      'day', day,
      'component', component,
      'up_samples', up_samples,
      'down_samples', down_samples,
      'expected_samples', expected_samples,
      'first_scheduled_at', first_scheduled_at,
      'last_scheduled_at', last_scheduled_at
    ))
    FROM (
      SELECT *
      FROM daily_uptime
      WHERE day BETWEEN date(
        (SELECT MAX(day) FROM daily_uptime),
        '-34 days'
      ) AND (SELECT MAX(day) FROM daily_uptime)
      ORDER BY day, component
    )
  )
WHERE id = 1;

CREATE TRIGGER check_samples_status_snapshot_window_after_insert
AFTER INSERT ON check_samples
BEGIN
  UPDATE status_metadata
  SET latest_day = CASE
    WHEN latest_day IS NULL THEN substr(NEW.scheduled_at, 1, 10)
    WHEN substr(NEW.scheduled_at, 1, 10) > latest_day
      THEN substr(NEW.scheduled_at, 1, 10)
    ELSE latest_day
  END
  WHERE id = 1;
END;
