# Sprint 3.2 — Cinematic Scene Director

## Contract

Director state is independent from Scene, Token, Fog of War, CombatEncounter and cartography. Campaign stores presentationMode (TABLE default), presentationMaterialId (nullable) and presentationVersion. PresentationMaterial belongs to Campaign, with category LOCATION/NPC/EVENT, name, player-facing description, imageId and optimistic revision; images reuse private authenticated Cloudinary MediaFile.

A material is granted to Players only while it is the campaign's active material in ILLUSTRATION or PORTRAIT mode. The prepared library and Preview are DM-only. Hide sets BLANK and clears the active material; Return to Table sets TABLE and clears it. Prior URLs return 404 after revocation. No original provider URLs/storage keys are returned. Previously viewed pixels cannot be erased from a player's memory/cache/capture.

API base `/api/campaigns/:campaignId/director`:

- GET `/state`: membership checked, `{version,mode,material}`; TABLE/BLANK carry no material.
- PATCH `/state`: DM only, optimistic campaign presentation version. TABLE/BLANK: `{version,mode}`; ILLUSTRATION/PORTRAIT: `{version,mode,materialId,materialRevision}`. Both current global version and the selected material revision must match; image required.
- GET `/materials`: DM-only safe library DTOs and storage availability.
- POST `/materials`: DM `{name,description?,category}` creates private draft.
- GET/PATCH/DELETE `/materials/:materialId`: DM scoped record, PATCH/DELETE require material revision. Active metadata edits update the presentation version; deleting the active material atomically moves to BLANK.
- POST `/materials/:materialId/image`: DM multipart `{revision,file}`, PNG/JPG up to 8 MiB/20 MP through existing validation/authenticated storage. An active image must be hidden before replacement; upload rechecks scope/revision/activity after remote upload. Failed/interrupted uploads retain retryable tombstones.
- GET `/materials/:materialId/image/:mediaId`: authenticated proxy, DM or currently permitted Player only. Rechecks session/member/current grant before and after download; private no-store responses.

All writes use campaign transaction locking; stale versions return 409. Library limited to 100 materials/campaign. Existing JSON/body and rate limits apply. No director endpoint writes gameplay columns.

Socket.IO: `director:snapshot` contains only current permitted material, on joins, room:sync, presentation mutations and active metadata changes. `director:library-changed` is sent only to re-authorized DM sockets and carries no private payload. Private Preview performs no global mutation.

UI: Player receives a fixed browser-viewport illustration/portrait/blank layer; Table stays mounted beneath it, inaccessible to input while covered. DM keeps authoring controls and the table, with a current-output monitor and separate private Preview. Image/caption fades are local; black background remains between cinematic materials. Rapid updates cancel obsolete transition timers and converge on the latest snapshot. Reduced-motion preference is respected. Mode changes never invoke Scene activation or combat commands.

## Implementation and local verification

Changed areas: Prisma schema and additive `20261026080000_director` migration; server `director/state.ts` and `director/router.ts`; shared director DTOs/events; Socket.IO join/sync/publication; React `features/director` and CampaignPage; backup/recovery tools; director integration and storage-outage tests. Scene and cartography uploads now share the same bounded upload slot with Director.

Passed: TypeScript, production build, director API/security/concurrency integration with DM + 3 Players, real Cloudinary PNG uploads, all four modes, stale global/material versions, active deletion to Blank, reconnect during Illustration and actual local server restart. Player packets and image routes were checked for private material leakage. Full gameplay state (Scene, grid, Fog, tokens, combat, cartography) compared unchanged after mode transitions.

Regression scripts passed locally: auth, campaigns, rooms (DM + 6), scenes, fog, cartography and combat. Storage 503 simulation passed for all four upload paths; failed Director upload preserved private draft and global state and left a cleanup tombstone.

Browser verification: private Preview left global TABLE/version 0 unchanged; Portrait displayed NPC name, Illustration filled the viewport, Blank contained no image. Rapid transitions converged to TABLE. Battle and cartography camera transforms were exactly unchanged before/after; both canvases remained mounted.

Recovery: pre-migration backup `pre-table-foundation-1793027610790.json` rehearsed before applying migration. Post-migration backup `pre-table-foundation-1793028876750.json`, including an active Illustration, restored and compared exactly using `db:restore-foundation --verify-only`; temporary schema removed, public schema unchanged. Backups remain ignored/private. An initial sandbox DNS failure was resolved by running the same verification with network access.

Deployment and public verification results pending.
