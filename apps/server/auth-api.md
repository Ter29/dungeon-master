# Authentication API

All responses use JSON and Cache-Control: no-store. Passwords are 12–128 characters. Email is trimmed and lowercased; displayName is trimmed (1–80 characters).

| Endpoint | Input | Success | Errors |
|---|---|---|---|
| POST /api/auth/register | email, displayName, password | 201 {user} + session cookie | 400 invalid input, 409 email exists |
| POST /api/auth/login | email, password | 200 {user} + new session cookie | 400 invalid input, 401 invalid credentials |
| GET /api/auth/me | session cookie | 200 {user} | 401 missing/invalid/expired session |
| POST /api/auth/logout | session cookie | 204, session revoked and cookie cleared | |

User contains only id, email, displayName. Session lasts 7 days and is stored as SHA-256 hash in PostgreSQL; its random bearer token is in an HttpOnly, SameSite=Lax cookie (Secure in production). Login/register rotate the current browser session. Mutations require application/json and reject foreign Origin headers. Production requires APP_ORIGIN to match the frontend's origin and same-origin /api routing. Rate limit is per IP and per server process: 30 attempts per 15 minutes. Email verification and password recovery are not implemented yet.
