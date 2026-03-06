create table realtime_events
(
    event_id     varchar(128)                       not null
        primary key,
    map_id       varchar(64)                        not null,
    user_id      varchar(64)                        not null,
    event_type   varchar(32)                        not null,
    payload_json longtext collate utf8mb4_bin       not null,
    occurred_at  datetime                           not null,
    created_at   datetime default CURRENT_TIMESTAMP not null,
    constraint realtime_events_payload_json_chk
        check (json_valid(`payload_json`))
)
    collate = utf8mb4_unicode_ci;

create index realtime_events_map_time_idx
    on realtime_events (map_id, occurred_at);

create table realtime_map_snapshots
(
    map_id        varchar(64)                  not null
        primary key,
    snapshot_json longtext collate utf8mb4_bin not null,
    updated_at    datetime                     not null,
    last_event_id varchar(128)                 not null,
    constraint realtime_map_snapshots_json_chk
        check (json_valid(`snapshot_json`))
)
    collate = utf8mb4_unicode_ci;

create table users
(
    id            bigint unsigned auto_increment
        primary key,
    firebase_uid  varchar(128)                        not null,
    created_at    timestamp default CURRENT_TIMESTAMP not null,
    updated_at    timestamp default CURRENT_TIMESTAMP not null on update CURRENT_TIMESTAMP,
    constraint users_firebase_uid_uq
        unique (firebase_uid)
)
    collate = utf8mb4_unicode_ci;

create table weeks
(
    id         bigint unsigned auto_increment
        primary key,
    starts_on  date                                not null,
    ends_on    date                                not null,
    created_at timestamp default CURRENT_TIMESTAMP not null,
    constraint weeks_starts_on_uq
        unique (starts_on),
    constraint weeks_range_chk
        check (`ends_on` > `starts_on`)
)
    collate = utf8mb4_unicode_ci;

create table matches
(
    id         bigint unsigned auto_increment
        primary key,
    created_by bigint unsigned                                                                null,
    week_id    bigint unsigned                                                                null,
    map_key    varchar(64)                                                                    null,
    mode       varchar(32)                                          default 'skirmish'        not null,
    starts_at  datetime                                                                       not null,
    ends_at    datetime                                                                       null,
    status     enum ('scheduled', 'active', 'finished', 'canceled') default 'scheduled'       not null,
    name       varchar(80)                                                                    null,
    created_at timestamp                                            default CURRENT_TIMESTAMP not null,
    updated_at timestamp                                            default CURRENT_TIMESTAMP not null on update CURRENT_TIMESTAMP,
    constraint matches_map_key_uq
        unique (map_key),
    constraint matches_created_by_fk
        foreign key (created_by) references users (id)
            on update cascade on delete set null,
    constraint matches_week_fk
        foreign key (week_id) references weeks (id)
            on update cascade on delete set null,
    constraint matches_time_chk
        check ((`ends_at` is null) or (`ends_at` >= `starts_at`))
)
    collate = utf8mb4_unicode_ci;

create table map_sessions
(
    id         varchar(64)                                           not null
        primary key,
    week_id    bigint unsigned                                       null,
    match_id   bigint unsigned                                       null,
    status     enum ('active', 'archived') default 'active'          not null,
    name       varchar(100)                                          null,
    starts_at  datetime                    default CURRENT_TIMESTAMP not null,
    ends_at    datetime                                              null,
    created_at timestamp                   default CURRENT_TIMESTAMP not null,
    updated_at timestamp                   default CURRENT_TIMESTAMP not null on update CURRENT_TIMESTAMP,
    constraint map_sessions_match_fk
        foreign key (match_id) references matches (id)
            on update cascade on delete set null,
    constraint map_sessions_week_fk
        foreign key (week_id) references weeks (id)
            on update cascade on delete set null,
    constraint map_sessions_time_chk
        check ((`ends_at` is null) or (`ends_at` >= `starts_at`))
)
    collate = utf8mb4_unicode_ci;

create index map_sessions_scope_idx
    on map_sessions (week_id, match_id);

create index matches_creator_idx
    on matches (created_by);

create index matches_status_starts_idx
    on matches (status, starts_at);

create index matches_week_idx
    on matches (week_id);

create table runs
(
    id            bigint unsigned auto_increment
        primary key,
    user_id       bigint unsigned                       not null,
    map_id        varchar(64)                           null,
    week_id       bigint unsigned                       null,
    match_id      bigint unsigned                       null,
    started_at    datetime                              not null,
    ended_at      datetime                              not null,
    distance_m    double                                not null,
    route_geojson longtext collate utf8mb4_bin          not null,
    source        varchar(32) default 'mobile'          null,
    created_at    timestamp   default CURRENT_TIMESTAMP not null,
    constraint runs_map_fk
        foreign key (map_id) references map_sessions (id)
            on update cascade on delete set null,
    constraint runs_match_fk
        foreign key (match_id) references matches (id)
            on update cascade on delete set null,
    constraint runs_user_fk
        foreign key (user_id) references users (id)
            on update cascade on delete cascade,
    constraint runs_week_fk
        foreign key (week_id) references weeks (id)
            on update cascade on delete set null,
    constraint runs_distance_chk
        check (`distance_m` >= 0),
    constraint runs_route_json_chk
        check (json_valid(`route_geojson`)),
    constraint runs_time_chk
        check (`ended_at` >= `started_at`)
)
    collate = utf8mb4_unicode_ci;

create index runs_map_idx
    on runs (map_id);

create index runs_scope_idx
    on runs (week_id, match_id);

create index runs_user_time_idx
    on runs (user_id, started_at);

create table territories
(
    id         bigint unsigned auto_increment
        primary key,
    owner_id   bigint unsigned                    not null,
    map_id     varchar(64)                        null,
    week_id    bigint unsigned                    null,
    match_id   bigint unsigned                    null,
    polygon    geometry                           not null,
    area_m2    double                             not null,
    claimed_at datetime default CURRENT_TIMESTAMP not null,
    updated_at datetime default CURRENT_TIMESTAMP not null on update CURRENT_TIMESTAMP,
    constraint terr_map_fk
        foreign key (map_id) references map_sessions (id)
            on update cascade on delete set null,
    constraint terr_match_fk
        foreign key (match_id) references matches (id)
            on update cascade on delete set null,
    constraint terr_owner_fk
        foreign key (owner_id) references users (id)
            on update cascade on delete cascade,
    constraint terr_week_fk
        foreign key (week_id) references weeks (id)
            on update cascade on delete set null,
    constraint terr_area_chk
        check (`area_m2` >= 0)
)
    collate = utf8mb4_unicode_ci;

create index terr_map_owner_idx
    on territories (map_id, owner_id);

create index terr_owner_idx
    on territories (owner_id);

create spatial index terr_poly_gix
    on territories (polygon);

create index terr_week_match_owner_idx
    on territories (week_id, match_id, owner_id);
