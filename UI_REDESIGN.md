# Obsidian Table — Command Center redesign

## Audit and structure

Starting point: one long CampaignPage containing table, scene preparation, initiative, invitations and nested Director/Audio panels; no shared theme or persistent navigation. Scene/token/Fog controls competed with canvas height. Player inherited much of the same page structure. Sprint 3.3 existed locally in commit `3708a83`, while production was Sprint 3.2 (`08d4f6e`). Audio was not treated as already deployed or browser-verified.

The existing React architecture and APIs are retained. `features/workspace/Workspace.tsx` owns the shared layout, role-aware navigation, context-panel collapse, per-user/campaign section preference, summary indicators, save feedback and draft warnings. Stable portal targets place existing feature components into the main/context regions without moving or unmounting their canvases between sections. `CampaignWorkspace.tsx` composes the command center; the previous CampaignPage remains available in source during verification. No new backend, session system or database changes for UI.

Sections: Table, Scenes, Maps, Director, Audio, Combat, Campaign. Player has only Table/Maps/Combat/Campaign, personal volume and the permitted presentation. Private DM libraries remain server-protected. Current location, presentation mode, connection/presence and selected music are summarized in header/footer.

Theme: graphite/navy panels, restrained gold/bronze, warm text, green connection/save states, red alerts; local system sans serif and Georgia headings, no external font requests or heavy UI dependencies. Responsive three-column layout targets 1920×1080 and 1366×768; narrower screens use a compact rail and a collapsible context drawer. Focus outlines, named icon buttons, keyboard navigation, scrollable panels and reduced-motion support are provided.

## Feature changes

- Table: enlarged canvas, compact toolbar, Fog/grid/tokens in context panel. Pan/zoom/world coordinates/drag/pings and all server permissions retained.
- Scenes: private scene thumbnails/list at right, editor and upload/preview in main; active state and explicit access to Director materials.
- Director: central current-output/private-preview monitor, compact global mode controls, private library/editor at right. Preview changes no global state.
- Maps: persistent shared canvas, map chooser and context tools/element editing/fragments/admin. Viewing never activates a Scene.
- Audio: separate Music/Ambience cards, SFX grid, per-user favorite effects, private library at right, compact personal controls above presentation modes. Actual playback/error indicators and retry reload for failed media. Same Director socket retained.
- Combat: existing initiative controls in dedicated workspace; compact allowed initiative summary for Player on Table.
- Campaign: live membership, invitations with revocation confirmation, role summary. Legacy diagnostic room mounts only when explicitly opened.
- Draft indicators and before-unload warning for scene/material/token/grid/map-element editors. Section changes keep drafts/cameras mounted. Leaving via application links asks before discarding drafts. Successful API mutations show brief save feedback; existing errors and conflict handling retained.

## Verification

Local TypeScript and production build passed. Local browser suite passed all seven DM sections and four Player sections at 1920×1080 and 1366×768, with no document/main/context horizontal overflow or unnamed visible buttons. Verified actual token drag, real Fog brush save, private Player data/controls, mounted camera/draft preservation, private Preview, Show/Table, Audio UI/favorites, initiative Next, section restoration and reconnect. A separate real-audio browser suite passed DM + 3 Player output, errors/retry, mixing, volume isolation and Director compatibility. Browser tests exposed and fixed status text that could hide a play error or remain “playing” after Stop.

No Prisma changes were introduced for the redesign. The separately verified additive Audio migration and backup/restore evidence are in [AUDIO_ENGINE.md](AUDIO_ENGINE.md). Production deployment details will be appended after public checks.

Tests: `npm run typecheck`, `npm run build`, `npm run test:workspace-browser -w @dnd/server [-- HTTPS_ORIGIN]`, `npm run test:audio-browser -w @dnd/server [-- HTTPS_ORIGIN]`. Browser tests use isolated synthetic accounts and private campaigns, clean up provider assets/data, and do not access the user's browser profile. Optional `UI_MAP_PATH` supplies a local test map; fallback is a generated geometric test image. No user map is committed to Git.

Browser screenshots are saved under ignored `.backups/workspace-ui/` (local) or `.backups/workspace-ui-public/` (HTTPS): every DM section and Player Table at both target resolutions, plus Player Illustration. Actual audio tests inspect real media timelines and AudioContext output waveform, not just Socket.IO state. On this installed Chrome the isolated autoplay probe is permitted despite strict flags; the application nevertheless creates no output context before explicit activation, and real failed-media/retry behavior is tested separately. No claim about physical speaker audibility or a human listening is made.
