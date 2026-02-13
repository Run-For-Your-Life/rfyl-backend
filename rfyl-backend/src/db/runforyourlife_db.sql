-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Nov 07, 2025 at 04:38 PM
-- Server version: 10.6.23-MariaDB-cll-lve
-- PHP Version: 8.3.25
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';
START TRANSACTION;
SET time_zone = '+00:00';

USE runforyourlife_db;


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `runforyourlife_db`
--

-- --------------------------------------------------------

--
-- Table structure for table `claim_attempts`
--

CREATE TABLE `claim_attempts` (
  `id` bigint(20) NOT NULL,
  `run_id` bigint(20) NOT NULL,
  `user_id` bigint(20) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `polygon` geometry NOT NULL,
  `area_m2` double NOT NULL,
  `week_id` bigint(20) DEFAULT NULL,
  `match_id` bigint(20) DEFAULT NULL,
  `status` enum('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  `reject_reason` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `leaderboards`
--

CREATE TABLE `leaderboards` (
  `id` bigint(20) NOT NULL,
  `week_id` bigint(20) DEFAULT NULL,
  `match_id` bigint(20) DEFAULT NULL,
  `user_id` bigint(20) NOT NULL,
  `total_area_m2` double NOT NULL,
  `rank` int(11) NOT NULL,
  `refreshed_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `matches`
--

CREATE TABLE `matches` (
  `id` bigint(20) NOT NULL,
  `created_by` bigint(20) DEFAULT NULL,
  `mode` varchar(32) NOT NULL DEFAULT 'skirmish',
  `starts_at` datetime NOT NULL,
  `ends_at` datetime DEFAULT NULL,
  `status` enum('scheduled','active','finished','canceled') NOT NULL DEFAULT 'scheduled',
  `name` varchar(80) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `matches`
--

INSERT INTO `matches` (`id`, `created_by`, `mode`, `starts_at`, `ends_at`, `status`, `name`) VALUES
(1, 1, 'skirmish', '2025-10-05 11:16:21', NULL, 'active', 'Local Test Match');

-- --------------------------------------------------------

--
-- Table structure for table `runs`
--

CREATE TABLE `runs` (
  `id` bigint(20) NOT NULL,
  `user_id` bigint(20) NOT NULL,
  `started_at` datetime NOT NULL,
  `ended_at` datetime NOT NULL,
  `distance_m` double NOT NULL,
  `route_geojson` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`route_geojson`)),
  `source` varchar(32) DEFAULT 'mobile',
  `week_id` bigint(20) DEFAULT NULL,
  `match_id` bigint(20) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `run_points`
--

CREATE TABLE `run_points` (
  `run_id` bigint(20) NOT NULL,
  `idx` int(11) NOT NULL,
  `t` datetime NOT NULL,
  `position` point NOT NULL,
  `speed_mps` float DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `territories`
--

CREATE TABLE `territories` (
  `id` bigint(20) NOT NULL,
  `owner_id` bigint(20) NOT NULL,
  `polygon` geometry NOT NULL,
  `area_m2` double NOT NULL,
  `claimed_at` datetime NOT NULL DEFAULT current_timestamp(),
  `week_id` bigint(20) NOT NULL,
  `match_id` bigint(20) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `territory_history`
--

CREATE TABLE `territory_history` (
  `id` bigint(20) NOT NULL,
  `territory_id` bigint(20) DEFAULT NULL,
  `event_time` datetime NOT NULL DEFAULT current_timestamp(),
  `event_type` varchar(32) NOT NULL,
  `old_owner_id` bigint(20) DEFAULT NULL,
  `new_owner_id` bigint(20) DEFAULT NULL,
  `geometry` geometry DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` bigint(20) NOT NULL,
  `username` varchar(40) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `users`
--

-- Password hashes here are placeholders; replace with valid bcrypt hashes if you keep seed users.
INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `created_at`) VALUES
(1, 'alice', 'alice@example.com', '$2b$10$exampleexampleexampleexampleexa', '2025-10-05 18:16:21'),
(2, 'bob', 'bob@example.com', '$2b$10$exampleexampleexampleexampleexa', '2025-10-05 18:16:21');

-- --------------------------------------------------------

--
-- Table structure for table `weeks`
--

CREATE TABLE `weeks` (
  `id` bigint(20) NOT NULL,
  `starts_on` date NOT NULL,
  `ends_on` date NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `realtime_events`
--

CREATE TABLE `realtime_events` (
  `event_id` varchar(128) NOT NULL,
  `map_id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `event_type` varchar(32) NOT NULL,
  `payload_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload_json`)),
  `occurred_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `realtime_map_snapshots`
--

CREATE TABLE `realtime_map_snapshots` (
  `map_id` varchar(64) NOT NULL,
  `snapshot_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`snapshot_json`)),
  `updated_at` datetime NOT NULL,
  `last_event_id` varchar(128) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `weeks`
--

INSERT INTO `weeks` (`id`, `starts_on`, `ends_on`) VALUES
(1, '2025-10-05', '2025-10-12');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `claim_attempts`
--
ALTER TABLE `claim_attempts`
  ADD PRIMARY KEY (`id`),
  ADD SPATIAL KEY `claim_poly_gix` (`polygon`),
  ADD KEY `claim_user_idx` (`user_id`),
  ADD KEY `claim_scope_week_idx` (`week_id`),
  ADD KEY `claim_scope_match_idx` (`match_id`);

--
-- Indexes for table `leaderboards`
--
ALTER TABLE `leaderboards`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_scope_user` (`week_id`,`match_id`,`user_id`);

--
-- Indexes for table `matches`
--
ALTER TABLE `matches`
  ADD PRIMARY KEY (`id`),
  ADD KEY `matches_creator_idx` (`created_by`),
  ADD KEY `matches_time_idx` (`starts_at`);

--
-- Indexes for table `runs`
--
ALTER TABLE `runs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `runs_user_time` (`user_id`,`started_at`),
  ADD KEY `runs_week_idx` (`week_id`),
  ADD KEY `runs_match_idx` (`match_id`);

--
-- Indexes for table `run_points`
--
ALTER TABLE `run_points`
  ADD PRIMARY KEY (`run_id`,`idx`),
  ADD SPATIAL KEY `run_points_pos_gix` (`position`);

--
-- Indexes for table `territories`
--
ALTER TABLE `territories`
  ADD PRIMARY KEY (`id`),
  ADD SPATIAL KEY `terr_poly_gix` (`polygon`),
  ADD KEY `terr_owner_idx` (`owner_id`),
  ADD KEY `terr_week_idx` (`week_id`),
  ADD KEY `terr_match_idx` (`match_id`);

--
-- Indexes for table `territory_history`
--
ALTER TABLE `territory_history`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `username` (`username`),
  ADD UNIQUE KEY `email` (`email`);

--
-- Indexes for table `weeks`
--
ALTER TABLE `weeks`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_week` (`starts_on`);

--
-- Indexes for table `realtime_events`
--
ALTER TABLE `realtime_events`
  ADD PRIMARY KEY (`event_id`),
  ADD KEY `realtime_events_map_time_idx` (`map_id`,`occurred_at`);

--
-- Indexes for table `realtime_map_snapshots`
--
ALTER TABLE `realtime_map_snapshots`
  ADD PRIMARY KEY (`map_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `claim_attempts`
--
ALTER TABLE `claim_attempts`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `leaderboards`
--
ALTER TABLE `leaderboards`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `matches`
--
ALTER TABLE `matches`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `runs`
--
ALTER TABLE `runs`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `territories`
--
ALTER TABLE `territories`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `territory_history`
--
ALTER TABLE `territory_history`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `weeks`
--
ALTER TABLE `weeks`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;


