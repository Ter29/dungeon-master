# Obsidian Table — Live Session UX polish

## Scope and corrected issues

The Command Center design and existing feature components remain in use. Local per-user/campaign Preparation/Live preference controls presentation only; forms stay mounted, so navigating and switching modes preserves drafts. Player defaults to Live and receives no DM controls. Immersive mode removes navigation/header/context panels, retains an accessible footer exit, and exits with Escape.

Problems observed in the original 1366×768/1920×1080 screenshots: a floating audio card covered context tools; small auxiliary/control typography; full editors and decorative introductions competed with the canvas; initiative editing occupied every participant row; fixed SVG viewport proportions wasted available space; illustration load/transition could look like an unexplained black screen.

Changes:

- `Workspace.tsx`, `live.css`, theme layer ordering: Preparation/Live switch, immersion, larger readable controls, collapsible context/tools, stable slots. Personal volume lives in the footer; opening its settings expands the footer and reduces the canvas rather than overlapping it. Closed footer has an automated height bound.
- `InteractiveMap.tsx`, `camera.ts`: ResizeObserver uses the actual SVG aspect ratio. Fit contains the entire map with padding. Manual resize preserves world center and logical zoom; coordinates, token movement and Fog operations continue through the same SVG coordinate transforms/API. Initial automatic fit follows viewport changes until the user moves/zooms the camera.
- `TokenManager.tsx`, `LocationTable.tsx`: compact Fog/Grid/Tokens disclosures, optional live grid visibility, preparation forms retained; Player's compact initiative appears only during ACTIVE combat.
- `CampaignAudio.tsx`: compact Live Music/Ambience/SFX controls and full preparation library using the same component, same engine instance and same commands. Personal mute/gain remains per-user. Playback/error feedback retained; private preview remains separately labeled and closable in Live mode.
- `CombatPanel.tsx`: top Previous/Next/Skip controls, compact participant rows, initiative/ordering edits behind explicit disclosure. Existing combat functions/version checks retained.
- `LocationManager.tsx`, `DirectorControls.tsx`, `Cartography.tsx`: live scene activation, compact presentation controls, private Preview distinctly labeled, large administrative editors kept in Preparation. Ukrainian primary action labels.
- `PresentationScreen.tsx`: explicit image-loading, missing-image and retry error states. Blank is an intentional dark narration screen with a discreet explanation. Local fades/reduced motion retained.

No backend, Prisma, session, Socket.IO, shared API contract or Audio Engine changes. No migrations, paid resources, new libraries or production secret changes.

## Verification

Local checks passed: `npm run typecheck`, `npm run build`, `test:workspace-browser`, `test:audio-browser`, and the existing Director, Fog/token, Combat and Cartography integration suites. Browser QA covered 1366×768 and 1920×1080: all seven DM sections, all four Player sections, Live Table/Director/Audio/Combat/Scenes, immersive Player, Illustration and simulated image failure/retry. No horizontal overflow or unnamed buttons; closed footer ≤78 px. Fit bounds, manual camera center/scale, mode-switch drafts and reconnect were asserted.

Real Chrome audio test passed with DM + three independent Player browser contexts: nonzero output waveform and advancing timeline, simultaneous MP3/OGG/SFX, local mute/volumes, pause/resume, fades/crossfade, all Director modes, Live/Immersive, offline/reconnect/reload and saved preferences. This Chrome allowed the isolated autoplay probe; explicit application activation and rejected-play recovery were verified, but actual policy rejection is not claimed.

Production checks passed on the deployed version:

| Command | Evidence |
| --- | --- |
| `npm run test:live -w @dnd/server` | PASS HTTPS certificate, deep links, Secure/HttpOnly sessions, DM + 3 registered Players, invites, WSS presence, scene/token sync, Player permissions/ping, automatic reconnect/reload; temporary records removed. |
| `npm run test:workspace-browser -w @dnd/server -- https://dungeon-master-tvra.onrender.com/` | PASS seven DM/four Player sections at both sizes, private Player view, Fit/camera/drafts, Live/Immersive, Preview/Show/Table, Illustration error/retry, footer bounds, combat turn, Audio controls, section restore/reconnect. |
| `npm run test:audio-browser -w @dnd/server -- https://dungeon-master-tvra.onrender.com/` | PASS actual Chrome decode/output/timeline, DM + 3 Player contexts, simultaneous channels, local settings, fades, mode switches, reconnect/reload. |

All scripts completed with exit code 0 and their cleanup blocks completed. Tests use synthetic isolated campaigns, not existing player campaigns. Physical PCs/speakers and a human hearing test were not used. The installed PostgreSQL driver emits its pre-existing future SSL-mode semantics warning; checks pass and this UI release does not change database configuration.

Tests extend the existing browser suites to cover both viewport sizes, Live/Preparation, immersion, real Fit bounds, camera center/zoom preservation, draft retention, footer size, illustration load/error/retry, real audio output and existing navigation/token/Fog/combat behavior. Existing server integration suites verify role/private-material regressions separately. Actual browser audio is measured via the real AudioContext waveform/timeline; physical speaker/human listening is not claimed.

Before screenshots are unmodified captures from the previous production release, copied to ignored `.backups/live-polish/before`. After screenshots use the same supplied map and deterministic test campaign at `.backups/live-polish/after` (local) / `after-public` (HTTPS). Private images and screenshots are not committed to Git. Comparison pages identify the original Command Center versus Live/Immersive, not a new application.

## Release and screenshots

Existing site: https://dungeon-master-tvra.onrender.com/

- Runtime commit: `2583ee04648964082f93dd1cbfa9981b355794a3`.
- Render deployment: `dep-dbfutp59fdbs73c8mc8g`, **live**, finished 2026-10-27 00:24:32 UTC.
- Existing service `srv-dbfb4l8m7kps738e51c0`, My Workspace; same URL, Free plan, secrets unchanged.
- No schema or migration modifications. Existing campaigns are preserved; release changes frontend rendering and test scripts only. Existing start command checks migrations as before. Runtime rollback can redeploy previous commit `989b7bb80f9c0b2a55ee8c994e32a0d0656abfc0` without a schema rollback.
- `/api/ready`: HTTP 200, `{"status":"ok","database":"connected"}` after all checks. Render error-level logs for the release verification window were empty.
- Five side-by-side unaltered screenshot comparisons generated from previous production and current public screenshots: `comparison-table.png`, `comparison-player.png`, `comparison-director.png`, `comparison-audio.png`, `comparison-combat.png` in `C:/Users/smart/Desktop/DnD/.backups/live-polish/`.
- Full individual captures, including 1920×1080, Preparation Scenes and Illustration error/retry, are in `C:/Users/smart/Desktop/DnD/.backups/live-polish/after-public/`.
- Visual inspection confirmed no persistent decorative overlay on the table, footer audio no longer covers context tools, compact combat controls remain visible, and Illustration renders instead of an unexplained black area. Revealed/hidden map areas in the screenshots are intentional Fog state.
