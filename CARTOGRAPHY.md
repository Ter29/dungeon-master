# Sprint 2.4 contract — Cartography & World Knowledge

Campaign maps are independent from Scene. DM creates/edits/deletes maps and fragment library entries. New maps/fragments are private. Players may read issued maps and fragments and collaboratively edit any unlocked element of an issued map. DM may lock/unlock elements. Revocation removes materials from Player lists, details, placements and image access; known IDs do not bypass authorization.

Base `/api/campaigns/:campaignId/cartography`:

- GET `/`: allowed map summaries + allowed fragment library + storage availability.
- POST `/maps`, GET/PATCH/DELETE `/maps/:mapId`: DM metadata writes with `revision`; detail returns allowed elements. Creation: name, description?, width?, height?, available? (false default). Dimensions fixed after creation.
- POST `/maps/:mapId/background`, GET `/maps/:mapId/background/:mediaId`: DM multipart upload (`file`, `revision`); protected image proxy. Canvas dimensions remain stable; background fits canvas. DELETE `/maps/:mapId/background` removes the background without deleting annotations.
- POST `/maps/:mapId/elements`, PATCH/DELETE `/maps/:mapId/elements/:elementId`: member writes, scoped to permitted map; mutations only affect that element. PATCH/DELETE require element `revision`. Kinds NOTE, MARKER, LINE, ROUTE, CONTOUR, FRAGMENT. Element has text, color, x/y anchor, relative points, scale/rotation for fragment, optional fragmentId, DM-only locked flag. Kind/fragmentId are immutable after creation.
- POST `/fragments`, PATCH/DELETE `/fragments/:fragmentId`: DM library CRUD, `issued` explicit with revision, image required to issue. POST `/fragments/:fragmentId/image` multipart upload, GET `/fragments/:fragmentId/image/:mediaId`: authorized proxy. An issued image must be revoked before replacement.

Limits: 50 maps/campaign, 100 fragments/campaign, 500 elements/map, 128 points/element, 1000 text characters, 120 name characters, canvas 100–10000 units/axis; authenticated 8 MiB PNG/JPG and 20 MP image validation through existing Cloudinary service. No original storage keys or provider URLs in DTOs.

Map metadata revision and element revision are independent. Map dataVersion orders detail snapshots, incremented after any map/element change. Campaign row locks serialize quota checks and writes; stale element updates return 409, locked Player writes 403, inaccessible resources 404. No endpoint accepts replacement of an entire map's elements.

Socket.IO `cartography:changed` carries no IDs or content: after re-authorizing each recipient, members refetch their allowed catalog/selected map over HTTP. Client serializes/coalesces reloads and fetches again after reconnect. Private material data never travels via this event. Writes persist before invalidation. Existing active Scene and location events are untouched.

Implementation, validation and deployment results will be recorded after completion.
## Models and files

New Prisma models: SharedMap, MapElement, MapFragment; enum MapElementKind. They reference Campaign and existing MediaFile. There is no Scene relationship; cartography never writes Campaign.activeLocationId/locationVersion/roomState. Migration `20261026060000_cartography` only creates tables/enum/indexes/constraints and foreign keys.

Implementation files:

- `apps/server/src/cartography/router.ts`: catalog, map/element/fragment CRUD, protected uploads/proxies, quotas, revisions, role/availability/lock checks.
- `apps/server/src/cartography/state.ts`: safe DTOs and invalidation emitter.
- `apps/server/src/index.ts`, `apps/server/src/sockets/rooms.ts`: independent router and authenticated content-free event.
- `packages/shared/src/events/cartography.ts`, shared exports and room event interface: typed contract.
- `apps/client/src/features/cartography/Cartography.tsx`: permitted catalog, coalesced reloads/reconnect and selection.
- `CartographyCanvas.tsx`: original canvas coordinates, independent local camera, zoom/pan/reset, click/draw/drag gestures, six element kinds, transformed fragments.
- `ElementEditor.tsx`: individual fields, editable vertices, stale revision detection, DM locks and deletion.
- `CartographyAdmin.tsx`: map metadata/backgrounds, explicit publication, private fragment upload/issue/revoke/delete.
- `apps/client/src/features/campaigns/CampaignPage.tsx`: separate Maps tab; battle table remains mounted to retain its camera and socket.
- `apps/server/scripts/check-cartography.ts`: real DB/provider integration and concurrent clients, optionally public URL.
- Backup/recovery scripts: include all three new tables in dependency order and explicitly serialize JSON vertex arrays when restoring. Unknown backup tables fail instead of being silently skipped.
- Storage outage script and existing Postman simulation context: verify new upload paths safely retain old state on storage failure.

## Local verification (2026-10-26)

- `npm run typecheck`: PASS all workspaces.
- `npm run build`: PASS shared/client/server, Prisma generation and Vite production bundle.
- `npm run test:cartography -w @dnd/server`: PASS twice; DM + 3 independent Player sessions, all six kinds, map CRUD, private backgrounds/fragments, role/campaign isolation, element limits, corrupt images, origin rejection, same-element concurrent 200/409, independent-element writes, locks, explicit issue/revoke, placement/scale/rotation, reconnect, actual process restart and membership revocation.
- `test:auth`, `test:campaigns`, `test:rooms` (DM + six Players), `test:scenes`, `test:fog`: PASS; Scene/Fog/legacy preservation is also asserted by cartography test.
- Existing Postman Cloudinary outage simulation: observed SDK HTTP requests for the new background and fragment routes, both 503; `test:storage-outage` PASS. No provider secret was used in the simulation. Normal upload/private delivery were tested separately against real Cloudinary.
- Browser: DM created an issued blank map, placed an NPC note, explicitly issued a previously private fragment, placed it and saved scale 1.5 / rotation 25°. A route drawn at 59% after a camera pan saved the expected map anchor (about 406,320). Active Scene remained unchanged.
- Repeatable-read backup + isolated migration rehearsal PASS before public migration. The pre-migration backup `pre-table-foundation-1793022648817.json` was explicitly restored and verified. After populating new models, `pre-table-foundation-1793023378414.json` also restored and matched every row, including non-empty route vertices and fragment transforms. Temporary recovery schemas removed; live public data never replaced. Backups/checksums are private and ignored under `.backups/`.

## Operational boundaries

Canvas dimensions are chosen at creation and stay fixed, keeping existing coordinates stable. Optional background is fitted to those dimensions. Maps and fragments are intentionally campaign knowledge, separate from Fog of War on battle Scenes. Issuing a map shares its entire background; upload only player-facing material. Revocation blocks future access and removes placements from permitted state, but cannot erase images/text a player previously viewed or saved. Drawing is saved once at gesture completion; incomplete or failed gestures are not persisted. Fragment transformations use its top-left anchor.

The supported deployment remains a single Node/Socket.IO process. In-memory invalidation works on this existing single-instance service; scaling to multiple processes would require a shared event adapter. No new service, plan, storage provider or environment secret is introduced.

## Deployment

Existing target: https://dungeon-master-tvra.onrender.com, Render service `srv-dbfb4l8m7kps738e51c0`, confirmed My Workspace. Runtime commit `fb8e026fbb53250f08294e3d9d0d920c0feed029`; deployment `dep-dbflsvivcj2c738ktkvg` is **live** (2026-10-26 15:08, Europe/Warsaw). Four-client integration tests are automated sessions, not four physical PCs.


Final public verification:

- `npm run test:cartography -w @dnd/server -- https://dungeon-master-tvra.onrender.com`: PASS public HTTPS/WSS DM + 3 Players; CRUD, simultaneous edits, element locks, private materials/images, issue/revoke, fragment transforms, bounds/quotas, reconnect and unchanged Scene state.
- `npm run test:live -w @dnd/server`: PASS registration/login, invitations, secure cookies, DM + 3 registered Players, presence, original scene/token synchronization and reconnect/reload.
- `npm run test:fog -w @dnd/server -- https://dungeon-master-tvra.onrender.com`: PASS Fog of War and token/image privacy on the updated production runtime.
- Public API comparison after Render replaced the process: the pre-deployment map and every element field matched the saved baseline, including non-empty route points, note drag, fragment scale 1.5 and rotation 25°. Image download succeeded; active Scene unchanged.
- Browser on the live site rendered the restored note, route and fragment. Screenshot: ignored `.backups/cartography-public.png`.
- Render error-level application-log query after rollout returned no entries. All seven migrations up to date. No new secrets or infrastructure were introduced.

All automated-test records/provider images were cleaned. The separate browser fixture is removed after its screenshot, leaving existing campaigns untouched. No outstanding failed checks; four physical PCs remain a human playtest, beyond these independent automated clients.
