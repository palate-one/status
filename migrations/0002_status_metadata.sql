CREATE TABLE status_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  monitoring_started_at TEXT
    CHECK (
      monitoring_started_at IS NULL OR (
        typeof(monitoring_started_at) = 'text' AND
        length(monitoring_started_at) = 20 AND
        monitoring_started_at GLOB '????-??-??T??:??:00Z' AND
        unixepoch(monitoring_started_at) IS NOT NULL
      )
    )
);

INSERT INTO status_metadata (id, monitoring_started_at)
SELECT 1, MIN(first_scheduled_at)
FROM daily_uptime;

CREATE TRIGGER check_samples_monitoring_metadata_after_insert
AFTER INSERT ON check_samples
BEGIN
  UPDATE status_metadata
  SET monitoring_started_at = CASE
    WHEN monitoring_started_at IS NULL THEN NEW.scheduled_at
    WHEN NEW.scheduled_at < monitoring_started_at THEN NEW.scheduled_at
    ELSE monitoring_started_at
  END
  WHERE id = 1;
END;
