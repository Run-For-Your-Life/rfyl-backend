SET NAMES utf8mb4;
SET time_zone = '+00:00';

DROP TABLE IF EXISTS leaderboards;
DROP TABLE IF EXISTS territory_history;
DROP TABLE IF EXISTS territories;
DROP TABLE IF EXISTS claim_attempts;
DROP TABLE IF EXISTS run_points;
DROP TABLE IF EXISTS runs;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS weeks;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(40) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_distance_m DOUBLE NOT NULL DEFAULT 0,
  weekly_flair TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE weeks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  UNIQUE KEY uniq_week (starts_on)
) ENGINE=InnoDB;

CREATE TABLE matches (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  created_by BIGINT NULL,
  mode VARCHAR(32) NOT NULL DEFAULT 'skirmish',
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NULL,
  status ENUM('scheduled','active','finished','canceled') NOT NULL DEFAULT 'scheduled',
  name VARCHAR(80) NULL,
  KEY matches_creator_idx (created_by),
  KEY matches_time_idx (starts_at)
) ENGINE=InnoDB;

CREATE TABLE runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  started_at DATETIME NOT NULL,
  ended_at DATETIME NOT NULL,
  distance_m DOUBLE NOT NULL,
  route_geojson JSON NOT NULL,
  source VARCHAR(32) DEFAULT 'mobile',
  week_id BIGINT NULL,
  match_id BIGINT NULL,
  KEY runs_user_time (user_id, started_at DESC),
  KEY runs_week_idx (week_id),
  KEY runs_match_idx (match_id)
) ENGINE=InnoDB;

CREATE TABLE run_points (
  run_id BIGINT NOT NULL,
  idx INT NOT NULL,
  t DATETIME NOT NULL,
  position POINT NOT NULL,
  speed_mps FLOAT NULL,
  PRIMARY KEY (run_id, idx),
  SPATIAL INDEX run_points_pos_gix (position)
) ENGINE=InnoDB;

CREATE TABLE claim_attempts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  run_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  polygon GEOMETRY NOT NULL,
  area_m2 DOUBLE NOT NULL,
  week_id BIGINT NULL,
  match_id BIGINT NULL,
  status ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  reject_reason TEXT NULL,
  SPATIAL INDEX claim_poly_gix (polygon),
  KEY claim_user_idx (user_id),
  KEY claim_scope_week_idx (week_id),
  KEY claim_scope_match_idx (match_id)
) ENGINE=InnoDB;

CREATE TABLE territories (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  owner_id BIGINT NOT NULL,
  polygon GEOMETRY NOT NULL,
  area_m2 DOUBLE NOT NULL,
  claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  week_id BIGINT NOT NULL,
  match_id BIGINT NULL,
  SPATIAL INDEX terr_poly_gix (polygon),
  KEY terr_owner_idx (owner_id),
  KEY terr_week_idx (week_id),
  KEY terr_match_idx (match_id)
) ENGINE=InnoDB;

CREATE TABLE territory_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  territory_id BIGINT NULL,
  event_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  event_type VARCHAR(32) NOT NULL,
  old_owner_id BIGINT NULL,
  new_owner_id BIGINT NULL,
  geometry GEOMETRY NULL
) ENGINE=InnoDB;

CREATE TABLE leaderboards (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  week_id BIGINT NULL,
  match_id BIGINT NULL,
  user_id BIGINT NOT NULL,
  total_area_m2 DOUBLE NOT NULL,
  rank INT NOT NULL,
  refreshed_at DATETIME NOT NULL,
  UNIQUE KEY uniq_scope_user (week_id, match_id, user_id)
) ENGINE=InnoDB;
