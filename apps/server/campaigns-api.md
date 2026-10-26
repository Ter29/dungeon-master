# Campaigns API

All routes require a valid session. Responses are no-store. All POSTs require application/json and reject foreign Origin. IDs are UUIDs; campaign names are trimmed, 1–120 characters. Authentication failures return 401, invalid input 400, inaccessible campaigns 404, DM-only operations by a member with PLAYER role 403.

| Endpoint | Input | Success |
|---|---|---|
| GET /api/campaigns | | 200 {campaigns: [{id,name,role}]} |
| POST /api/campaigns | {name} | 201 {campaign: {id,name,role:DM}} |
| GET /api/campaigns/:campaignId | | 200 {campaign: {id,name,role,members:[{userId,displayName,role}]}} |
| GET /api/campaigns/:campaignId/invites | DM only | 200 {invites:[{id,createdAt,expiresAt,revokedAt}]} |
| POST /api/campaigns/:campaignId/invites | {}, DM only | 201 {invite:{id,code,url,expiresAt}} |
| POST /api/campaigns/:campaignId/invites/:inviteId/revoke | {}, DM only | 204 (idempotent), 404 unknown invite |
| POST /api/invites/:code/join | {} | 200 {campaign:{id,name,role}}, 404 invalid/expired/revoked invite |

Campaign and DM membership are created atomically. Invite codes are 256-bit random base64url tokens, stored only as SHA-256 hashes, valid for 7 days, reusable by multiple registered players. Raw code/link is returned only on creation. Existing members keep their role on repeated joins, including DM. Join and revocation lock the same invite row to avoid joining after completed revocation. Names/emails of nonmembers and session/password/invite hashes are never returned. Invite creation and joining are limited per IP per server process.
