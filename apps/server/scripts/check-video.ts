import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { io, type Socket } from "socket.io-client";
import type {
  DirectorSnapshot,
  ClientEvents,
  ServerEvents,
  VideoAssetView,
  PresentationMaterialView,
} from "@dnd/shared";
import { prisma } from "../src/database/client.js";
import { inspectVideo } from "../src/director/video-storage.js";
import { audioDeliveryUrl } from "../src/audio/storage.js";
import { VideoTestKit, wait } from "./video-test-kit.js";
const kit = new VideoTestKit(process.argv[2]),
  sockets: Socket<ServerEvents, ClientEvents>[] = [],
  latest = new Map<Socket, DirectorSnapshot>(),
  packets: string[] = [];
try {
  const bytes = await readFile("scripts/fixtures/video/cutscene.mp4");
  const info = inspectVideo(bytes);
  assert.equal(info.hasAudio, true);
  assert.equal(info.width, 640);
  assert.ok(info.duration >= 24);
  for (const b of [
    Buffer.from("<script>bad</script>"),
    bytes.subarray(0, 100),
    Buffer.alloc(26 * 1024 * 1024),
  ])
    assert.throws(() => inspectVideo(b));
  const codec = Buffer.from(bytes);
  codec.write("hev1", codec.lastIndexOf("avc1"));
  assert.throws(() => inspectVideo(codec));
  const dm = await kit.identity(),
    players = [];
  for (let i = 0; i < 3; i++) players.push(await kit.identity());
  const outsider = await kit.identity();
  const c = await prisma.campaign.create({
    data: {
      name: "Video integration synthetic",
      members: {
        create: [
          { userId: dm.id, role: "DM" },
          ...players.map((p) => ({ userId: p.id, role: "PLAYER" as const })),
        ],
      },
    },
  });
  kit.campaignId = c.id;
  const scene = await prisma.scene.create({
    data: {
      campaignId: c.id,
      name: "Unchanged scene",
      fogMask: "a".repeat(4096),
      tokens: {
        create: { name: "Secret enemy", hidden: true, x: 321, y: 234 },
      },
    },
    include: { tokens: true },
  });
  await prisma.campaign.update({
    where: { id: c.id },
    data: { activeLocationId: scene.id },
  });
  const before = JSON.stringify(
    await prisma.scene.findUnique({
      where: { id: scene.id },
      include: { tokens: true },
    }),
  );
  await kit.start();
  const connect = (cookie: string, player = false) => {
    const s: Socket<ServerEvents, ClientEvents> = io(kit.base, {
      auth: { campaignId: c.id },
      transports: ["websocket"],
      extraHeaders: { Cookie: cookie, Origin: kit.origin },
      reconnectionDelay: 100,
    });
    s.on("director:snapshot", (v) => latest.set(s, v));
    if (player) s.onAny((...args) => packets.push(JSON.stringify(args)));
    sockets.push(s);
    return s;
  };
  for (const [i, u] of [dm, ...players].entries()) connect(u.cookie, i > 0);
  await wait(
    () => sockets.every((s) => latest.get(s)?.mode === "TABLE"),
    "four sockets",
  );
  assert.equal((await kit.req(kit.path("/videos"))).status, 401);
  assert.equal(
    (await kit.req(kit.path("/videos"), players[0]!.cookie)).status,
    403,
  );
  assert.equal(
    (await kit.req(kit.path("/videos"), outsider.cookie)).status,
    404,
  );
  const a = (await kit.upload(dm.cookie)).video,
    secret = (await kit.upload(dm.cookie, "Unissued private video")).video;
  assert.equal((await kit.req(a.url, players[0]!.cookie)).status, 404);
  assert.equal((await kit.req(a.url, outsider.cookie)).status, 404);
  const row = await prisma.videoAsset.findUniqueOrThrow({
    where: { id: a.id },
  });
  const unsigned = audioDeliveryUrl(row.storageKey, "mp4").replace(
    /\/s--[^/]+--/,
    "",
  );
  assert.ok(
    (await fetch(unsigned)).status >= 400,
    "unsigned authenticated original denied",
  );
  for (const range of ["bytes=0-99", "bytes=-100", "bytes=100-"]) {
    const r = await kit.req(a.url, dm.cookie, undefined, "GET", {
      Range: range,
    });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get("accept-ranges"), "bytes");
    const data = Buffer.from(await r.arrayBuffer());
    assert.deepEqual(
      data,
      range === "bytes=0-99"
        ? bytes.subarray(0, 100)
        : range === "bytes=-100"
          ? bytes.subarray(-100)
          : bytes.subarray(100),
    );
  }
  for (const range of ["bytes=99999999-", "bytes=0-2,4-6", "bytes=-0", "bad"])
    assert.equal(
      (await kit.req(a.url, dm.cookie, undefined, "GET", { Range: range }))
        .status,
      416,
    );
  let state = await kit.json<DirectorSnapshot>(kit.path("/state"), dm.cookie);
  async function command(action: string, extra: Record<string, unknown> = {}) {
    state = await kit.json<DirectorSnapshot>(kit.path("/video"), dm.cookie, {
      action,
      version: state.version,
      ...extra,
    });
    await wait(
      () =>
        sockets
          .filter((s) => s.connected)
          .every((s) => latest.get(s)?.version === state.version),
      "state sync",
    );
  }
  assert.equal(
    (
      await kit.req(kit.path("/video"), players[0]!.cookie, {
        action: "PLAY",
        version: state.version,
        videoId: a.id,
        revision: a.revision,
      })
    ).status,
    403,
  );
  await kit.json(
    kit.path("/state"),
    dm.cookie,
    { mode: "BLANK", version: state.version },
    "PATCH",
  );
  state = await kit.json(kit.path("/state"), dm.cookie);
  await command("PLAY", { videoId: a.id, revision: a.revision });
  assert.equal(state.mode, "VIDEO");
  assert.equal(state.material, null);
  assert.equal(
    (
      await kit.req(a.url, players[0]!.cookie, undefined, "GET", {
        Range: "bytes=0-99",
      })
    ).status,
    206,
  );
  assert.equal((await kit.req(secret.url, players[0]!.cookie)).status, 404);
  const v = state.version,
    race = await Promise.all([
      kit.req(kit.path("/video"), dm.cookie, { action: "PAUSE", version: v }),
      kit.req(kit.path("/video"), dm.cookie, { action: "STOP", version: v }),
    ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  state = await kit.json(kit.path("/state"), dm.cookie);
  if (state.mode !== "VIDEO")
    await command("PLAY", { videoId: a.id, revision: a.revision });
  if (state.video?.status === "PLAYING") await command("PAUSE");
  const paused = state.video!.position;
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(
    (await kit.json<DirectorSnapshot>(kit.path("/state"), dm.cookie)).video!
      .position,
    paused,
  );
  await command("RESUME");
  const reconnect = sockets[2]!,
    old = reconnect.id;
  reconnect.io.engine.close();
  await wait(
    () =>
      reconnect.connected &&
      reconnect.id !== old &&
      latest.get(reconnect)?.video?.status === "PLAYING",
    "reconnect current position",
  );
  await command("STOP");
  assert.equal(state.mode, "BLANK");
  assert.equal((await kit.req(a.url, players[0]!.cookie)).status, 404);
  // Simulate elapsed wall-clock time, then restart the real process before recovery reads.
  await command("PLAY", { videoId: a.id, revision: a.revision });
  if (!kit.live) await kit.stop();
  await prisma.videoPlayback.update({
    where: { campaignId: c.id },
    data: { startedAt: new Date(Date.now() - 60000) },
  });
  if (!kit.live) await kit.start();
  state = await kit.json(kit.path("/state"), dm.cookie);
  assert.equal(state.mode, "BLANK");
  assert.equal(state.video, undefined);
  await command("PLAY", { videoId: a.id, revision: a.revision });
  assert.equal(
    (
      await kit.req(
        kit.path("/videos/" + a.id),
        dm.cookie,
        { revision: a.revision },
        "DELETE",
      )
    ).status,
    204,
  );
  state = await kit.json(kit.path("/state"), dm.cookie);
  assert.equal(state.mode, "BLANK");
  assert.equal((await kit.req(a.url, dm.cookie)).status, 404);
  assert.equal(
    (
      await kit.req(kit.path("/video"), dm.cookie, {
        action: "PLAY",
        version: state.version - 1,
        videoId: secret.id,
        revision: secret.revision,
      })
    ).status,
    409,
  );
  const updated = await kit.json<{ video: VideoAssetView }>(
    kit.path("/videos/" + secret.id),
    dm.cookie,
    { revision: secret.revision, name: "Renamed synthetic" },
    "PATCH",
  );
  assert.equal(updated.video.name, "Renamed synthetic");
  assert.equal(
    (
      await kit.req(
        kit.path("/videos/" + secret.id),
        dm.cookie,
        { revision: secret.revision, name: "stale" },
        "PATCH",
      )
    ).status,
    409,
  );
  assert.equal(
    JSON.stringify(
      await prisma.scene.findUnique({
        where: { id: scene.id },
        include: { tokens: true },
      }),
    ),
    before,
  );
  assert.ok(
    !packets.some(
      (p) =>
        p.includes(secret.id) ||
        p.includes("storageKey") ||
        p.includes("cloudinary.com") ||
        p.includes("Secret enemy"),
    ),
  );
  for (const method of ["PATCH", "DELETE"])
    assert.equal(
      (
        await kit.req(
          kit.path("/videos/" + secret.id),
          players[0]!.cookie,
          { revision: updated.video.revision },
          method,
        )
      ).status,
      403,
    );
  const material = (
    await kit.json<{ material: PresentationMaterialView }>(
      kit.path("/materials"),
      dm.cookie,
      { name: "Synthetic return portrait", category: "NPC" },
      "POST",
      201,
    )
  ).material;
  const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#314159" },
    })
      .png()
      .toBuffer(),
    imageForm = new FormData();
  imageForm.set("revision", "0");
  imageForm.set(
    "file",
    new Blob([new Uint8Array(png)], { type: "image/png" }),
    "synthetic.png",
  );
  const portrait = (
    await kit.json<{ material: PresentationMaterialView }>(
      kit.path("/materials/" + material.id + "/image"),
      dm.cookie,
      imageForm,
    )
  ).material;
  state = await kit.json<DirectorSnapshot>(
    kit.path("/state"),
    dm.cookie,
    {
      mode: "PORTRAIT",
      version: state.version,
      materialId: portrait.id,
      materialRevision: portrait.revision,
    },
    "PATCH",
  );
  await command("PLAY", {
    videoId: updated.video.id,
    revision: updated.video.revision,
  });
  assert.ok(
    !JSON.stringify(state).includes(portrait.id),
    "previous material stays server-only while video plays",
  );
  assert.equal(
    (await kit.req(portrait.image!.url, players[0]!.cookie)).status,
    404,
  );
  await command("STOP");
  assert.equal(state.mode, "PORTRAIT");
  assert.equal(state.material?.id, portrait.id);
  assert.equal(
    (await kit.req(portrait.image!.url, players[0]!.cookie)).status,
    200,
  );
  await command("PLAY", {
    videoId: updated.video.id,
    revision: updated.video.revision,
  });
  assert.equal(
    (
      await kit.req(
        kit.path("/materials/" + portrait.id),
        dm.cookie,
        { revision: portrait.revision },
        "DELETE",
      )
    ).status,
    204,
  );
  await command("RETURN");
  assert.equal(state.mode, "BLANK", "deleted return target falls back safely");
  console.log(
    `PASS Video API ${kit.live ? "HTTPS/WSS" : "local"}: actual H.264/AAC upload/inspection, private original/API/WS, exact Range/suffix/416, DM + 3, Play/Pause/Resume/Stop, 200/409 race, stale/revoked access, reconnect, elapsed restart recovery, metadata/delete, unchanged scene/tokens.`,
  );
} catch (e) {
  console.error("FAIL Video", e instanceof Error ? e.stack : "unknown");
  process.exitCode = 1;
} finally {
  sockets.forEach((s) => s.disconnect());
  await kit.cleanup();
}
