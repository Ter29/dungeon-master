# Sprint 3.3 — Audio Engine

## Architecture and contract

Audio belongs to Campaign and shares its existing session middleware, membership checks, transaction locks, Socket.IO room, authorization and per-campaign publication queue. The React Audio component uses the existing Cinematic Director socket, remains mounted above presentation modes and maintains no new session or independent connection. No scene, token, fog, combat or map columns are modified by audio commands.

Models: `Campaign.audioVersion`; `AudioAsset` (private Cloudinary key, category MUSIC/AMBIENCE/SFX, name/description, actual duration/format, revision, cleanup tombstone); `AudioChannel` (campaign + key, current/outgoing assets, play/pause state, position/clock anchor, loop, volume and bounded fade envelope); `AudioCue` (short-lived SFX download grant, never replayed as active playback). Keys currently restricted to MUSIC/AMBIENCE; composite-key channel design permits future named layers through an explicit migration/contract extension.

Cloudinary authenticated `resource_type: video` supports MP3/OGG/WAV. The existing credentials are reused; no paid services or add-ons. Originals stay in Cloudinary; PostgreSQL stores metadata only. Same-origin authenticated proxy streams bounded responses and forwards a single byte Range, with session/member/grant checks before request and response. Neither signed provider URLs nor private keys are sent to the browser. Already delivered audio bytes cannot be revoked from a participant's memory/capture.

Default configurable limits (environment): `AUDIO_MAX_BYTES=20971520` (20 MiB, hard supported ceiling 50 MiB), `AUDIO_MAX_SECONDS=1800`, `AUDIO_SFX_MAX_SECONDS=30`, `AUDIO_MAX_ASSETS=100`, `AUDIO_CAMPAIGN_BYTES=262144000`. Memory multipart uploads share the existing single upload slot. MIME allowlist plus magic/container/codec/sample-rate/channel/duration inspection via music-metadata; audio only, mono/stereo. Upload limit 15/15min/IP, commands 120/min/IP, SFX 12/10sec/campaign, browser 6 concurrent SFX, server 8 streaming requests. Failed uploads leave private tombstones for `npm run media:cleanup -w @dnd/server`; this command also removes expired cue grants.

API base `/api/campaigns/:campaignId/audio`:

- GET `/state`: allowed versioned snapshot plus server time; no library or historical cues.
- GET `/assets`: DM-only library and limits.
- POST `/assets`: DM multipart file/name/category/optional description; metadata validation and protected upload.
- PATCH `/assets/:assetId`: DM name/description + asset revision.
- DELETE `/assets/:assetId`: DM asset revision; clears its channels/cues, increments audio version, tombstones and asynchronously removes provider original.
- GET `/assets/:assetId/file`: DM preview or Player current/paused channel/outgoing crossfade asset; SFX requires `?cue=event-id` matching unexpired grant. Unreleased/revoked IDs return 404. Private no-store; no redirects to provider.
- POST `/channels/:key`: DM global version/action (PLAY, PAUSE, RESUME, STOP, SETTINGS, FADE_IN, FADE_OUT), optional loop/volume/fadeMs. PLAY requires assetId + assetRevision. Fade 0–15000ms; switching uses bounded one-outgoing crossfade. Stale global or selected asset version: 409.
- POST `/cues`: DM assetId + assetRevision, SFX only; creates fresh event ID and short-lived grant. Channel version is unchanged.

Socket events: `audio:snapshot` on existing room join/sync and state changes; `audio:library-changed` to DM only; `audio:cue` to currently authorized connected members only, discarded by server if publication is >3s late. No cue replay on reconnect. Clients ignore older state versions, deduplicate cue IDs and drop late/unactivated cues.

The server stores playback anchor/position rather than writing every second. Snapshots derive natural nonloop completion and completed fade-out as STOPPED, without leaking stale asset permissions. Client estimates server clock offset, seeks by elapsed time/modulo loop duration, corrects >1.2s drift every 4s and resynchronizes on visibility change/reconnect. This is atmospheric, not sample-accurate synchronization.

Audio uses HTML media elements through a real AudioContext/GainNode graph. Explicit «Увімкнути звук» resumes AudioContext; rejected `play()` and suspension produce retry guidance. The UI claims actual playback only after `playing`, and each participant has local per-user Master/Music/Ambience/SFX/Mute preferences. Global channel volume is a separate DM setting. Private DM preview uses native audio controls and makes no global write.

## Provider and runtime limits verified 2026-10-26

[Cloudinary audio formats](https://cloudinary.com/documentation/audio_transformations), [authenticated assets](https://cloudinary.com/documentation/control_access_to_media), [free billing allocation](https://cloudinary.com/documentation/billing_and_plans), [file-size plan comparison](https://cloudinary.com/pricing/compare-plans). Free: 25 shared credits, one credit = 1 GB storage or 1 GB free video bandwidth or 1000 transformations; simultaneous use adds together. Current free max video file size 100 MB; app limits are lower. Shared storage/bandwidth also includes existing maps/images. Short compressed MP3/OGG loops use less quota than WAV. No automatic paid upgrades. Proxy traffic also uses Render bandwidth and one streaming slot; this MVP targets one small campaign, not a public radio service.

## Verification and deployment

Passed locally: TypeScript and production build; Audio API integration with DM + 3 Player sessions, actual protected Cloudinary upload/download of MP3/OGG/WAV, MIME/corruption/duration rejection, Range 206 and invalid-range 416, unsigned provider access denial, private preview/library isolation, play/pause/resume/stop, loop, channel gains, fade envelopes, crossfade, stale asset/global revisions, concurrent commands 200/409, SFX scoped grants/spam/no replay, reconnect and actual server-process restart, Director/gameplay isolation. Fixtures and provider files cleaned after each test.

Passed regression scripts: auth, campaigns, rooms (DM + 6), Director, combat, Fog/token API and cartography. An initial seven-user presence timeout exposed quadratic snapshot publications on join. Initial/sync snapshots now go only to the requesting re-authorized socket; room presence and actual mutations retain broadcasts. The unchanged seven-user test and Audio suite passed after this fix.

Postman dependency simulation: actual built application and Cloudinary SDK reached `/video/upload`, received 503, and kept the failed upload private/tombstoned without changing audioVersion/channels. Existing image outage checks also passed. Synthetic tones and fake credentials only; this simulation proves safe failure behavior, while real-provider tests above prove actual private storage compatibility.

Migration `20261026193000_audio` is additive. Pre-migration rehearsal/backup `pre-table-foundation-1793042503663.json` passed before apply. Ten migrations now applied. Backup `pre-table-foundation-1793043080397.json` includes two active looping channels and a round-4 battle; both rehearsal and independent `db:restore-foundation --verify-only` restored and compared all records exactly in an isolated schema, removed afterwards. Live public data was not overwritten.

Real browser verification passed locally after the user explicitly authorized isolated Playwright testing. `test:audio-browser` exercised DM + 3 Player browser contexts, real Chrome MP3/OGG/WAV decoding, nonzero AudioContext output waveform, advancing timeline, simultaneous channels/SFX, independent mute and volume, crossfade/fade out, all four Director modes, reconnect/reload and persisted personal settings. A deliberately failed media request produced a visible play error with zero playback; removing the failure and clicking activation restored real output. The stopped indicator was verified truthful. No Audio/play()/AudioContext mock was used. This Chrome permits the isolated autoplay probe despite strict flags; explicit application activation and absence of any output context beforehand were verified. Physical speaker audibility/human listening is not claimed.

The initial Computer Use URL-policy blocker was resolved through explicit permission for the alternative isolated browser. Final public deployment verification will be recorded with the Obsidian Table UI release; no URL, plan or environment-secret changes are required.
