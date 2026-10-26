# Sprint 2.3 — Fog of War

## Implementation

- `packages/shared/src/fog.ts`: fixed 128 × 128 bitmask; empty string = revealed; 4096 hexadecimal characters = bounded 4 KiB serialization. Brush uses line-segment distance; rectangles use map coordinates. No growing stroke log.
- `apps/server/prisma/schema.prisma`: Scene.fogMask and Scene.fogRevision. Existing Scene records remain revealed; POST location defaults to hidden, with explicit `initialFog: hidden | revealed`.
- Two additive migrations add fields and constraints. A first integration run caught PostgreSQL's regex repetition bound; the second migration corrects the constraint using separate length and character checks. Applied migration history was preserved; no campaign records were deleted.
- `apps/server/src/scenes/router.ts`: authenticated fog API, DM-only changes, campaign row lock, optimistic fog revision, map bounds and payload validation; token list/detail/image routes enforce fog visibility. Replacing an existing background hides the replacement and increments fog revision; first upload preserves the selected initial state.
- `apps/server/src/scenes/state.ts`: role-specific snapshots include fog; the shared token visibility predicate checks both the independent hidden flag and the entire token bounding footprint. Border-overlapping tokens remain unavailable until all touched cells are revealed.
- `apps/client/src/features/scenes/FogLayer.tsx`: SVG overlay, brush/rectangle gestures, map-coordinate conversion through inverse screen CTM, bounded point collection, translucent DM overlay and opaque Player overlay.
- `InteractiveMap.tsx`, `LocationTable.tsx`, `LocationManager.tsx`: tools, radius, Reveal/Hide All, Player Preview, error/reconnect recovery, initial fog choice. Camera and zoom remain local; existing pings are unchanged.
- `apps/server/scripts/check-fog.ts`: integration checks with a DM, three Players and outsider, real PostgreSQL and authenticated Cloudinary uploads. Existing token regression explicitly creates a revealed scene.

## API and synchronization

Base: `/api/campaigns/:campaignId/locations/:sceneId`.

- GET `/fog`: `{fog:{revision,bits}}`; Player only for active location.
- PATCH `/fog`: DM only, `{revision,operations}`. Operations: `{kind:'all',mode}`, `{kind:'rectangle',mode,from,to}` or `{kind:'brush',mode,radius,points}`; mode is reveal/hide.
- Max 32 operations, 256 points total, 128 per brush; coordinates restricted to image bounds; radius 1–10000 map pixels. Existing table rate limit and 100 KiB JSON limit apply.
- One request/transaction per completed gesture, never per pointer movement. API also supports batches. Acknowledged changes are persisted before notification. An unfinished or failed gesture is not persisted; stale writes return 409 and client refreshes allowed state.
- Existing Socket.IO `location:snapshot` carries current mask plus permitted tokens. No raw DM token updates are broadcast to Player. Existing `locations:changed` invalidation remains DM-only. Reconnect and room:sync rebuild allowed snapshots from PostgreSQL.
- Token image proxy checks permissions before and after storage download; forbidden token/detail/image requests return 404. Private Cloudinary assets and no-store responses remain in use.

## Boundaries

Fog is the agreed visual black layer over the full PNG. The active background image is available to the browser; this does not provide server-side secrecy of unrevealed terrain. Token metadata and image access are filtered server-side. Data a player already saw cannot be erased from their memory/browser capture after hiding it again.

128 × 128 mask resolution is independent of the square grid and camera. Very large maps have visibly stepped edges; very small strokes can miss cell centers. Long gestures are resampled to keep payload bounded. Preview is local to the DM; it does not change role or grants. Other DM management panels retain DM rights.

## Verification

Local checks passed: TypeScript, production build; auth, campaigns/invites, room DM + six Players, Scene Foundation, Token System, Fog DM + three Players. Fog checks cover brush/rectangle/all reveal/hide, scene switching, optimistic conflicts, bounds/payload limits, hidden flag preservation, API/socket/image filtering, pings, automatic reconnect and actual local process restart with persisted mask.

Browser checks: actual rectangle draw saved revision 1 with Hero open / Enemy closed; Hide Brush after zoom from 148% to 186% and camera pan saved revision 2 with Hero closed. Player Preview rendered only Hero before the hide, with opaque fog. No production campaign used for these checks; isolated temporary fixtures are cleaned after testing.

Before migration, a repeatable-read backup was restored into an isolated schema, pending migrations applied, and all original fields/rows compared exactly. Explicit `db:restore-foundation -- <backup> --verify-only` also passed. Backups and checksum files are ignored in `.backups/`; they contain secrets/session data and must stay private. Restoring into an isolated schema is rehearsed; production public schema was never replaced.

## Deployment

Target remains https://dungeon-master-tvra.onrender.com, existing Render service `srv-dbfb4l8m7kps738e51c0` in the previously confirmed workspace. No new services, domains, storage providers or secrets required. Deployment and live HTTPS/WSS verification pending at document creation; final results appended below.
