# Render + Neon

One free Node.js web service serves the built React frontend, API and Socket.IO from the same HTTPS origin. PostgreSQL remains on Neon. No Render database or paid resource is needed.

Live site: https://dungeon-master-tvra.onrender.com
Render service: `srv-dbfb4l8m7kps738e51c0`, workspace `My Workspace`, Frankfurt, Free.
Dashboard: https://dashboard.render.com/web/srv-dbfb4l8m7kps738e51c0

Verified against the public site: valid HTTPS, frontend deep links, Secure-cookie registration, DM + three registered players, invite/join, authenticated WSS, presence, shared scene/token updates, Player movement rejection, pings, automatic reconnect and state restoration. Automated clients ran from one machine through the public endpoint; acceptance with humans on different PCs remains to be performed.

```sh
npm run test:live -w @dnd/server -- https://dungeon-master-tvra.onrender.com
```

This live test creates four temporary accounts/campaign data through public HTTP APIs, then uses the configured PostgreSQL connection to delete only its own records. It must target the deployment backed by that same database. It never prints passwords or session tokens.

## Render configuration

- Repository: `https://github.com/Ter29/dungeon-master`, branch `main`.
- Runtime: Node, region Frankfurt, plan Free, repository root unchanged.
- Build: `npm ci --include=dev && npm run build`.
- Start: `npm run start:render`.
- Health check: `/api/ready` (checks the migrated database).
- Environment: `NODE_ENV=production`, `NODE_VERSION=24.14.0`, `DATABASE_URL` from Neon.
- Omit `APP_ORIGIN` to use Render's `RENDER_EXTERNAL_URL`. For a custom domain, set `APP_ORIGIN` to its exact HTTPS origin, without a path.
- `DIRECT_URL` is configured for migrations on Neon (direct hostname without `-pooler`); application requests continue using pooled `DATABASE_URL`. This avoids session-level advisory-lock failures through PgBouncer.

`render.yaml` describes this configuration for Blueprint deployment. Do not create a second service from the Blueprint if the service already exists. The connected Render creation tool may not expose a health-check field; if created through that tool, set `/api/ready` in Render Settings afterwards.

Render handles public TLS. Node binds `0.0.0.0:$PORT` and trusts one proxy hop only in the Render environment. Session cookies are Secure, HttpOnly, SameSite=Lax. Real `.env` files must never be uploaded to GitHub or placed in the frontend. DATABASE_URL belongs in Render's secret environment settings.

Startup applies existing Prisma migrations before listening. Migration failure stops deployment. Dev dependencies are intentionally installed because the startup migration command uses Prisma CLI. A failed deployment must be diagnosed; never use `prisma migrate reset` on the shared database.

## Checks

```sh
npm run typecheck
npm run build
npm run test:production -w @dnd/server
```

The local production test checks React assets and deep links, API readiness/404, Secure-cookie flags, Render origin fallback, invitation URLs and authenticated WebSocket against Neon. It simulates the TLS proxy locally; public TLS still needs live verification.

After deployment check `/api/health`, `/api/ready`, registration/login, an invitation opened in a different browser and a shared campaign with DM plus at least three players on different PCs. Move the token and switch scenes, disconnect/reconnect a player, then reload all pages. Positions and active scene must remain identical. Test users are responsible for their own accounts; automated checks must clean up only the records they create.

The Free service can sleep after inactivity and take time to wake up. One backend process is supported. An unavailable first request does not justify buying a paid plan automatically.
