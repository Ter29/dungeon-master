# Sprint 2.2 — Interactive Table & Tokens

## Behavior

- Each browser keeps its own camera, zoom and pan. Camera data never goes to the server. Wheel zoom anchors at the pointer; +/- buttons, camera arrows and Reset View are available. Reset fits the map; changing location resets the local camera.
- Coordinates and token diameter use original-map pixels (fallback blank scene: 1000×700). SVG screen-to-view transforms account for browser sizing/letterboxing, followed by inverse camera transform. A drag saves only its final position; offline moves are blocked.
- DM controls a persisted square grid (visible, size 8–1000 px, offset ±10000 px). Other users receive the grid but cannot edit it.
- DM creates Player/NPC/Enemy tokens, edits name/size/position, drags them, uploads private PNG/JPG images, deletes, hides or Reveals. New tokens default to hidden in the UI. Size: 4–2000 map pixels; center stays within map dimensions. Grid snapping and movement/combat rules are not introduced.
- Player clicks the map to ping for 3 seconds. Pings do not alter tokens, persist or move anyone's camera.

## Data / migration

Additive migration `20261026040000_table_tokens` creates TokenKind and Token, adds Scene grid fields/tableRevision, and relates Token.imageId to the existing MediaFile. Existing locations, media, campaigns and legacy roomState are retained.

Token has sceneId, name, kind, x/y, size, hidden, revision, optional image and timestamps. Each update/delete/upload requires the current token revision; grid updates require tableRevision. Scene metadata retains its separate revision, so moving a token does not invalidate the location-name editor.

Before migration, the backup tool was extended to cover Scene/MediaFile (and Token if present) and deferred activeLocationId restoration to handle the campaign/scene cycle. A repeatable-read backup with SHA-256 was restored in an isolated schema, then migrated and compared against all existing fields. Restore verification uses `db:restore-foundation -- <backup> --verify-only`. Private snapshots stay in ignored `.backups`.

## API

Base: `/api/campaigns/:campaignId/locations/:sceneId`.

| Route | Permission / input |
|---|---|
| PATCH /grid | DM; visible, size, offsetX, offsetY, revision=tableRevision |
| GET /tokens | DM: all; Player: visible tokens of active scene only |
| GET /tokens/:id | Same visibility rules; hidden/nonactive returns 404 for Player |
| POST /tokens | DM; name, kind (PLAYER/NPC/ENEMY), x, y, size, hidden |
| PATCH /tokens/:id | DM; current revision plus editable fields; drag sends x/y |
| DELETE /tokens/:id | DM; current revision |
| POST /tokens/:id/image | DM; multipart file + current revision |
| GET /tokens/:id/image/:mediaId | DM or Player viewing a visible token on the active scene |

Wrong role: 403; anonymous: 401; inaccessible/cross-campaign/hidden: 404; invalid fields/bounds: 400; stale revision: 409. Existing session, Origin, upload limits/validation and Cloudinary authenticated delivery apply. Replaced/deleted images are tombstoned for retryable cleanup; deleting a scene now retires its token images as well.

## Socket security

`location:snapshot` now includes map dimensions, grid, tableRevision and permitted tokens. The server constructs separate DM and Player snapshots, and the SQL query for the Player snapshot excludes hidden tokens, including names/IDs/image metadata. `/locations/active` is likewise role-filtered. No broad broadcast may reuse a DM snapshot.

`location:ping` client payload: {sceneId,x,y} + acknowledgement. The server verifies session, membership, active scene and bounds. Broadcast adds server-generated id and authenticated user's name/id. Other writes are authenticated HTTP mutations committed to PostgreSQL, followed by role-filtered Socket.IO snapshots. The server is authoritative. Reconnect/sync receives fresh permitted state; the client discards older location versions.

## Verification

```sh
npm run typecheck
npm run build
npm run test:tokens -w @dnd/server
npm run test:tokens -w @dnd/server -- https://dungeon-master-tvra.onrender.com
```

The test uses DM + three simultaneous Players and an outsider with real Neon/Cloudinary. It covers CRUD/kinds/size/image, bounds, stale writes, grid, hidden payloads through APIs/WebSockets/image URLs, Reveal/Hide, pings without movement, reconnect and local backend restart. Test records/images are removed. Existing auth/campaign/room/scene tests remain separate regression checks.

No Fog of War, initiative, combat rules or shared cartography were implemented. The server remains a single Render instance; external storage pricing/configuration are unchanged from Sprint 2.1. Previously viewed token images cannot be erased from a user's memory/screenshots after hiding, but future image requests are denied.

## Verified results (2026-10-26)

- TypeScript and production build passed. Existing auth, campaigns/invites, legacy rooms, production serving and Scene Foundation API tests passed with real PostgreSQL; their temporary records were removed.
- Token tests passed locally and against public HTTPS/WSS for DM + three Players. Hidden IDs/names/image metadata were absent from captured Player socket payloads, lists and detail endpoints; direct hidden-image URLs returned 404. Reveal/Hide, image upload, CRUD, grid, stale revisions, bounds, pings, reconnect and campaign isolation passed.
- Local backend restart preserved token coordinates and grid with real Neon/Cloudinary. Temporary browser-fixture tokens/images/positions also survived repeated Render deployments before cleanup.
- Browser: wheel zoom, zoom buttons, Reset View, two-tab camera isolation, token creation, Reveal and image upload passed. A mouse drag at 186% zoom updated Hero from (180,150) to approximately (221.193,168.491), consistent with the screen-to-map scale, and another tab received the same coordinates without moving its camera.
- Final Pan check: a 40×20 CSS-pixel drag at viewport scale 0.72 changed camera translation from (25,28.125) to (80.555557,55.902786), matching the expected (80.555556,55.902778). The other tab remained unchanged. One map/control set remained after socket updates.
- Browser tests found and fixed duplicate sibling React keys and mutable-ref pan deltas before completion. The fixes were rebuilt and deployed; final checks passed.
- The complete pre-2.2 snapshot (including existing scenes/media and active references) was restored and checked before applying the additive migration. An independent checksum/restore verification passed. Backups stay private in ignored `.backups`.
- All test accounts, campaigns, tokens and Cloudinary images were removed. A synthetic-map browser screenshot is retained locally in `.backups/interactive-table-ui.png`.

Deployment **live**: runtime commit `a88d969fc36ee63553eadadbb8ed07721ee70440`, deployment `dep-dbfk8ltg1s2s7384vj9g`, existing Free Frankfurt service `srv-dbfb4l8m7kps738e51c0`. URL unchanged: https://dungeon-master-tvra.onrender.com . Final `/`, `/api/health`, `/api/ready` returned 200; no error-level runtime logs were found after the final deployment became live. No new service or paid resource was created.

Changed implementation files: `apps/client/src/features/scenes/InteractiveMap.tsx`, `TokenManager.tsx`, `LocationTable.tsx`; `apps/server/prisma/schema.prisma` and migration `20261026040000_table_tokens/migration.sql`; `apps/server/src/scenes/router.ts`, `state.ts`, `apps/server/src/sockets/rooms.ts`; `packages/shared/src/events/locations.ts`, `room.ts`, `packages/shared/src/index.ts`. Verification/recovery changes: `apps/server/scripts/check-tokens.ts`, `rehearse-scenes-migration.ts`, `restore-foundation-backup.ts`, `apps/server/package.json`; documentation: README and this report.

Automated public clients ran from one machine. A human session across different PCs is still an acceptance exercise; no claim is made that real users completed it.
