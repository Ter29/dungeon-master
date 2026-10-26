import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { io, type Socket } from "socket.io-client";
import type {
  ClientEvents,
  ServerEvents,
  AudioSnapshot,
  AudioAssetView,
  AudioCueView,
} from "@dnd/shared";
import { audioPosition } from "@dnd/shared";
import { prisma } from "../src/database/client.js";
import {
  destroyAudio,
  audioDeliveryUrl,
  inspectAudio,
} from "../src/audio/storage.js";
import { wav } from "./audio-fixture.js";
const live = process.argv[2],
  base = live ? new URL(live).origin : "http://127.0.0.1:3113",
  origin = live ? base : "http://localhost:5173";
const users: string[] = [],
  campaigns: string[] = [],
  sockets: Socket<ServerEvents, ClientEvents>[] = [];
const latest = new Map<Socket, AudioSnapshot>(),
  cues = new Map<Socket, AudioCueView[]>(),
  packets: string[] = [];
let child: ReturnType<typeof spawn> | undefined;
async function wait(fn: () => boolean, label: string) {
  const end = Date.now() + 30000;
  while (!fn()) {
    if (Date.now() > end) throw Error(label);
    await new Promise((r) => setTimeout(r, 30));
  }
}
async function start() {
  if (live) return;
  child = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", "dist/index.js"],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: "3113",
        APP_ORIGIN: origin,
      },
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  let ready = false;
  child.stdout!.once("data", () => (ready = true));
  await wait(() => ready, "server start");
}
async function identity() {
  const id = randomUUID(),
    token = randomBytes(32).toString("base64url");
  users.push(id);
  await prisma.user.create({
    data: {
      id,
      email: `${id}@example.invalid`,
      displayName: "Audio test",
      passwordHash: "test-only",
      sessions: {
        create: {
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now() + 1200000),
        },
      },
    },
  });
  return {
    id,
    cookie: `${live ? "__Host-dnd_session" : "dnd_session"}=${token}`,
  };
}
async function req(
  path: string,
  cookie?: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
  extra: Record<string, string> = {},
) {
  return fetch(base + path, {
    method,
    signal: AbortSignal.timeout(60000),
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data === undefined || data instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...extra,
    },
    ...(data === undefined
      ? {}
      : { body: data instanceof FormData ? data : JSON.stringify(data) }),
  });
}
async function json<T>(
  path: string,
  cookie: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
  status = 200,
): Promise<T> {
  const r = await req(path, cookie, data, method);
  assert.equal(
    r.status,
    status,
    `${method} ${path}: ${await r.clone().text()}`,
  );
  return r.json();
}
function connect(id: string, cookie: string, player = false) {
  const s: Socket<ServerEvents, ClientEvents> = io(base, {
    auth: { campaignId: id },
    transports: ["websocket"],
    extraHeaders: { Origin: origin, Cookie: cookie },
    reconnectionDelay: 100,
  });
  s.on("audio:snapshot", (v) => latest.set(s, v));
  s.on("audio:cue", (v) => cues.set(s, [...(cues.get(s) ?? []), v]));
  if (player) s.onAny((...v) => packets.push(JSON.stringify(v)));
  sockets.push(s);
  return s;
}
function form(
  name: string,
  category: string,
  bytes: Buffer,
  mime = "audio/wav",
) {
  const f = new FormData();
  f.set("name", name);
  f.set("category", category);
  f.set(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mime }),
    `tone.${mime === "audio/mpeg" ? "mp3" : mime === "audio/ogg" ? "ogg" : "wav"}`,
  );
  return f;
}
try {
  const dm = await identity(),
    players = [];
  for (let i = 0; i < 3; i++) players.push(await identity());
  const outsider = await identity();
  const c = await prisma.campaign.create({
    data: {
      name: "Audio integration",
      members: {
        create: [
          { userId: dm.id, role: "DM" },
          ...players.map((p) => ({ userId: p.id, role: "PLAYER" as const })),
        ],
      },
    },
  });
  campaigns.push(c.id);
  const other = await prisma.campaign.create({
    data: {
      name: "Audio scope",
      members: { create: { userId: dm.id, role: "DM" } },
    },
  });
  campaigns.push(other.id);
  const scene = await prisma.scene.create({
    data: {
      campaignId: c.id,
      name: "Untouched audio scene",
      fogMask: "0".repeat(4096),
      gridSize: 42,
    },
  });
  await prisma.campaign.update({
    where: { id: c.id },
    data: { activeLocationId: scene.id },
  });
  const token = await prisma.token.create({
    data: {
      sceneId: scene.id,
      name: "Hidden audio enemy",
      hidden: true,
      kind: "ENEMY",
      x: 40,
      y: 40,
      size: 20,
    },
  });
  const combat = await prisma.combatEncounter.create({
    data: {
      campaignId: c.id,
      sceneId: scene.id,
      status: "ACTIVE",
      round: 4,
      participants: {
        create: { tokenId: token.id, position: 0, joinOrder: 0 },
      },
    },
  });
  async function gameplay() {
    const x = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    const {
      audioVersion: _,
      presentationMode: __,
      presentationVersion: ___,
      presentationMaterialId: ____,
      updatedAt: _____,
      ...rest
    } = x;
    return JSON.stringify({
      campaign: rest,
      scene: await prisma.scene.findUnique({ where: { id: scene.id } }),
      token: await prisma.token.findUnique({ where: { id: token.id } }),
      combat: await prisma.combatEncounter.findUnique({
        where: { id: combat.id },
        include: { participants: true },
      }),
    });
  }
  const before = await gameplay();
  await start();
  const path = `/api/campaigns/${c.id}/audio`;
  const clients = [
    connect(c.id, dm.cookie),
    ...players.map((p) => connect(c.id, p.cookie, true)),
  ];
  await wait(
    () => clients.every((s) => latest.has(s)),
    "initial audio snapshots",
  );
  let state = latest.get(clients[0]!)!;
  assert.equal((await req(path + "/state")).status, 401);
  assert.equal((await req(path + "/state", outsider.cookie)).status, 404);
  assert.equal((await req(path + "/assets", players[0]!.cookie)).status, 403);
  assert.equal(
    (
      await req(
        path + "/assets",
        players[0]!.cookie,
        form("bad", "MUSIC", wav()),
      )
    ).status,
    403,
  );
  const mp3 = await readFile("scripts/fixtures/audio/tone.mp3"),
    ogg = await readFile("scripts/fixtures/audio/tone.ogg");
  assert.equal((await inspectAudio(mp3, "MUSIC")).format, "mp3");
  assert.equal((await inspectAudio(ogg, "AMBIENCE")).format, "ogg");
  const music = (
    await json<{ asset: AudioAssetView }>(
      path + "/assets",
      dm.cookie,
      form("Synthetic music", "MUSIC", mp3, "audio/mpeg"),
      "POST",
      201,
    )
  ).asset;
  const second = (
    await json<{ asset: AudioAssetView }>(
      path + "/assets",
      dm.cookie,
      form("Second track", "MUSIC", wav(5, 440)),
      "POST",
      201,
    )
  ).asset;
  const ambience = (
    await json<{ asset: AudioAssetView }>(
      path + "/assets",
      dm.cookie,
      form("Synthetic ambience", "AMBIENCE", ogg, "audio/ogg"),
      "POST",
      201,
    )
  ).asset;
  let effect = (
    await json<{ asset: AudioAssetView }>(
      path + "/assets",
      dm.cookie,
      form("Synthetic thunder", "SFX", wav(1, 60)),
      "POST",
      201,
    )
  ).asset;
  const secret = (
    await json<{ asset: AudioAssetView }>(
      path + "/assets",
      dm.cookie,
      form("Private unreleased audio 61893", "MUSIC", wav()),
      "POST",
      201,
    )
  ).asset;
  assert.equal(
    (
      await req(
        path + "/assets",
        dm.cookie,
        form("corrupt", "MUSIC", Buffer.from("not real audio")),
      )
    ).status,
    415,
  );
  assert.equal(
    (await req(path + "/assets", dm.cookie, form("too long", "SFX", wav(31))))
      .status,
    413,
  );
  assert.equal(
    (
      await req(
        path + "/assets",
        dm.cookie,
        form("fake MIME", "MUSIC", wav(), "image/png"),
      )
    ).status,
    415,
  );
  assert.equal((await req(secret.url, players[0]!.cookie)).status, 404);
  assert.equal((await req(secret.url, outsider.cookie)).status, 404);
  assert.equal((await req(secret.url, dm.cookie)).status, 200);
  const stored = await prisma.audioAsset.findUniqueOrThrow({
    where: { id: secret.id },
  });
  const unsigned = audioDeliveryUrl(stored.storageKey, stored.format).replace(
    /\/s--[^/]+--\//,
    "/",
  );
  const denied = await fetch(unsigned);
  assert.ok(
    [401, 403, 404].includes(denied.status),
    "unsigned Cloudinary access denied",
  );
  async function command(
    k: string,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    state = await json<AudioSnapshot>(path + "/channels/" + k, dm.cookie, {
      version: state.version,
      action,
      ...extra,
    });
    await wait(
      () =>
        clients
          .filter((s) => s.connected)
          .every((s) => latest.get(s)?.version === state.version),
      "audio broadcast",
    );
  }
  assert.equal(
    (
      await req(path + "/channels/MUSIC", players[0]!.cookie, {
        version: state.version,
        action: "STOP",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await req(
        path + "/channels/MUSIC",
        dm.cookie,
        { version: state.version, action: "STOP" },
        "POST",
        { Origin: "https://wrong.invalid" },
      )
    ).status,
    403,
  );
  await command("MUSIC", "PLAY", {
    assetId: music.id,
    assetRevision: music.revision,
    fadeMs: 500,
    loop: true,
  });
  assert.equal(state.channels[0]!.status, "PLAYING");
  await command("AMBIENCE", "PLAY", {
    assetId: ambience.id,
    assetRevision: ambience.revision,
    fadeMs: 0,
  });
  assert.equal(state.channels.filter((c) => c.status === "PLAYING").length, 2);
  const range = await req(music.url, players[0]!.cookie, undefined, "GET", {
    Range: "bytes=0-31",
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 32);
  assert.equal(range.headers.get("cache-control"), "private, no-store");
  assert.equal(
    (
      await req(music.url, players[0]!.cookie, undefined, "GET", {
        Range: "bytes=0-1,3-4",
      })
    ).status,
    416,
  );
  await command("MUSIC", "PAUSE");
  const paused = state.channels[0]!.voice!;
  assert.equal(paused.startedAt, null);
  const p = audioPosition(paused, Date.now() + 100000);
  assert.equal(p, paused.position);
  await command("MUSIC", "RESUME", { fadeMs: 0 });
  await command("MUSIC", "PLAY", {
    assetId: second.id,
    assetRevision: second.revision,
    fadeMs: 5000,
  });
  assert.equal(state.channels[0]!.outgoing?.asset.id, music.id);
  assert.equal(state.channels[0]!.voice?.asset.id, second.id);
  await command("AMBIENCE", "SETTINGS", { volume: 0.35, loop: false });
  assert.equal(state.channels[1]!.volume, 0.35);
  await command("MUSIC", "FADE_OUT", { fadeMs: 0 });
  assert.equal(state.channels[0]!.status, "STOPPED");
  assert.equal((await req(second.url, players[0]!.cookie)).status, 404);
  await command("MUSIC", "PLAY", {
    assetId: music.id,
    assetRevision: music.revision,
    fadeMs: 0,
    loop: true,
  });
  await command("MUSIC", "FADE_IN", { fadeMs: 500 });
  const v = state.version,
    race = await Promise.all([
      req(path + "/channels/MUSIC", dm.cookie, {
        version: v,
        action: "SETTINGS",
        volume: 0.4,
      }),
      req(path + "/channels/MUSIC", dm.cookie, {
        version: v,
        action: "SETTINGS",
        volume: 0.6,
      }),
    ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  state = await json<AudioSnapshot>(path + "/state", dm.cookie);
  assert.equal(
    (
      await req(path + "/channels/MUSIC", dm.cookie, {
        version: state.version,
        action: "PLAY",
        assetId: secret.id,
        assetRevision: 99,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await req(`/api/campaigns/${other.id}/audio/channels/MUSIC`, dm.cookie, {
        version: 0,
        action: "PLAY",
        assetId: music.id,
        assetRevision: 0,
      })
    ).status,
    404,
  );
  effect = (
    await json<{ asset: AudioAssetView }>(
      path + "/assets/" + effect.id,
      dm.cookie,
      {
        revision: effect.revision,
        name: "Renamed thunder",
        description: "Private preview",
      },
      "PATCH",
    )
  ).asset;
  state = await json<AudioSnapshot>(path + "/state", dm.cookie);
  assert.equal(
    (
      await req(
        path + "/assets/" + effect.id,
        dm.cookie,
        { revision: 0, name: "stale" },
        "PATCH",
      )
    ).status,
    409,
  );
  assert.equal((await req(effect.url, players[0]!.cookie)).status, 404);
  assert.equal(
    (
      await req(path + "/cues", players[0]!.cookie, {
        assetId: effect.id,
        assetRevision: effect.revision,
      })
    ).status,
    403,
  );
  const cue = await json<{ id: string }>(
    path + "/cues",
    dm.cookie,
    { assetId: effect.id, assetRevision: effect.revision },
    "POST",
    201,
  );
  await wait(
    () =>
      clients.every((s) => (cues.get(s) ?? []).some((c) => c.id === cue.id)),
    "SFX all four clients",
  );
  assert.equal(
    (await req(`${effect.url}?cue=${cue.id}`, players[0]!.cookie)).status,
    200,
  );
  assert.equal(
    (await req(`${effect.url}?cue=${randomUUID()}`, players[0]!.cookie)).status,
    404,
  );
  const recovering = clients[3]!,
    cueCount = cues.get(recovering)!.length,
    oldId = recovering.id;
  recovering.io.engine.close();
  await wait(
    () => recovering.connected && recovering.id !== oldId,
    "audio reconnect",
  );
  await wait(
    () => latest.get(recovering)?.version === state.version,
    "state resume",
  );
  assert.equal(cues.get(recovering)!.length, cueCount, "no cue replay");
  for (let i = 0; i < 11; i++)
    await json(
      path + "/cues",
      dm.cookie,
      { assetId: effect.id, assetRevision: effect.revision },
      "POST",
      201,
    );
  assert.equal(
    (
      await req(path + "/cues", dm.cookie, {
        assetId: effect.id,
        assetRevision: effect.revision,
      })
    ).status,
    429,
  );
  await prisma.audioCue.updateMany({
    where: { campaignId: c.id },
    data: { expiresAt: new Date(0) },
  });
  assert.equal(
    (await req(`${effect.url}?cue=${cue.id}`, players[0]!.cookie)).status,
    404,
  );
  for (const mode of ["BLANK", "TABLE", "BLANK", "TABLE"]) {
    const director = await json<{ version: number }>(
      `/api/campaigns/${c.id}/director/state`,
      dm.cookie,
    );
    await json(
      `/api/campaigns/${c.id}/director/state`,
      dm.cookie,
      { mode, version: director.version },
      "PATCH",
    );
    assert.equal(
      (await json<AudioSnapshot>(path + "/state", dm.cookie)).version,
      state.version,
    );
  }
  assert.equal(await gameplay(), before);
  assert.ok(
    !packets.some(
      (p) =>
        p.includes(secret.id) ||
        p.includes(secret.name) ||
        p.includes(token.name) ||
        p.includes("storageKey") ||
        p.includes("cloudinary.com"),
    ),
  );
  if (!live) {
    sockets.forEach((s) => s.disconnect());
    const stopped = new Promise((r) => child!.once("exit", r));
    child!.kill();
    await stopped;
    await start();
    const fresh = connect(c.id, players[0]!.cookie, true);
    await wait(
      () => latest.get(fresh)?.version === state.version,
      "restart playback",
    );
    assert.equal(latest.get(fresh)!.channels[0]!.voice?.asset.id, music.id);
    assert.equal((cues.get(fresh) ?? []).length, 0);
  }
  const oldVersion = state.version;
  assert.equal(
    (
      await req(
        path + "/assets/" + music.id,
        dm.cookie,
        { revision: music.revision },
        "DELETE",
      )
    ).status,
    204,
  );
  state = await json<AudioSnapshot>(path + "/state", dm.cookie);
  assert.equal(state.version, oldVersion + 1);
  assert.equal(state.channels[0]!.status, "STOPPED");
  assert.equal((await req(music.url, players[0]!.cookie)).status, 404);
  assert.equal(await gameplay(), before);
  console.log(
    `PASS Audio: ${live ? "public HTTPS/WSS" : "local Neon/Cloudinary"} DM + 3 Players; MP3/OGG/WAV upload, actual format/duration, protected previews/ranges/unsigned denial, two channels, play/pause/resume/stop/loop/fades/crossfade, stale versions/concurrency, SFX scope/spam/no replay, reconnect${live ? "" : "/actual process restart"}, Director/gameplay isolation. Browser output must be verified separately.`,
  );
} catch (e) {
  console.error("FAIL Audio:", e instanceof Error ? e.stack : "unknown");
  process.exitCode = 1;
} finally {
  sockets.forEach((s) => s.disconnect());
  child?.kill();
  try {
    for (const a of await prisma.audioAsset.findMany({
      where: { campaignId: { in: campaigns } },
    }))
      await destroyAudio(a.storageKey);
    await prisma.campaign.updateMany({
      where: { id: { in: campaigns } },
      data: { activeLocationId: null },
    });
    await prisma.campaign.deleteMany({ where: { id: { in: campaigns } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    console.log("Audio fixtures/provider assets removed.");
  } finally {
    await prisma.$disconnect();
  }
}
