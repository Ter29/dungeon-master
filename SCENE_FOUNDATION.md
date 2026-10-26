# Sprint 2.1 — Scene Foundation

## Scope and architecture

Express/Prisma now exposes a separate location API. React has a DM manager and a shared location view. Socket.IO uses two new server events while preserving all Sprint 1 events and the legacy test table (collapsed separately). Tokens, Fog of War, camera controls and shared cartography have not been added to locations.

Models:

- `Scene`: campaign, name, public description, optional background, revision and timestamps.
- `MediaFile`: campaign, private storage key, PNG/JPG format/MIME, size, dimensions, creation/deletion timestamps.
- `Campaign.activeLocationId` (nullable) and `locationVersion` (separate from legacy roomState/version).

The additive migration is `20261026030000_scene_foundation`. Existing campaign IDs, roomState, sessions, users, roles and invitations are retained. No legacy table or column is removed.

## Storage choice and limits (checked 2026-10-26)

Cloudinary Image & Video API Free: $0, no credit card required, 25 shared credits. One credit covers 1 GB storage, 1 GB image bandwidth or 1,000 transformations; these consume a shared pool, not independent allowances. Provider free limits include 10 MB/image and 25 MP. Our app accepts at most 8 MiB and 20 MP. Private-download API delivery can count twice the bandwidth; monitor the Cloudinary console. No automatic paid upgrade was configured.

Sources: https://cloudinary.com/documentation/billing_and_plans ; https://cloudinary.com/pricing/compare-plans ; https://cloudinary.com/documentation/control_access_to_media

`CLOUDINARY_URL` is server-only. Assets upload with type `authenticated`; original and derived unsigned URLs are protected. The browser receives only `/api/campaigns/.../locations/.../background/:mediaId`. The backend checks session, membership and active-scene visibility before fetching bytes and rechecks visibility before returning them. Responses are private/no-store; signed provider URLs/storage keys never appear in API/socket payloads. A previously seen image cannot be revoked from the player's memory or screenshots.

Cloudinary is configured in the existing Render service, not in the frontend. The actual service is configured through MCP/Dashboard; `render.yaml` remains a template and is not used to create a duplicate service.

Neon application traffic continues through pooled DATABASE_URL. Prisma migrations now use the separately verified, server-only DIRECT_URL. During the first environment update, the previous startup configuration hit a pooled advisory-lock timeout; the stale Prisma lock was released only on the pool backend reserved by our own transaction, without terminating other sessions. DIRECT_URL resolved the deployment failure.

## API and socket contracts

Full API: [apps/server/scenes-api.md](apps/server/scenes-api.md).

- List/get/create/update/delete locations: DM only.
- Active location endpoint: campaign members, returns active scene or null.
- Activation: DM only, expected locationVersion; null clears the table.
- Background upload: DM only, multipart, expected scene revision.
- Background read: DM or member viewing the currently active scene; inactive URLs return 404 for Players.
- `location:snapshot`: `{version,scene}` on join/reconnect/sync and changes. Contains only the active scene.
- `locations:changed`: DM-only invalidation; manager reloads its authorized list.

All scene mutations with potential conflicts lock the campaign and check revision/version. Metadata/background changes to the active scene increment locationVersion. Prepared metadata is never broadcast to Players. The existing one-server limit remains.

## Upload safety and lifecycle

Permission checks precede buffering. Uploads are rate-limited and serialized on the server; multipart field/file/part sizes are bounded. Sharp decodes and re-encodes a single PNG/JPEG, rejects invalid/truncated/animated/oversized input and strips original metadata. Stored size is checked again.

Media metadata is created as a pending tombstone before remote upload. Only after successful upload does a database transaction attach it, increment the scene revision, and retire the previous background. A storage failure leaves the old background intact. Deletion removes the scene, clears an active reference and marks its asset for removal. Failed remote cleanup remains retryable:

```sh
npm run media:cleanup -w @dnd/server
```

Cleanup processes at most 20 unreferenced tombstones older than one hour to avoid racing in-progress uploads. Immediate cleanup of replaced/deleted backgrounds is attempted after commit. Regular scheduling is not configured.

## Backup and rollback

Before production migration, `db:rehearse-scenes` saved a repeatable-read logical snapshot of every pre-2.1 application table plus Prisma migration history into ignored `.backups/*.json`, with SHA-256. It restored all rows in a new isolated schema, replayed the additive migration and verified exact preservation of old columns. The rehearsal schema was removed afterward. This is a pre-2.1 snapshot, not a replacement for ongoing full database backups.

To recover that snapshot into a new schema without modifying live public tables:

```sh
npm run db:restore-foundation -w @dnd/server -- ../../.backups/CHOSEN-BACKUP.json
```

The command verifies the checksum and restores only into a generated `scene_recovery_*` schema. Recovery into production must be reviewed and selective to avoid overwriting newer activity. Backups contain password/session hashes and must remain private. Do not commit them.

Application rollback remains compatible: the old build ignores new tables/columns. Keep the additive schema during rollback; never run migrate reset or a destructive down migration on live data. Cloudinary assets are outside the PostgreSQL snapshot.

## Validation commands

```sh
npm run typecheck
npm run build
npm run test:storage -w @dnd/server
npm run test:scenes -w @dnd/server
npm run test:scenes -w @dnd/server -- https://dungeon-master-tvra.onrender.com
npm run test:auth -w @dnd/server
npm run test:campaigns -w @dnd/server
npm run test:rooms -w @dnd/server
npm run test:production -w @dnd/server
```

Postman outage simulation and its evidence are documented in `postman/simulations/scene-storage-outage.context.md`. Test scripts use temporary accounts/records/images and clean up their own data. Local scene tests restart the backend and prove state and image survival; the public mode checks HTTP/WSS against the unchanged site URL.

## Verified results and deployment

All checks below passed on 2026-10-26:

| Check | Result / scope |
|---|---|
| TypeScript / production build | Passed |
| Backup / migration rehearsal | Pre-2.1 data restored exactly in isolated schema, additive migration preserved existing columns |
| Independent backup restore command | SHA-256 verified; records restored exactly; verification schema removed |
| Real Cloudinary | Authenticated PNG upload/download, equal bytes, unsigned access denied, cleanup passed |
| Scene API local | CRUD, permissions, PNG/JPG, corrupt/spoofed/oversized/over-resolution rejection, replacement, conflicts, private drafts, blank/active scene |
| Synchronization | Active metadata/background and activation broadcast; campaign isolation, reconnect/reload and local server restart with real Neon/Cloudinary |
| Postman outage | Actual SDK/app through HTTP 503 simulation preserved the old background and state |
| Sprint 1 regressions | Auth, campaigns/invites, DM + six players, legacy room state, production serving passed |
| Public HTTPS/WSS | Same Scene API and role tests passed against the deployed site |
| Browser | Temporary DM logged in, created a location, uploaded a PNG through the file chooser, activated it, refreshed; actual image loaded at 640×400 |
| Cleanup | Temporary accounts, campaigns and provider images removed; private backup and proof screenshot retained locally |

Production service `srv-dbfb4l8m7kps738e51c0` in the existing `My Workspace`, Free, Frankfurt. Runtime commit `4a31c5ecf05e884a3cc57fe5890d9deff96645e2`. Deployment `dep-dbfc5b67bikc73cv8r1g` reached **live**. URL unchanged: https://dungeon-master-tvra.onrender.com . Final `/`, `/api/health`, `/api/ready` all returned HTTP 200; no error-level logs were found after this deployment became live.

HTTP readiness endpoint is available; this MCP-created service still uses Render's default TCP platform probe (the creation tool did not expose healthCheckPath). `render.yaml` documents `/api/ready` for Blueprint configuration. No duplicate service or paid plan was created.

Remaining scope limits: no new tokens, Fog of War, pan/zoom or shared cartography; the location background is visible in full when activated. Multiple humans on different PCs remain a separate acceptance exercise. Cleanup retries are manual, not scheduled.

## Changed files

- Data: `apps/server/prisma/schema.prisma`, `apps/server/prisma/migrations/20261026030000_scene_foundation/migration.sql`.
- Server: `apps/server/src/scenes/router.ts`, `state.ts`, `storage.ts`; `apps/server/src/index.ts`, `apps/server/src/sockets/rooms.ts`.
- Client: `apps/client/src/features/scenes/LocationManager.tsx`, `LocationTable.tsx`; `apps/client/src/features/campaigns/CampaignPage.tsx`, `apps/client/src/lib/api.ts`.
- Contracts: `packages/shared/src/events/locations.ts`, `room.ts`, `packages/shared/src/index.ts`, `apps/server/scenes-api.md`.
- Verification/recovery: `apps/server/scripts/check-scenes.ts`, `check-storage.ts`, `check-storage-outage.ts`, `cleanup-media.ts`, `rehearse-scenes-migration.ts`, `restore-foundation-backup.ts`.
- Dependency simulation: `postman/mocks/cloudinary/config.yaml`, `default.js`; `postman/simulations/scene-storage-outage.sim.yaml`, `scene-storage-outage.context.md`.
- Configuration/docs: `.gitignore`, `apps/server/.env.example`, `apps/server/package.json`, `package-lock.json`, `README.md`, `DEPLOYMENT.md`, `SCENE_FOUNDATION.md`. Real `.env` and backups are not committed.
