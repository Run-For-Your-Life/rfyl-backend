
USE runforyourlife_db;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS claim_attempts;
DROP TABLE IF EXISTS leaderboards;
DROP TABLE IF EXISTS lobby_users;
DROP TABLE IF EXISTS lobbies;
DROP TABLE IF EXISTS maps;
DROP TABLE IF EXISTS run_points;
DROP TABLE IF EXISTS territory_history;
DROP TABLE IF EXISTS realtime_events;
DROP TABLE IF EXISTS realtime_map_snapshots;
DROP TABLE IF EXISTS runs;
DROP TABLE IF EXISTS territories;
DROP TABLE IF EXISTS map_sessions;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS weeks;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(40) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_username_uq (username),
  UNIQUE KEY users_email_uq (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE weeks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY weeks_starts_on_uq (starts_on),
  CONSTRAINT weeks_range_chk CHECK (ends_on > starts_on)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE matches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_by BIGINT UNSIGNED NULL,
  week_id BIGINT UNSIGNED NULL,
  map_key VARCHAR(64) NULL,
  mode VARCHAR(32) NOT NULL DEFAULT 'skirmish',
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NULL,
  status ENUM('scheduled', 'active', 'finished', 'canceled') NOT NULL DEFAULT 'scheduled',
  name VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY matches_map_key_uq (map_key),
  KEY matches_creator_idx (created_by),
  KEY matches_week_idx (week_id),
  KEY matches_status_starts_idx (status, starts_at),
  CONSTRAINT matches_created_by_fk
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT matches_week_fk
    FOREIGN KEY (week_id) REFERENCES weeks (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT matches_time_chk CHECK (ends_at IS NULL OR ends_at >= starts_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE map_sessions (
  id VARCHAR(64) NOT NULL,
  week_id BIGINT UNSIGNED NULL,
  match_id BIGINT UNSIGNED NULL,
  status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
  name VARCHAR(100) NULL,
  starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY map_sessions_scope_idx (week_id, match_id),
  CONSTRAINT map_sessions_week_fk
    FOREIGN KEY (week_id) REFERENCES weeks (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT map_sessions_match_fk
    FOREIGN KEY (match_id) REFERENCES matches (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT map_sessions_time_chk CHECK (ends_at IS NULL OR ends_at >= starts_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  map_id VARCHAR(64) NULL,
  week_id BIGINT UNSIGNED NULL,
  match_id BIGINT UNSIGNED NULL,
  started_at DATETIME NOT NULL,
  ended_at DATETIME NOT NULL,
  distance_m DOUBLE NOT NULL,
  route_geojson LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  source VARCHAR(32) NULL DEFAULT 'mobile',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY runs_user_time_idx (user_id, started_at),
  KEY runs_scope_idx (week_id, match_id),
  KEY runs_map_idx (map_id),
  CONSTRAINT runs_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT runs_week_fk
    FOREIGN KEY (week_id) REFERENCES weeks (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT runs_match_fk
    FOREIGN KEY (match_id) REFERENCES matches (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT runs_map_fk
    FOREIGN KEY (map_id) REFERENCES map_sessions (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT runs_distance_chk CHECK (distance_m >= 0),
  CONSTRAINT runs_time_chk CHECK (ended_at >= started_at),
  CONSTRAINT runs_route_json_chk CHECK (json_valid(route_geojson))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE territories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id BIGINT UNSIGNED NOT NULL,
  map_id VARCHAR(64) NULL,
  week_id BIGINT UNSIGNED NULL,
  match_id BIGINT UNSIGNED NULL,
  polygon GEOMETRY NOT NULL,
  area_m2 DOUBLE NOT NULL,
  claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY terr_owner_idx (owner_id),
  KEY terr_map_owner_idx (map_id, owner_id),
  KEY terr_week_match_owner_idx (week_id, match_id, owner_id),
  SPATIAL INDEX terr_poly_gix (polygon),
  CONSTRAINT terr_owner_fk
    FOREIGN KEY (owner_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT terr_week_fk
    FOREIGN KEY (week_id) REFERENCES weeks (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT terr_match_fk
    FOREIGN KEY (match_id) REFERENCES matches (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT terr_map_fk
    FOREIGN KEY (map_id) REFERENCES map_sessions (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT terr_area_chk CHECK (area_m2 >= 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE realtime_events (
  event_id VARCHAR(128) NOT NULL,
  map_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  payload_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  occurred_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  KEY realtime_events_map_time_idx (map_id, occurred_at),
  CONSTRAINT realtime_events_payload_json_chk CHECK (json_valid(payload_json))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE realtime_map_snapshots (
  map_id VARCHAR(64) NOT NULL,
  snapshot_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  updated_at DATETIME NOT NULL,
  last_event_id VARCHAR(128) NOT NULL,
  PRIMARY KEY (map_id),
  CONSTRAINT realtime_map_snapshots_json_chk CHECK (json_valid(snapshot_json))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
