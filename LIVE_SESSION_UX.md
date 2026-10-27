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

Production deployment and public HTTPS/WSS evidence are recorded below after release verification.

Tests extend the existing browser suites to cover both viewport sizes, Live/Preparation, immersion, real Fit bounds, camera center/zoom preservation, draft retention, footer size, illustration load/error/retry, real audio output and existing navigation/token/Fog/combat behavior. Existing server integration suites verify role/private-material regressions separately. Actual browser audio is measured via the real AudioContext waveform/timeline; physical speaker/human listening is not claimed.

Before screenshots are unmodified captures from the previous production release, copied to ignored `.backups/live-polish/before`. After screenshots use the same supplied map and deterministic test campaign at `.backups/live-polish/after` (local) / `after-public` (HTTPS). Private images and screenshots are not committed to Git. Comparison pages identify the original Command Center versus Live/Immersive, not a new application.
