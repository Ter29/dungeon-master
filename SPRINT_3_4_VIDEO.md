# Sprint 3.4 — Director video cutscenes

## Architecture and scope

Video is an additional `VIDEO` mode of the existing Cinematic Director. It uses the existing campaign authentication, DM/Player membership, `presentationVersion`, Director event emitter, campaign Socket.IO room and `director:snapshot` event. No server, session system or socket connection was added. Existing scene, token, Fog, initiative and cartography models/commands are unchanged.

Prisma migration `20261027010000_video_director` adds the enum value and two tables:

- `VideoAsset`: campaign, private storage key, name/description, byte size, verified duration/dimensions/audio presence, metadata revision, creation/deletion timestamps.
- `VideoPlayback`: one row per campaign, current asset, status, position, server start timestamp, previous presentation mode/material, Music/Ambience duck factors. The existing campaign presentation version protects all video and presentation commands.

The migration is additive. A consistent ignored JSON backup with checksum was restored in a temporary schema before applying it; all original records/columns compared exactly. No destructive SQL was used. The previous backend remains compatible with non-VIDEO campaigns. For runtime rollback, first return active VIDEO campaigns through the new API, then roll back code; leave the additive schema in place.

## Infrastructure and limits (checked 2026-10-27)

Cloudinary's Free plan has [25 shared monthly credits](https://cloudinary.com/documentation/billing_and_plans), with storage, transformations and delivery consuming the same allowance. [Plan comparison](https://cloudinary.com/pricing/compare-plans) lists a 100 MB video upload ceiling. This is not an unlimited video hosting entitlement. Free video bandwidth uses 1 GB per credit; storage also consumes credits. No paid plan or resource was enabled.

[Authenticated delivery](https://cloudinary.com/documentation/control_access_to_media) protects originals and derived files. This implementation uploads original H.264/AAC MP4 with `resource_type=video`, `type=authenticated`, without eager/on-demand transcoding, ABR or thumbnails. [Progressive delivery and Range](https://cloudinary.com/documentation/video_optimization) are tested against the actual original, avoiding a first-time transformed response without seek support. Original duration is governed here by application limits, rather than relying on transformation-duration limits.

[Render Free](https://render.com/docs/free) remains the existing service; [Free compute](https://render.com/docs/compute-plans) is 512 MB/0.1 CPU. [Render pricing](https://render.com/pricing) currently lists 5 GB included outbound bandwidth for the free workspace tier. Authenticated proxy delivery consumes BOTH provider delivery and Render outbound quotas. Check actual workspace usage before long sessions. No billing settings were changed; an existing payment method/account usage policy can still cause provider overages independently of this code.

Configurable environment limits, requiring no new secrets:

| Variable | Default | Allowed ceiling |
| --- | --- | --- |
| `VIDEO_MAX_BYTES` | 25 MiB | 50 MiB |
| `VIDEO_MAX_SECONDS` | 180 seconds | 600 seconds |
| `VIDEO_MAX_ASSETS` | 20 per campaign | 100 |
| `VIDEO_CAMPAIGN_BYTES` | 150 MiB | 1 GiB |

MP4 only; one H.264 `avc1` track (Baseline/Main/High), up to 1920×1080, optional single AAC mono/stereo track. Bounded BMFF inspection rejects invalid boxes, fragmented files, unsupported sample types/profiles and external data references. Cloudinary's detected codec, dimensions and duration must agree before publishing the asset. No upload is made public while pending. Media must already be exported in a browser-compatible format; no server FFmpeg dependency is installed. The committed synthetic fixture was generated locally using FFmpeg testsrc2 + sine, libx264 Baseline, yuv420p, AAC and faststart; it contains no user media.

## API contract

All paths are under `/api/campaigns/:campaignId/director`; authenticated campaign membership is required. Mutations also require DM, permitted Origin and JSON/multipart Content-Type. Upload and command/read rate limits apply. Errors contain a safe Ukrainian message and no provider URL/key. Version conflicts return 409; malformed/unsupported files return 400/415; size/quota returns 413; provider failures return 503. Upload capacity is shared with existing image/audio uploads to bound memory.

| Method/path | Role | Body / response |
| --- | --- | --- |
| `GET /videos` | DM | `{videos, storageAvailable, limits}`; private campaign library |
| `POST /videos` | DM | multipart `file`, `name`, optional `description`; 201 `{video}` |
| `PATCH /videos/:id` | DM | `{revision, name?, description?}`; `{video}` with incremented revision |
| `DELETE /videos/:id` | DM | `{revision}`; 204, immediate access revocation, retryable provider cleanup; restores previous presentation if active |
| `GET/HEAD /videos/:id/file` | DM or allowed Player | MP4; Player only while this asset is active in VIDEO mode. Single byte Range/suffix supported; exact 206/Content-Range, invalid range 416 |
| `POST /video` | DM | PLAY body below or `{version, action:PAUSE/RESUME/STOP/RETURN}`; returns DirectorSnapshot |
| `GET /state` | member | Existing endpoint; active permitted presentation only |
| `PATCH /state` | DM | Existing image/Table/Blank commands; cancels current video when switching explicitly |

PLAY body: `{action:"PLAY", version, videoId, revision, duckMusic?:0..1, duckAmbience?:0..1}`. Duck defaults are 0.25. An explicit PLAY restarts a clip; reconnect never issues PLAY. STOP/RETURN restore the prior mode and valid prior material. A removed previous material falls back to Blank. Switching from one video to another retains the original non-video return target.

VideoAssetView contains safe metadata plus a same-origin proxy path; never `storageKey` or a Cloudinary delivery URL. Video DirectorSnapshot adds `serverTime` and `video:{asset,status,position,startedAt,duckMusic,duckAmbience}`. Previous material IDs remain server-only. Non-video snapshots retain the existing shape for compatibility.

## Private delivery

The audio media proxy was extracted into `src/media/stream.ts` and reused for video. It checks single Range syntax, streams with backpressure (16 shared concurrent requests, bounded file size and 120-second timeout), aborts on client close, validates upstream 206/range/length and rechecks permission before sending bytes. No video blob is stored in PostgreSQL or on Render disk. Multipart bytes are temporary bounded memory only. The backend signs Cloudinary delivery internally and does not redirect or expose that URL. Already delivered bytes cannot be revoked from browser memory; subsequent requests are denied after Stop/deletion/revocation.

Failed/pending uploads are tombstoned and excluded from the library/state. `media:cleanup` now includes retryable video deletion. Library changes use the existing DM-only `director:library-changed` notification. No extra Socket.IO event names were introduced.

## Playback, recovery and ducking

Server time and `position + elapsed since startedAt` define the approximate global timeline. Campaign-row transactions serialize commands; stale or duplicate versions cannot overwrite newer state. Pause persists position; Resume preserves it and advances the start timestamp. A two-second server recovery sweep and snapshot-time validation restore previous presentation when elapsed duration is reached, an asset disappears or playback is invalid. This also runs after restart and does not depend on a client reporting `ended`.

The single Director VideoPlayer renders contain/letterbox video in a cinematic overlay without unmounting the table. It checks drift every three seconds, correcting over 1.2 seconds, and aligns on metadata/retry. Actual playing/loading/paused/error feedback reflects browser events, not just server PLAYING. Slow loads have an explicit notice. Fullscreen, keyboard focus containment and reduced motion are supported. Black/loading, local fade in/out and return transitions do not mutate game state.

The existing CampaignAudioEngine and AudioContext are shared through a small React context. Video audio is connected once per media element into the existing master output, with a new local `video` gain saved alongside each user's audio preferences. The existing “Увімкнути звук” action activates it; before activation video may play silently. Browser rejection gives a retry action. Master mute is respected, including after reconnect.

Ducking is an absolute, idempotent multiplier on Music/Ambience gain, with WebAudio smoothing. It applies only while the actual video with an audio track is playing and sound is activated. Pause, buffering, error, Stop, end, disconnection/unmount restore unity. SFX is unchanged. Stored global volumes/statuses/positions and local user settings are never overwritten by ducking. The actual video AAC signal and background gains are measured by the browser test.

## Changed files

- Backend: Prisma schema/migration; `director/state.ts`, `router.ts`, new `video-router.ts`, `video-storage.ts`; shared `media/stream.ts`; audio router uses that helper; index starts/stops recovery.
- Contracts: shared `events/director.ts` and barrel exports.
- Frontend: Director orchestration/controls, new `VideoLibrary.tsx`, `VideoPlayer.tsx`, `video.css`; audio engine/component and new `PlaybackContext.ts`.
- Operations/tests: cleanup and backup rehearsal; `check-video.ts`, `check-video-browser.ts`, `video-test-kit.ts`, `check-media-stream.ts`; storage outage test; synthetic `fixtures/video/cutscene.mp4`; server package test scripts.

## Verification and release

Local PASS so far: typecheck/build, Video API with DM + three sockets, real Cloudinary authenticated upload/delivery/unsigned denial, exact Range/suffix/416, concurrent 200/409 commands, expiry across process restart, active deletion and private metadata; shared proxy real HTTP outage/ignored Range/mismatch/authorization tests; real SDK upload against the existing HTTP outage simulation member (Postman CLI was not on PATH, so the committed Node member was run directly), safe 503 and private tombstones.

Real Chrome browser PASS: H.264 decoded frame counter, AAC pre-gain waveform and advancing timeline; four isolated browser contexts; simultaneous Music/Ambience/video, absolute 25% duck and restoration, local mute, Pause/Resume/Stop/end, drift correction, late join/reconnect, actual HTTP 503 and retry, Fullscreen/reduced motion, 1366×768 and 1920×1080, preserved world camera/scene and unchanged database audio channels. The isolated unactivated autoplay probe was permitted by this Chrome; no claim is made that an actual browser policy rejection occurred. Explicit app activation and silent-before-activation behavior are part of the implementation. No physical speaker or four physical PC test is claimed.

Local regression PASS: Director, Audio API, Fog/token, Combat and Cartography integration suites, Workspace Browser (all sections/both sizes, drafts/camera/privacy) and real Audio Browser (MP3/OGG/SFX, fades, Director modes, four users, reconnect/reload). Final typecheck/build passed. Extra Video API checks passed for restoring a previous Portrait, withholding its image while Video plays, and fallback to Blank if that return target is deleted. Both pre-migration and post-migration backup/restore rehearsals passed. Ignored backup files: `.backups/pre-table-foundation-1793070340351.json` and `.backups/pre-table-foundation-1793071483931.json`, each with a checksum.

Actual Cloudinary account read before release confirmed **Free**, 0.91/25 credits (3.64%) at the time checked. This is a point-in-time reading, not a future usage guarantee.

Public deployment evidence will be appended after release checks.

Known MVP limits: progressive MP4 only, no adaptive bitrate/transcoding; approximate time sync, not frame lock; provider/network buffering may delay a client; cached bytes are not retractable; Chrome is the browser tested here, other browser codec support may vary. Video has a separate local volume but uses existing Master/Mute.
