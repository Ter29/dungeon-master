// Real Chromium decoding/output graph; no Audio/play()/AudioContext mocks.
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { createServer, type ViteDevServer } from "vite";
import sharp from "sharp";
import type { AudioSnapshot, AudioAssetView } from "@dnd/shared";
import { prisma } from "../src/database/client.js";
import { destroyAudio } from "../src/audio/storage.js";
import { destroyImage } from "../src/scenes/storage.js";
import { wav } from "./audio-fixture.js";
const live = process.argv[2],
  base = live ? new URL(live).origin : "http://localhost:5174",
  apiBase = live ? base : "http://127.0.0.1:3114";
const users: string[] = [],
  contexts: BrowserContext[] = [];
let campaignId: string | undefined,
  child: ReturnType<typeof spawn> | undefined,
  vite: ViteDevServer | undefined,
  browser: Browser | undefined;
async function wait(
  fn: () => Promise<boolean>,
  label: string,
  timeout = 30000,
) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await new Promise((r) => setTimeout(r, 100));
  }
}
try {
  if (!live) {
    child = spawn(
      process.execPath,
      ["--env-file-if-exists=.env", "dist/index.js"],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          PORT: "3114",
          APP_ORIGIN: base,
        },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    await new Promise<void>((r, j) => {
      child!.stdout!.once("data", () => r());
      child!.once("error", j);
    });
    vite = await createServer({
      configFile: resolve("../client/vite.config.ts"),
      root: resolve("../client"),
      server: {
        host: "localhost",
        port: 5174,
        strictPort: true,
        proxy: { "/api": apiBase, "/socket.io": { target: apiBase, ws: true } },
      },
    });
    await vite.listen();
  }
  async function identity() {
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url");
    users.push(id);
    await prisma.user.create({
      data: {
        id,
        email: `${id}@example.invalid`,
        displayName: "Audio browser test",
        passwordHash: "test-only",
        sessions: {
          create: {
            tokenHash: createHash("sha256").update(token).digest("hex"),
            expiresAt: new Date(Date.now() + 1800000),
          },
        },
      },
    });
    return {
      id,
      token,
      cookie: `${live ? "__Host-dnd_session" : "dnd_session"}=${token}`,
    };
  }
  const dm = await identity(),
    players = [];
  for (let i = 0; i < 3; i++) players.push(await identity());
  const campaign = await prisma.campaign.create({
    data: {
      name: "Audio browser verification",
      members: {
        create: [
          { userId: dm.id, role: "DM" },
          ...players.map((p) => ({ userId: p.id, role: "PLAYER" as const })),
        ],
      },
    },
  });
  campaignId = campaign.id;
  async function request(
    path: string,
    data?: unknown,
    method = data === undefined ? "GET" : "POST",
    retries = 0,
  ) {
    const r = await fetch(apiBase + path, {
      method,
      headers: {
        Cookie: dm.cookie,
        Origin: base,
        ...(data === undefined || data instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(data === undefined
        ? {}
        : { body: data instanceof FormData ? data : JSON.stringify(data) }),
    });
    if (
      live &&
      r.status === 429 &&
      data instanceof FormData &&
      r.headers.get("retry-after")
    ) {
      assert.ok(retries < 1, "only one quota-window retry");
      await r.arrayBuffer();
      const seconds = Number(r.headers.get("retry-after"));
      assert.ok(
        Number.isFinite(seconds) && seconds >= 0 && seconds <= 900,
        "bounded server retry-after",
      );
      console.log(
        `Production upload quota reached; respecting Retry-After (${seconds}s) without changing limits.`,
      );
      const until = Date.now() + (seconds + 1) * 1000;
      while (Date.now() < until)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(30000, until - Date.now())),
        );
      return request(path, data, method, retries + 1);
    }
    assert.ok(r.ok, `${method} ${path}: ${await r.clone().text()}`);
    return r.status === 204 ? null : r.json();
  }
  const path = `/api/campaigns/${campaign.id}/audio`;
  const assets: AudioAssetView[] = [];
  for (const [name, category, bytes, mime] of [
    [
      "Музика таверни · тест",
      "MUSIC",
      await readFile("scripts/fixtures/audio/tone.mp3"),
      "audio/mpeg",
    ],
    ["Напружений трек · тест", "MUSIC", wav(10, 440), "audio/wav"],
    [
      "Дощ · тест",
      "AMBIENCE",
      await readFile("scripts/fixtures/audio/tone.ogg"),
      "audio/ogg",
    ],
    ["Грім · тест", "SFX", wav(2, 70), "audio/wav"],
  ] as const) {
    const f = new FormData();
    f.set("name", name);
    f.set("category", category);
    f.set("file", new Blob([new Uint8Array(bytes)], { type: mime }), "sound");
    assets.push((await request(path + "/assets", f)).asset);
  }
  let state: AudioSnapshot = await request(path + "/state");
  async function command(
    key: string,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    state = await request(path + "/channels/" + key, {
      version: state.version,
      action,
      ...extra,
    });
  }
  await command("MUSIC", "PLAY", {
    assetId: assets[0]!.id,
    assetRevision: 0,
    fadeMs: 0,
    loop: true,
  });
  browser = await chromium.launch({
    channel: process.env.AUDIO_BROWSER_CHANNEL || "chrome",
    headless: true,
    ignoreDefaultArgs: ["--mute-audio"],
    args: [
      "--autoplay-policy=user-gesture-required",
      "--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies",
    ],
  });
  async function open(user: typeof dm) {
    const context = await browser!.newContext({
      viewport: { width: 1360, height: 950 },
    });
    contexts.push(context);
    await context.addCookies([
      {
        name: live ? "__Host-dnd_session" : "dnd_session",
        value: user.token,
        url: base,
        httpOnly: true,
        sameSite: "Lax",
        secure: Boolean(live),
      },
    ]);
    await context.addInitScript(() => {
      const proof = {
        elements: [] as HTMLAudioElement[],
        analysers: [] as AnalyserNode[],
        contexts: [] as AudioContext[],
      };
      Object.assign(window, { __audioProof: proof });
      const NativeContext = window.AudioContext;
      window.AudioContext = class extends NativeContext {
        constructor(...args: ConstructorParameters<typeof AudioContext>) {
          super(...args);
          proof.contexts.push(this);
          const create = this.createGain.bind(this);
          this.createGain = () => {
            const node = create(),
              connect = node.connect.bind(node);
            node.connect = ((destination: AudioNode, ...rest: unknown[]) => {
              if (destination === this.destination) {
                const analyser = this.createAnalyser();
                proof.analysers.push(analyser);
                connect(analyser);
                return analyser.connect(destination);
              }
              return (connect as Function)(destination, ...rest);
            }) as typeof node.connect;
            return node;
          };
        }
      };
      const NativeAudio = window.Audio;
      window.Audio = new Proxy(NativeAudio, {
        construct(target, args) {
          const a = Reflect.construct(target, args);
          proof.elements.push(a);
          return a;
        },
      });
    });
    const page = await context.newPage();
    await page.goto(`${base}/campaigns/${campaign.id}`);
    await page
      .getByRole("button", { name: "Увімкнути звук", exact: true })
      .waitFor();
    return page;
  }
  const pages: Page[] = [];
  for (const u of [dm, ...players]) pages.push(await open(u));
  const proof = (page: Page) =>
    page.evaluate(() => {
      const p = (
        window as unknown as {
          __audioProof: {
            elements: HTMLAudioElement[];
            analysers: AnalyserNode[];
            contexts: AudioContext[];
          };
        }
      ).__audioProof;
      return {
        contexts: p.contexts.map((c) => c.state),
        playing: p.elements.filter(
          (a) => !a.paused && !a.ended && a.readyState >= 2,
        ).length,
        times: p.elements.filter((a) => !a.paused).map((a) => a.currentTime),
        rms: p.analysers.map((a) => {
          const b = new Float32Array(a.fftSize);
          a.getFloatTimeDomainData(b);
          return Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
        }),
      };
    });
  // Playwright evaluate supplies a user gesture. Explicitly omit it for the policy probe.
  const cdp = await contexts[1]!.newCDPSession(pages[1]!);
  const probeUrl = "data:audio/wav;base64," + wav(0.2).toString("base64");
  const blockedResult = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{const a=new Audio(${JSON.stringify(probeUrl)});try{await a.play();a.pause();return 'unexpected-play';}catch(e){return e.name;}})()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  });
  const blocked = blockedResult.result.value;
  await cdp.detach();
  assert.ok(["NotAllowedError", "unexpected-play"].includes(blocked));
  console.log(
    blocked === "NotAllowedError"
      ? "PASS: browser rejected unactivated playback with NotAllowedError."
      : "NOTE: this Chrome permits the isolated autoplay probe; application still requires explicit activation and creates no output context beforehand.",
  );
  assert.equal((await proof(pages[1]!)).playing, 0);
  assert.equal(
    (await proof(pages[1]!)).contexts.length,
    0,
    "no pretend playback before activation",
  );
  const failedAudioPattern = `**${assets[0]!.url}*`;
  await pages[1]!.route(failedAudioPattern, (route) => route.abort("failed"));
  for (const page of pages)
    await page
      .getByRole("button", { name: "Увімкнути звук", exact: true })
      .click();
  await wait(
    async () =>
      /недоступ|не почалося/.test(
        await pages[1]!.locator(".audio-personal [role=status]").innerText(),
      ),
    "actual failed play reported",
  );
  assert.equal(
    (await proof(pages[1]!)).playing,
    0,
    "failed play never claimed as output",
  );
  await pages[1]!.unroute(failedAudioPattern);
  await pages[1]!
    .getByRole("button", { name: "Увімкнути звук", exact: true })
    .click();
  await wait(async () => {
    const p = await proof(pages[1]!);
    return p.playing === 1 && p.rms.some((n) => n > 0.001);
  }, "real decoded music after click");
  await command("AMBIENCE", "PLAY", {
    assetId: assets[2]!.id,
    assetRevision: 0,
    fadeMs: 0,
    loop: true,
  });
  await wait(async () => {
    for (const page of pages)
      if ((await proof(page)).playing !== 2) return false;
    return true;
  }, "four actual Music+Ambience players");
  const first = await proof(pages[1]!);
  await wait(
    async () =>
      (await proof(pages[1]!)).times.some(
        (t, i) => Math.abs(t - (first.times[i] ?? 0)) > 0.2,
      ),
    "media timeline advances",
  );
  await request(path + "/cues", { assetId: assets[3]!.id, assetRevision: 0 });
  await wait(
    async () => (await proof(pages[1]!)).playing === 3,
    "SFX overlays both channels",
  );
  for (const page of pages)
    await page.locator(".audio-personal summary").click();
  const versionBefore = state.version;
  await pages[1]!
    .getByRole("checkbox", { name: "Без звуку", exact: true })
    .check();
  await wait(
    async () => (await proof(pages[1]!)).rms.every((n) => n < 0.00001),
    "muted output is zero",
  );
  assert.ok(
    (await proof(pages[2]!)).rms.some((n) => n > 0.001),
    "another Player remains audible",
  );
  assert.equal((await request(path + "/state")).version, versionBefore);
  await pages[1]!
    .getByRole("checkbox", { name: "Без звуку", exact: true })
    .uncheck();
  const musicSlider = pages[1]!.getByRole("slider", {
    name: "music volume",
    exact: true,
  });
  await musicSlider.focus();
  await musicSlider.press("Home");
  for (let i = 0; i < 20; i++) await musicSlider.press("ArrowRight");
  assert.equal(await musicSlider.inputValue(), "0.2");
  assert.equal(
    await pages[2]!
      .getByRole("slider", { name: "music volume", exact: true })
      .inputValue(),
    "0.7",
  );
  await command("MUSIC", "PAUSE");
  await wait(
    async () => (await proof(pages[1]!)).playing === 1,
    "music pause leaves ambience",
  );
  await command("MUSIC", "RESUME", { fadeMs: 0 });
  await wait(
    async () => (await proof(pages[1]!)).playing === 2,
    "resume real output",
  );
  await command("MUSIC", "PLAY", {
    assetId: assets[1]!.id,
    assetRevision: 0,
    fadeMs: 2000,
    loop: true,
  });
  await wait(
    async () => (await proof(pages[1]!)).playing === 3,
    "real crossfade outgoing+incoming+ambience",
  );
  await wait(
    async () => (await proof(pages[1]!)).playing === 2,
    "outgoing voice released",
  );
  const material = await prisma.presentationMaterial.create({
    data: { campaignId: campaign.id, name: "Архіваріус", category: "NPC" },
  });
  const image = await sharp({
    create: { width: 400, height: 500, channels: 3, background: "#846146" },
  })
    .png()
    .toBuffer();
  const f = new FormData();
  f.set("revision", "0");
  f.set(
    "file",
    new Blob([new Uint8Array(image)], { type: "image/png" }),
    "portrait.png",
  );
  const updated = (
    await request(
      `/api/campaigns/${campaign.id}/director/materials/${material.id}/image`,
      f,
    )
  ).material;
  await pages[0]!
    .getByRole("button", { name: "Жива сесія", exact: true })
    .click();
  await pages[1]!
    .getByRole("button", { name: "Занурення", exact: true })
    .click();
  assert.equal(
    (await proof(pages[1]!)).playing,
    2,
    "audio survives immersive layout",
  );
  await pages[1]!.keyboard.press("Escape");
  for (const mode of ["PORTRAIT", "ILLUSTRATION", "BLANK", "TABLE"]) {
    const s = await request(`/api/campaigns/${campaign.id}/director/state`);
    await request(
      `/api/campaigns/${campaign.id}/director/state`,
      {
        version: s.version,
        mode,
        ...(["PORTRAIT", "ILLUSTRATION"].includes(mode)
          ? { materialId: material.id, materialRevision: updated.revision }
          : {}),
      },
      "PATCH",
    );
    if (mode === "TABLE")
      await pages[1]!
        .locator(".director-fullscreen")
        .waitFor({ state: "detached" });
    else
      await pages[1]!.locator(`[data-presentation-mode="${mode}"]`).waitFor();
    assert.equal((await proof(pages[1]!)).playing, 2, `audio survives ${mode}`);
  }
  await contexts[1]!.setOffline(true);
  await wait(
    async () => (await proof(pages[1]!)).playing === 0,
    "disconnect pauses actual output",
    65000,
  );
  await contexts[1]!.setOffline(false);
  await wait(
    async () => (await proof(pages[1]!)).playing === 2,
    "reconnect resumes both channels",
  );
  await pages[1]!.reload();
  await pages[1]!
    .getByRole("button", { name: "Увімкнути звук", exact: true })
    .waitFor();
  assert.equal((await proof(pages[1]!)).playing, 0);
  await pages[1]!
    .getByRole("button", { name: "Увімкнути звук", exact: true })
    .click();
  await wait(
    async () => (await proof(pages[1]!)).playing === 2,
    "reload activation restores current tracks",
  );
  await pages[1]!.locator(".audio-personal summary").click();
  assert.equal(
    await pages[1]!
      .getByRole("slider", { name: "music volume", exact: true })
      .inputValue(),
    "0.2",
  );
  await command("MUSIC", "FADE_OUT", { fadeMs: 700 });
  await wait(
    async () => (await proof(pages[1]!)).playing === 1,
    "fade out releases music playback",
  );
  await command("AMBIENCE", "STOP");
  await wait(
    async () => (await proof(pages[1]!)).playing === 0,
    "stop all output",
  );
  await wait(
    async () =>
      /Тиша/.test(
        await pages[1]!.locator(".audio-personal [role=status]").innerText(),
      ),
    "truthful stopped indicator",
  );
  await pages[0]!
    .getByRole("navigation", { name: "Розділи кампанії" })
    .getByRole("button", { name: "Audio", exact: true })
    .click();
  await mkdir("../../.backups", { recursive: true });
  await pages[0]!.screenshot({
    path: resolve("../../.backups/audio-director-browser.png"),
    fullPage: false,
  });
  console.log(
    `PASS Browser Audio: ${live ? "HTTPS/WSS" : "local"} real Chrome decode, nonzero output waveform, advancing timeline, activation, DM + 3 Players, simultaneous MP3/OGG/SFX, independent mute/volumes, pause/resume, crossfade/fade out, all Director modes, reconnect/reload, settings persistence. No physical speaker/hearing claim.`,
  );
} catch (e) {
  console.error(
    "FAIL Browser Audio:",
    e instanceof Error ? e.stack : "unknown",
  );
  process.exitCode = 1;
} finally {
  for (const c of contexts) await c.close();
  await browser?.close();
  await vite?.close();
  child?.kill();
  try {
    if (campaignId) {
      for (const a of await prisma.audioAsset.findMany({
        where: { campaignId },
      }))
        await destroyAudio(a.storageKey);
      for (const a of await prisma.mediaFile.findMany({
        where: { campaignId },
      }))
        await destroyImage(a.storageKey);
      await prisma.campaign.updateMany({
        where: { id: campaignId },
        data: {
          presentationMaterialId: null,
          presentationMode: "TABLE",
          activeLocationId: null,
        },
      });
      await prisma.campaign.deleteMany({ where: { id: campaignId } });
    }
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  } finally {
    await prisma.$disconnect();
  }
}
