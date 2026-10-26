# Campaign rooms (Socket.IO)

Connect through the same origin as the frontend using the session cookie and `auth: { campaignId: UUID }`. The server checks session expiry, campaign membership and Origin before joining `campaign:<id>`. Anonymous users and nonmembers cannot subscribe. Mutations recheck session/membership and DM role. Logout/session rotation disconnects affected sockets immediately on this single server; expiry disconnects at the session deadline.

Shared TypeScript event contracts live in `packages/shared/src/events/room.ts`.

| Client event | Payload | Authorization |
|---|---|---|
| room:sync | acknowledgement callback | Campaign member |
| player:ping | {x,y}, acknowledgement | Campaign member |
| token:move | {x,y,version}, acknowledgement | DM |
| scene:change | {scene,version}, acknowledgement | DM |

Acknowledgements: `{ok:true}` or `{ok:false,message}`. Missing callbacks are ignored. Coordinates are finite numbers in [0,100], scenes are `scene-1`/`scene-2`, version is a nonnegative integer. At most 50 commands per 10 seconds per socket; payloads limited to 16 KiB.

| Server event | Payload |
|---|---|
| room:snapshot | {version,state:{activeScene,positions},members:[{userId,displayName,role,online}]} |
| room:ping | {id,userId,displayName,x,y} |
| room:error | Generic message |

The test board has one token in each of two scenes. This is a temporary synchronization fixture; visual scene assets and full token/scene models are future work. Player pings are visible to campaign members and expire in the UI after 3 seconds; they never move tokens or persist to PostgreSQL.

Persistent state lives in Campaign.roomState JSONB. An optimistic version check and increment commit atomically; only then does the server broadcast a fresh snapshot. Conflicting DM actions receive a current snapshot and an error asking to retry. Per-campaign queues order snapshots on this server. Online presence counts unique users across all their connected tabs and is held in memory.

The client waits for a snapshot before allowing actions, ignores older state versions and receives a full snapshot on every reconnect. It does not queue offline gameplay actions or automatically retry writes. After an acknowledgement timeout it requests a snapshot because the original write may have committed. Do not enable Socket.IO command retries without an idempotency protocol.

Transport interruptions automatically reconnect. Explicit access denial or server-initiated disconnect requires login or the manual reconnect button. This architecture supports one backend instance. Multiple instances need a shared Socket.IO adapter, shared presence/revocation/rate limits and ordered broadcasts across instances.

`npm run test:rooms -w @dnd/server` runs against the configured real PostgreSQL database and a local server on 3104. It creates a DM, six players and an outsider, verifies permissions, isolated rooms, multiple tabs, state/pings, reconnection, logout and restart persistence, then removes only its own test records. This does not establish internet reachability or actual browser behavior on separate PCs.
