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
