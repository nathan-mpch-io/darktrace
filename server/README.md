# DarkTrace Backend

Local backend scaffold for user auth, device registration, paging, acknowledgement, and escalation.

## Run

```bash
npm run backend
```

Server starts on `http://localhost:4000` by default.

## Deploy on Render

This repo now includes [render.yaml](/Users/nathantucker/Desktop/Pager%20Duty%20App/render.yaml:1) so you can deploy the backend as a simple Node web service.

### Quick steps

1. Push this project to GitHub.
2. In Render, create a new `Blueprint` deployment from that repo.
3. Render will detect `render.yaml` automatically.
4. Wait for the service to build and start.
5. Use the Render HTTPS URL as `backend_url` in the app.

### Notes

- Render provides the `PORT` environment variable automatically.
- The backend already listens on `process.env.PORT`, so no code change is needed.
- `server/data/db.json` is file-based and not durable on most cloud platforms. It is acceptable for short-lived testing, but accounts and pages can reset after redeploy/restart.
- For production, move storage to a real database.

## Storage

Data is persisted in:

- `server/data/db.json`

This is file-based storage for local development. It is not production-grade.

## Seed users

- `admin` / `pass123`
- `nick` / `TempPass1!`
- `milo` / `TempPass1!`
- `jacob` / `TempPass1!`

## API

### Health

- `GET /api/health`

### Auth

- `POST /api/login`
  - body: `{ "username": "admin", "password": "pass123" }`
- `GET /api/me`
  - header: `Authorization: Bearer <token>`

### Users

- `GET /api/users`
- `POST /api/users`
  - body: `{ "displayName": "Jordan Bell", "username": "jordan", "password": "TempPass1!", "role": "user" }`
- `POST /api/users/:id`
  - body: `{ "role": "admin" }`

### Devices

- `POST /api/devices/register`
  - body: `{ "pushToken": "ExponentPushToken[...] or native token", "platform": "android", "deviceName": "Pixel 8" }`

### Pages

- `GET /api/pages`
- `POST /api/pages/send`
  - body: `{ "targetUserId": "usr_nick", "message": "VPN is down. Join bridge now." }`
- `POST /api/pages/:id/acknowledge`
- `POST /api/pages/:id/escalate`
  - body: `{ "targetUserId": "usr_milo" }`

### Audit logs

- `GET /api/audit-logs`

## What this backend already does

- secure password hashing with Node `scrypt`
- bearer-token sessions
- persistent user records
- persistent device token storage
- page records with delivery-attempt placeholders
- acknowledgement and escalation state
- audit log trail

## What still needs wiring for real delivery

- APNs provider for iPhone
- FCM provider for Android
- background worker for repeated retries and timed escalation
- SMS/voice fallback provider
