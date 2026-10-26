# Scene storage outage simulation

## Purpose

Local Cloudinary 503 dependency simulation based on the documented Upload/Download API. No owner-provided mock was used; the local handler models only the routes exercised by `apps/server/src/scenes/storage.ts`. Successful storage/private delivery is covered separately against real Cloudinary by `check-storage.ts` and `check-scenes.ts`.

## Execution

From the repository root:

```sh
postman simulation run postman/simulations/scene-storage-outage.sim.yaml --port 4900 --no-history --output ndjson
```

In another terminal, from `apps/server`:

```sh
npx tsx --env-file-if-exists=.env scripts/check-storage-outage.ts
```

The test starts the real built app, injects fake Cloudinary credentials and a test-only upload prefix, calls its upload/read API against PostgreSQL and cleans up its records. Stop the simulation with Ctrl+C. Do not log real credentials through this simulation.

## Assumptions

- Observed 2026-10-26: SDK upload uses the prefix at module load to select HTTP/HTTPS; test credentials include the local upload_prefix query before process startup.
- The mock does not validate Cloudinary signatures, store image bytes or establish real provider compatibility. It covers safe failure behavior only.

## Observations

<!-- begin observations -->
- 2026-10-26: Cloudinary member received POST upload and GET download, both returned 503. The application retained its previous background, revision and location version, and left a pending media record for cleanup. No member stayed silent. Real Cloudinary tests separately passed authenticated upload/download and unsigned-access denial.
<!-- end observations -->

## What didn't work

- 2026-10-26: CLI 1.73.0 required an explicit config.yaml path rather than a directory and access to its local ~/.postman cache; the committed simulation now uses the manifest path.
