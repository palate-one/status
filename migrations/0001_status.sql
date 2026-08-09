CREATE TABLE check_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL CHECK (component IN ('web', 'api')),
  scheduled_at TEXT NOT NULL
    CHECK (unixepoch(scheduled_at) IS NOT NULL)
    CHECK (scheduled_at GLOB '????-??-??T??:??:00Z')
    CHECK (CAST(strftime('%M', scheduled_at) AS INTEGER) % 5 = 3),
  checked_at TEXT NOT NULL CHECK (unixepoch(checked_at) IS NOT NULL),
  result TEXT NOT NULL CHECK (result IN ('up', 'down')),
  latency_ms INTEGER NOT NULL
    CHECK (typeof(latency_ms) = 'integer' AND latency_ms BETWEEN 0 AND 120000),
  http_status INTEGER
    CHECK (http_status IS NULL OR (typeof(http_status) = 'integer' AND http_status BETWEEN 100 AND 599)),
  failure_code TEXT
    CHECK (failure_code IS NULL OR failure_code IN (
      'timeout', 'dns', 'tls', 'network', 'http_status', 'body_mismatch'
    )),
  CHECK (
    (result = 'up' AND failure_code IS NULL) OR
    (result = 'down' AND failure_code IS NOT NULL)
  ),
  UNIQUE (component, scheduled_at)
);

CREATE INDEX check_samples_component_checked_at_idx
  ON check_samples (component, checked_at);

CREATE TABLE component_state (
  component TEXT PRIMARY KEY CHECK (component IN ('web', 'api')),
  status TEXT NOT NULL CHECK (status IN ('operational', 'outage', 'unknown')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(consecutive_failures) = 'integer' AND consecutive_failures >= 0),
  last_checked_at TEXT,
  last_success_at TEXT,
  last_failure_at TEXT
);

INSERT INTO component_state (component, status) VALUES
  ('api', 'unknown'),
  ('web', 'unknown');

CREATE TABLE daily_uptime (
  day TEXT NOT NULL,
  component TEXT NOT NULL CHECK (component IN ('web', 'api')),
  up_samples INTEGER NOT NULL DEFAULT 0 CHECK (up_samples >= 0),
  down_samples INTEGER NOT NULL DEFAULT 0 CHECK (down_samples >= 0),
  expected_samples INTEGER NOT NULL DEFAULT 0 CHECK (expected_samples BETWEEN 0 AND 288),
  first_scheduled_at TEXT NOT NULL,
  last_scheduled_at TEXT NOT NULL,
  PRIMARY KEY (day, component)
);

CREATE TRIGGER check_samples_after_insert
AFTER INSERT ON check_samples
BEGIN
  UPDATE component_state
  SET
    status = CASE
      WHEN NEW.result = 'up' THEN 'operational'
      WHEN last_checked_at IS NULL THEN 'unknown'
      WHEN unixepoch(NEW.checked_at) - unixepoch(last_checked_at) > 900 THEN 'unknown'
      WHEN consecutive_failures + 1 >= 2 THEN 'outage'
      ELSE status
    END,
    consecutive_failures = CASE
      WHEN NEW.result = 'up' THEN 0
      WHEN last_checked_at IS NULL THEN 1
      WHEN unixepoch(NEW.checked_at) - unixepoch(last_checked_at) > 900 THEN 1
      ELSE consecutive_failures + 1
    END,
    last_checked_at = NEW.checked_at,
    last_success_at = CASE
      WHEN NEW.result = 'up' THEN NEW.checked_at
      ELSE last_success_at
    END,
    last_failure_at = CASE
      WHEN NEW.result = 'down' THEN NEW.checked_at
      ELSE last_failure_at
    END
  WHERE component = NEW.component
    AND (
      last_checked_at IS NULL OR
      unixepoch(NEW.checked_at) >= unixepoch(last_checked_at)
    );

  INSERT INTO daily_uptime (
    day,
    component,
    up_samples,
    down_samples,
    expected_samples,
    first_scheduled_at,
    last_scheduled_at
  ) VALUES (
    substr(NEW.scheduled_at, 1, 10),
    NEW.component,
    CASE WHEN NEW.result = 'up' THEN 1 ELSE 0 END,
    CASE WHEN NEW.result = 'down' THEN 1 ELSE 0 END,
    (
      CAST(strftime('%H', NEW.scheduled_at) AS INTEGER) * 60 +
      CAST(strftime('%M', NEW.scheduled_at) AS INTEGER) - 3
    ) / 5 + 1,
    NEW.scheduled_at,
    NEW.scheduled_at
  )
  ON CONFLICT (day, component) DO UPDATE SET
    up_samples = daily_uptime.up_samples + excluded.up_samples,
    down_samples = daily_uptime.down_samples + excluded.down_samples,
    expected_samples = MAX(daily_uptime.expected_samples, excluded.expected_samples),
    first_scheduled_at = MIN(daily_uptime.first_scheduled_at, excluded.first_scheduled_at),
    last_scheduled_at = MAX(daily_uptime.last_scheduled_at, excluded.last_scheduled_at);
END;
