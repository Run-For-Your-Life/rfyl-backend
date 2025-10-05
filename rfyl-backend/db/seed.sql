INSERT INTO users (username, email)
VALUES ('alice','alice@example.com'), ('bob','bob@example.com');

INSERT INTO weeks (starts_on, ends_on)
VALUES (CURDATE(), DATE_ADD(CURDATE(), INTERVAL 7 DAY));

INSERT INTO matches (created_by, mode, starts_at, status, name)
VALUES (1, 'skirmish', NOW(), 'active', 'Local Test Match');
