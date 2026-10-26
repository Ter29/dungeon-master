# Scene Foundation API

Existing Sprint 1 routes and `room:*` state remain unchanged. Location state uses a separate monotonic `locationVersion`. All routes require a session and campaign membership. Prepared scenes/metadata/media are DM-only. A Player can obtain only the active scene through the active endpoint, socket snapshot and a permission-checked image endpoint. No storage keys, Cloudinary URLs or prepared scene lists are sent to Players.

Base: `/api/campaigns/:campaignId/locations`.

| Method / path | Input | Success |
|---|---|---|
| GET / | DM | {scenes,version,activeLocationId,storageAvailable} |
| POST / | DM, {name,description?} | 201 {scene} |
| GET /active | member | {version,scene:null or active scene} |
| GET /:sceneId | DM | {scene} |
| PATCH /:sceneId | DM, {name,description,revision} | {scene} |
| DELETE /:sceneId | DM, {revision} | 204; active scene cleared if deleted |
| POST /activate | DM, {sceneId:UUID or null,version} | {version,scene} |
| POST /:sceneId/background | DM, multipart file + revision | {scene} |
| GET /:sceneId/background/:mediaId | member, DM or currently active scene | PNG/JPEG; no-store |

JSON mutations require application/json, upload requires multipart/form-data. Foreign Origin rejected. Version/revision conflict: 409. Invalid data: 400, unsupported file: 415, too large: 413, unauthenticated: 401, member without DM role: 403, unknown/inaccessible record: 404, unavailable storage: 503. IDs are validated. Upload: PNG/JPEG detected by decoder, declared MIME must match; <=8 MiB and <=20 MP. Sharp fully decodes/re-encodes to strip metadata/reject corrupt or animated images. Actual stored size is checked again. Upload permission is checked before buffering; uploads are rate/concurrency limited.

`location:snapshot` broadcasts `{version,scene}` on activation, active metadata/background changes, active deletion and reconnect. It contains only the active scene's id/name/description/background (internal authenticated image URL/dimensions); no inactive scene references. DM gets `locations:changed` invalidation without prepared metadata, then reloads their authorized API. Blank table uses scene:null. Existing legacy test table is retained in a separate collapsed DM section.

Cloudinary authenticated assets are delivered through the backend after checking current access, never with client-visible signed Cloudinary URLs. Existing downloaded content cannot be revoked from a player's memory. Deleted/replaced assets are tombstoned and cleaned up after commit; transient deletion failures retain the record for `media:cleanup`. No local filesystem fallback in production. Without CLOUDINARY_URL, CRUD/activation work but uploads return 503.
