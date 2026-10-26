# Sprint 3.1 — Combat Foundation contract

Combat is separate from map movement, Fog of War, cartography and dice. Only a campaign DM writes combat state. An encounter belongs to one campaign and Scene; participants reference Tokens from that Scene. One open encounter (PREPARING or ACTIVE) per campaign, enforced by a partial unique database index plus a campaign transaction lock.

Rules:

- Prepare an encounter for the active Scene, add participants and initiative, then explicitly start round 1. Empty preparation cannot start. Empty active roster waits for additions or explicit completion.
- Automatic order: initiative descending; ties use immutable addition sequence ascending, then ID as deterministic fallback.
- Manual reorder accepts every participant ID exactly once and switches to manual mode. Initiative edits retain manual order; explicit Sort by Initiative restores automatic mode. Active participant is preserved on reorder/edit.
- During ACTIVE, adding before the current participant waits until the next wrap; adding after it can act this round. Manual mode appends new participants. Adding to an empty ACTIVE roster selects that participant.
- Removing a non-current participant preserves the turn. Removing current chooses the next in the old order; removing the last advances the round and selects the first survivor. Empty roster clears current. Token deletion follows the same rule atomically. Scene deletion cascades its encounter; switching Scene does not automatically end it.
- Next and Skip advance exactly one participant; Skip means skipping the current turn, not removing the participant. Last-to-first increments round. Previous reverses the order and decrements round across a boundary; round 1 / first participant is a no-op. Rounds are bounded at 1,000,000.
- Completion requires explicit `confirm:true`, from preparation or active combat. Ended encounters remain in the database until their Scene/campaign is deleted; deleted Tokens remove their historical participant links.

API base `/api/campaigns/:campaignId/combat`:

- GET `/`: role-filtered CombatSnapshot.
- POST `/`: DM `{sceneId}` -> PREPARING; only current active Scene, conflict if an open encounter exists.
- POST `/:encounterId/start`: `{version}`.
- POST `/:encounterId/end`: `{version,confirm:true}`.
- POST `/:encounterId/turn`: `{version,action:'NEXT'|'PREVIOUS'|'SKIP'}`.
- POST `/:encounterId/participants`: `{version,tokenId,initiative?}`.
- PATCH `/:encounterId/participants/:participantId`: `{version,initiative}`.
- DELETE `/:encounterId/participants/:participantId`: `{version}`.
- PATCH `/:encounterId/order`: `{version,mode:'initiative'}` or `{version,mode:'manual',participantIds:[...]}`.

All writes use encounter optimistic version, campaign row lock, role and campaign/Scene scoping. Max 100 participants, unique Token per encounter, initiative integer -1000..1000. Writes persist before notification. No endpoint changes token positions or hidden flags.

Socket.IO `combat:snapshot`: safe per-role snapshot on join/sync, every combat mutation and every location/token/fog change. Snapshot includes campaign combatVersion and locationVersion so visibility changes and new encounters are ordered. Player gets combat only for the active Scene. Hidden/fog-covered tokens are excluded with the existing playerCanSeeToken predicate; no names, IDs, initiative, image URL, order gaps or hidden participant count are sent. Current participant ID is null when not visible; UI gives a generic DM-turn status, without a hidden-token placeholder. DM receives the full roster.

Implementation, verification and deployment evidence will follow.
## Implementation files and data

- `apps/server/prisma/schema.prisma`: CombatEncounter, CombatParticipant, CombatStatus; Campaign.combatVersion. Encounter stores phase, round, active participant FK, manual mode, stable join sequence, optimistic version and timestamps. Participant stores Token FK, initiative and persisted position.
- Migration `20261026070000_combat`: additive Campaign column, new tables/enum/indexes/FKs, one-open-per-campaign partial unique index, round/initiative/order constraints. Existing Scene/Token records are retained.
- `apps/server/src/combat/engine.ts`: pure sorting, forward/backward/skip and removal transitions. Every result contains only turn fields, even when passed an expanded database record.
- `combat/service.ts`: bulk SQL order persistence, campaign version updates and atomic token-deletion repair.
- `combat/router.ts`: membership/DM checks, JSON/origin/rate validation, campaign transaction lock, encounter versions, scoped Token lookup, roster limits and confirmation.
- `combat/state.ts`: repeatable-read snapshots and role-specific projections using the unchanged Fog/token visibility predicate. Raw position/join-order values and image URLs are not exposed in combat DTOs.
- `apps/server/src/sockets/rooms.ts`: authenticated `combat:snapshot` publication, existing per-campaign queue, join/sync and location-change refresh.
- `apps/server/src/scenes/router.ts`: token deletion repairs the turn inside its existing transaction. Scene/token/fog changes affecting an open encounter increment the combat snapshot version, including an inactive combat Scene, so stale HTTP snapshots cannot resurrect old visibility. Scene deletion also invalidates combat state.
- `packages/shared/src/events/combat.ts`, shared exports and room event interface: typed CombatSnapshot, CombatEncounterView and CombatParticipantView.
- `apps/client/src/features/combat/CombatPanel.tsx`: preparation/start/end confirmation, participant selection, initiative editing, manual arrows, sort, turn buttons, round/current display and compact Player roster. Initiative drafts retain their starting version and stale edits are rejected.
- `apps/client/src/features/scenes/LocationTable.tsx`: consumes combat snapshots on the existing socket and preserves the interactive map. Snapshots use both campaign combat and location versions. Existing cameras, movement permissions and pings are unchanged.
- `LocationManager.tsx`: existing Scene deletion confirmation now explicitly mentions its Tokens and associated combats.
- Backup/recovery scripts: include both combat tables, insert encounter current pointer as null, restore it after participants, then verify all rows exactly. Older backups remain supported.
- `scripts/check-combat-engine.ts`, `scripts/check-combat.ts` and npm commands: engine and real API/DB/socket tests.

## Local verification — 2026-10-26

- `npm run typecheck`: PASS shared/client/server.
- `npm run build`: PASS Prisma generation, TypeScript and Vite production build.
- `npm run test:combat-engine -w @dnd/server`: PASS initiative ties, next/previous/skip, round boundary/floor, empty/single participant and active/non-active/last removal. A first integration run caught extra fields on a no-op transition; fixed and covered by an expanded-record test before deployment.
- `npm run test:combat -w @dnd/server`: PASS DM + 3 independent Player sessions with real Neon/Cloudinary; preparing/start/end, explicit confirmation, concurrent encounter creation 201/409, database-level unique constraint, concurrent turns 200/409, bounds/100-participant quota, manual order and automatic re-sort, ties, mid-combat addition/removal/token deletion, current/round persistence, DM-only writes, stale versions, outsider/campaign scoping and origin rejection.
- Tracker privacy: hidden Token/participant/media IDs and name absent from captured Player packets and API. Fog re-hide/reveal reprojects the roster; revealed fog does not unhide a Token. Visible flag alone cannot bypass Fog; image access remains protected. Inactive combat Scene returns no encounter to Player.
- Real reconnect and local process kill/restart restored the allowed active encounter. Ending permitted a new encounter. Scene deletion cascaded it without breaking old Scene CRUD.
- Regression `test:auth`, `test:campaigns`, `test:rooms` (DM + six), `test:scenes`, `test:fog`, `test:cartography`: PASS.
- Browser DM prepared a fight, added Aria 18, Borin 10, Goblin 12, Hidden scout 18, started and used Next/Previous/Skip through round 3. Tie order Aria then Hidden scout persisted. End confirmation appeared and cancellation preserved ACTIVE state.
- Before migration: repeatable-read backup and isolated migration rehearsal passed; `pre-table-foundation-1793024537660.json` restored explicitly. After an active round-3 fight existed, `pre-table-foundation-1793025253538.json` restored and matched all original rows, including currentParticipantId and all participants. Temporary recovery schemas removed; public data never overwritten. Backups/checksums and UI fixtures remain ignored/private under `.backups/`.

## Boundaries and deployment

This is initiative/turn tracking, not combat automation: no speed, movement requests, attacks, HP, dice, lighting or new Fog rules. Previous follows the current order rather than a historical undo log. Completed encounters are persisted but no history browser is introduced. Scene deletion intentionally removes its combat records, as the UI confirmation states.

The existing single Node/Socket.IO process remains the supported runtime. No new dependencies, service, storage provider, secret or domain is required. Target: https://dungeon-master-tvra.onrender.com, existing Render service `srv-dbfb4l8m7kps738e51c0` in the previously confirmed My Workspace. Public deployment/tests pending at document creation. Four concurrent automated clients do not constitute four physical PCs.
