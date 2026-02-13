# RFYL Backend
## Documentation
API info is held within Swagger UI. Invoke `npx tsc` to build the distribution app, then `npm run dev` to host it locally. You can find the page at localhost:{your env port}/api-docs and test the endpoints from there!  

## Local DB 
From `rfyl-backend/`:

- Start local MySQL:
  `npm run db:local:up`
- Stop local MySQL:
  `npm run db:local:down`
- Start backend with local env profile:
  `npm run dev:local`

Local profile reads `../.env.local`
Cloud profile reads `../.env`.

## Test commands
- `npm test`: fast default suite.
- `npm run test:integration:db`: starts local MySQL, runs DB-backed realtime persistence integration test, then stops MySQL.
- `npm run test:all`: runs `npm test` and then `npm run test:integration:db`.

## CloudSQL proxy command
cloud-sql-proxy \
  --credentials-file /absolute/path/to/ceremonial-tea-477623-h6-45d4b7b2d842.json \
  --unix-socket /tmp/cloudsql \
  ceremonial-tea-477623-h6:us-west1:run-for-your-life-2025
  
