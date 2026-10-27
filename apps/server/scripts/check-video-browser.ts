// Real Chrome H.264 frames + AAC WebAudio waveform. No play/decoder mocks.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { createServer, type ViteDevServer } from "vite";
import type {
  DirectorSnapshot,
  AudioSnapshot,
  AudioAssetView,
} from "@dnd/shared";
import { prisma } from "../src/database/client.js";
import { VideoTestKit, wait } from "./video-test-kit.js";
const kit = new VideoTestKit(process.argv[2], true),
  contexts: BrowserContext[] = [];
let browser: Browser | undefined, vite: ViteDevServer | undefined;
try {
  const dm = await kit.identity(),
    players = [];
  for (let i = 0; i < 3; i++) players.push(await kit.identity());
  const c = await prisma.campaign.create({
    data: {
      name: "Synthetic cinematic QA",
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
      name: "Preserved table",
      fogMask: "f".repeat(4096),
      gridVisible: true,
      tokens: { create: { name: "Hero", hidden: false, x: 300, y: 200 } },
    },
    include: { tokens: true },
  });
  await prisma.campaign.update({
    where: { id: c.id },
    data: { activeLocationId: scene.id },
  });
  const gameplay = JSON.stringify(scene);
  await kit.start();
  if (!kit.live) {
    vite = await createServer({
      configFile: resolve("../client/vite.config.ts"),
      root: resolve("../client"),
      server: {
        host: "localhost",
        port: 5178,
        strictPort: true,
        proxy: {
          "/api": kit.base,
          "/socket.io": { target: kit.base, ws: true },
        },
      },
    });
    await vite.listen();
  }
  const asset = (await kit.upload(dm.cookie)).video;
  const assets: AudioAssetView[] = [];
  for (const [file, category, mime] of [
    ["tone.mp3", "MUSIC", "audio/mpeg"],
    ["tone.ogg", "AMBIENCE", "audio/ogg"],
  ]) {
    const form = new FormData();
    form.set("name", `Synthetic ${category}`);
    form.set("category", category!);
    form.set(
      "file",
      new Blob(
        [new Uint8Array(await readFile("scripts/fixtures/audio/" + file))],
        { type: mime },
      ),
      file!,
    );
    assets.push(
      (
        await kit.json<{ asset: AudioAssetView }>(
          `/api/campaigns/${c.id}/audio/assets`,
          dm.cookie,
          form,
          "POST",
          201,
        )
      ).asset,
    );
  }
  for (const [i, key] of ["MUSIC", "AMBIENCE"].entries()) {
    const s = await kit.json<AudioSnapshot>(
      `/api/campaigns/${c.id}/audio/state`,
      dm.cookie,
    );
    await kit.json(`/api/campaigns/${c.id}/audio/channels/${key}`, dm.cookie, {
      version: s.version,
      action: "PLAY",
      assetId: assets[i]!.id,
      assetRevision: 0,
      fadeMs: 0,
      loop: true,
    });
  }
  const audioBefore = JSON.stringify(
    await prisma.audioChannel.findMany({
      where: { campaignId: c.id },
      orderBy: { key: "asc" },
    }),
  );
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    ignoreDefaultArgs: ["--mute-audio"],
    args: [
      "--autoplay-policy=document-user-activation-required",
      "--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies",
    ],
  });
  async function open(u: typeof dm) {
    const context = await browser!.newContext({
      viewport: { width: 1366, height: 768 },
    });
    contexts.push(context);
    await context.addCookies([
      {
        name: kit.live ? "__Host-dnd_session" : "dnd_session",
        value: u.token,
        url: kit.origin,
        httpOnly: true,
        sameSite: "Lax",
        secure: Boolean(kit.live),
      },
    ]);
    await context.addInitScript(() => {
      // esbuild function-name helper for serialized test observers only.
      eval("globalThis.__name=(fn)=>fn;");
      const proof = {
        contexts: [] as AudioContext[],
        sources: [] as {
          element: HTMLMediaElement;
          gain: GainNode;
          analyser: AnalyserNode;
        }[],
        outputs: [] as AnalyserNode[],
      };
      Object.assign(window, { __videoProof: proof });
      const Native = window.AudioContext;
      window.AudioContext = class extends Native {
        constructor(...args: ConstructorParameters<typeof AudioContext>) {
          super(...args);
          proof.contexts.push(this);
          const source = this.createMediaElementSource.bind(this),
            gain = this.createGain.bind(this);
          this.createMediaElementSource = (element) => {
            const node = source(element),
              connect = node.connect.bind(node);
            node.connect = ((dest: AudioNode) => {
              const analyser = this.createAnalyser();
              connect(analyser);
              analyser.connect(dest);
              proof.sources.push({ element, gain: dest as GainNode, analyser });
              return dest;
            }) as typeof node.connect;
            return node;
          };
          this.createGain = () => {
            const node = gain(),
              connect = node.connect.bind(node);
            node.connect = ((dest: AudioNode) => {
              if (dest === this.destination) {
                const analyser = this.createAnalyser();
                proof.outputs.push(analyser);
                connect(analyser);
                return analyser.connect(dest);
              }
              return connect(dest);
            }) as typeof node.connect;
            return node;
          };
        }
      };
    });
    const page = await context.newPage();
    await page.goto(`${kit.origin}/campaigns/${c.id}`);
    await page
      .getByRole("button", { name: "Увімкнути звук", exact: true })
      .waitFor();
    return page;
  }
  const pages: Page[] = [];
  for (const u of [dm, ...players]) pages.push(await open(u));
  async function proof(p: Page) {
    return p.evaluate(() => {
      const q = (
        window as unknown as {
          __videoProof: {
            contexts: AudioContext[];
            sources: {
              element: HTMLMediaElement;
              gain: GainNode;
              analyser: AnalyserNode;
            }[];
            outputs: AnalyserNode[];
          };
        }
      ).__videoProof;
      const rms = (a: AnalyserNode) => {
        const b = new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(b);
        return Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
      };
      const v = document.querySelector(
        ".video-cinema>video",
      ) as HTMLVideoElement | null;
      return {
        contexts: q.contexts.length,
        sources: q.sources.map((s) => ({
          video: s.element instanceof HTMLVideoElement,
          playing: !s.element.paused && !s.element.ended,
          time: s.element.currentTime,
          gain: s.gain.gain.value,
          rms: rms(s.analyser),
        })),
        output: q.outputs.map(rms),
        video: v
          ? {
              time: v.currentTime,
              paused: v.paused,
              width: v.videoWidth,
              height: v.videoHeight,
              frames: v.getVideoPlaybackQuality().totalVideoFrames,
            }
          : null,
      };
    });
  }
  const policySession = await contexts[0]!.newCDPSession(pages[0]!);
  const policy = await policySession.send("Runtime.evaluate", {
    expression: `(async()=>{const v=document.createElement('video');v.src=${JSON.stringify(asset.url)};v.muted=false;try{await v.play();v.pause();v.removeAttribute('src');v.load();return 'permitted';}catch(e){return e.name;}})()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  });
  assert.ok(["NotAllowedError", "permitted"].includes(policy.result.value));
  console.log(
    policy.result.value === "NotAllowedError"
      ? "PASS actual Chrome autoplay policy rejected unactivated video audio."
      : "NOTE Chrome permits the isolated unactivated probe; app still starts muted until explicit sound activation.",
  );
  await policySession.detach();
  for (const p of pages) {
    assert.equal((await proof(p)).contexts, 0);
    await p
      .getByRole("button", { name: "Увімкнути звук", exact: true })
      .click();
    await wait(async () => {
      const v = await proof(p);
      return (
        v.sources.filter((s) => !s.video && s.playing).length === 2 &&
        v.output.some((n) => n > 0.0001)
      );
    }, "Music + Ambience real output");
  }
  const dmPage = pages[0]!,
    player = pages[1]!;
  await player.getByRole("button", { name: "Збільшити", exact: true }).click();
  const cameraState = () =>
    player.locator(".interactive-table>svg").evaluate((node) => {
      const svg = node as SVGSVGElement,
        m = (
          svg.querySelector("g[transform]") as SVGGElement
        ).transform.baseVal.consolidate()!.matrix;
      return {
        x: (svg.viewBox.baseVal.width / 2 - m.e) / m.a,
        y: (svg.viewBox.baseVal.height / 2 - m.f) / m.a,
        scale: m.a,
      };
    });
  const camera = await cameraState();
  await dmPage.getByRole("button", { name: "Director", exact: true }).click();
  await dmPage.getByRole("button", { name: "Жива сесія", exact: true }).click();
  await dmPage.getByLabel("Вибір відеосцени").selectOption(asset.id);
  await dmPage
    .getByRole("button", { name: "Показати відео всім", exact: true })
    .click();
  const videoPlaying = async (p: Page) => {
    const s = await proof(p);
    return Boolean(
      s.video &&
        !s.video.paused &&
        s.video.frames > 5 &&
        s.sources.some((a) => a.video && a.playing && a.rms > 0.001),
    );
  };
  for (const p of pages)
    await wait(() => videoPlaying(p), "real H264 frames and AAC audio");
  for (const p of pages)
    await wait(async () => {
      const s = await proof(p);
      return (
        s.sources.some(
          (a) => !a.video && a.playing && Math.abs(a.gain - 0.175) < 0.02,
        ) &&
        s.sources.some(
          (a) => !a.video && a.playing && Math.abs(a.gain - 0.15) < 0.02,
        )
      );
    }, "single 25% duck, both background tracks still playing");
  const times = await Promise.all(
    pages.map(async (p) => (await proof(p)).video!.time),
  );
  assert.ok(Math.max(...times) - Math.min(...times) < 3, "approximate sync");
  await dmPage
    .getByRole("button", { name: "Пауза відео", exact: true })
    .click();
  for (const p of pages)
    await wait(async () => {
      const s = await proof(p);
      return (
        Boolean(s.video?.paused) &&
        s.sources.some(
          (a) => !a.video && a.playing && Math.abs(a.gain - 0.7) < 0.02,
        )
      );
    }, "pause restores background");
  const shots = resolve("../../.backups/video", kit.live ? "public" : "local");
  await mkdir(shots, { recursive: true });
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await player.setViewportSize(size);
    await wait(
      () =>
        player
          .locator(".video-cinema>video")
          .evaluate((v) => (v as HTMLVideoElement).videoWidth === 640),
      "video layout",
    );
    const fit = await player.locator(".video-cinema>video").evaluate((v) => {
      const r = v.getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        fit: getComputedStyle(v).objectFit,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(fit.fit, "contain");
    assert.ok(
      fit.width > size.width * 0.9 &&
        fit.height > size.height * 0.65 &&
        !fit.overflow,
    );
    await player.screenshot({
      path: resolve(shots, `player-video-${size.width}.png`),
    });
    await dmPage.setViewportSize(size);
    await dmPage.screenshot({
      path: resolve(shots, `dm-video-${size.width}.png`),
    });
  }
  await player
    .getByRole("button", { name: "На весь екран", exact: true })
    .click();
  await wait(
    () => player.evaluate(() => Boolean(document.fullscreenElement)),
    "actual fullscreen",
  );
  await player.evaluate(() => document.exitFullscreen());
  await player.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await player
      .locator(".video-cinema")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await dmPage
    .getByRole("button", { name: "Продовжити відео", exact: true })
    .click();
  for (const p of pages) await wait(() => videoPlaying(p), "resume decode");
  await player.locator(".video-cinema>video").evaluate((v) => {
    (v as HTMLVideoElement).currentTime = 0;
  });
  await wait(
    async () => {
      const state = await kit.json<DirectorSnapshot>(
          kit.path("/state"),
          dm.cookie,
        ),
        s = await proof(player);
      return Boolean(
        state.video &&
          s.video &&
          Math.abs(
            s.video.time -
              (state.video.position +
                (Date.now() - state.video.startedAt!) / 1000),
          ) < 2,
      );
    },
    "periodic drift correction",
    12000,
  );
  // Per-user mute/volume never changes the global channel rows or other participants.
  await pages[2]!.locator(".video-cinema input[type=checkbox]").check();
  await wait(
    async () => (await proof(pages[2]!)).output.every((n) => n < 0.00001),
    "local mute includes video",
  );
  assert.ok((await proof(player)).output.some((n) => n > 0.0001));
  await pages[2]!.locator(".video-cinema input[type=checkbox]").uncheck();
  await contexts[3]!.setOffline(true);
  await new Promise((r) => setTimeout(r, 1800));
  await contexts[3]!.setOffline(false);
  await wait(() => videoPlaying(pages[3]!), "midvideo reconnect");
  await pages[2]!.reload();
  await pages[2]!.locator(".video-cinema").waitFor();
  await pages[2]!
    .locator(".video-cinema")
    .getByRole("button", { name: "Увімкнути звук", exact: true })
    .click();
  await wait(() => videoPlaying(pages[2]!), "late join current position");
  assert.ok((await proof(pages[2]!)).video!.time > 2);
  // Real failed HTTP media, followed by an actual successful retry; no decoder mocks.
  await dmPage
    .getByRole("button", { name: "Пауза відео", exact: true })
    .click();
  await player.route("**/director/videos/*/file", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await player
    .getByRole("button", { name: "Повторити відео / звук", exact: true })
    .click();
  await player
    .getByText(
      "Відео недоступне або формат не підтримується. Повторіть спробу.",
      { exact: true },
    )
    .waitFor();
  await wait(
    async () =>
      (await proof(player)).sources.some(
        (a) => !a.video && a.playing && Math.abs(a.gain - 0.7) < 0.02,
      ),
    "error unducks",
  );
  await player.screenshot({ path: resolve(shots, "player-video-error.png") });
  await player.unroute("**/director/videos/*/file");
  await player
    .getByRole("button", { name: "Повторити відео / звук", exact: true })
    .click();
  await dmPage
    .getByRole("button", { name: "Продовжити відео", exact: true })
    .click();
  await wait(() => videoPlaying(player), "retry AAC decode");
  await dmPage
    .getByRole("button", { name: "Зупинити відео", exact: true })
    .click();
  for (const p of pages) {
    await p.locator(".video-cinema").waitFor({ state: "detached" });
    await wait(
      async () =>
        (await proof(p)).sources.some(
          (a) => !a.video && a.playing && Math.abs(a.gain - 0.7) < 0.02,
        ),
      "stop restores gains",
    );
  }
  const restored = await cameraState();
  assert.ok(
    Math.abs(restored.x - camera.x) < 0.1 &&
      Math.abs(restored.y - camera.y) < 0.1 &&
      Math.abs(restored.scale - camera.scale) < 0.0001,
    "personal camera world center and logical zoom survive video and viewport resize",
  );
  // Launch again then advance only this synthetic timeline near its natural end.
  let state = await kit.json<DirectorSnapshot>(kit.path("/state"), dm.cookie);
  state = await kit.json(kit.path("/video"), dm.cookie, {
    version: state.version,
    action: "PLAY",
    videoId: asset.id,
    revision: asset.revision,
  });
  await wait(() => videoPlaying(player), "repeat explicit launch");
  await kit.json(kit.path("/video"), dm.cookie, {
    version: state.version,
    action: "PAUSE",
  });
  await prisma.videoPlayback.update({
    where: { campaignId: c.id },
    data: { position: asset.duration - 3 },
  });
  state = await kit.json(kit.path("/state"), dm.cookie);
  await kit.json(kit.path("/video"), dm.cookie, {
    version: state.version,
    action: "RESUME",
  });
  for (const p of pages)
    await p
      .locator(".video-cinema")
      .waitFor({ state: "detached", timeout: 20000 });
  await pages[3]!.reload();
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(
    await pages[3]!.locator(".video-cinema").count(),
    0,
    "ended video does not replay",
  );
  assert.equal(
    JSON.stringify(
      await prisma.audioChannel.findMany({
        where: { campaignId: c.id },
        orderBy: { key: "asc" },
      }),
    ),
    audioBefore,
    "ducking does not mutate global audio",
  );
  assert.equal(
    JSON.stringify(
      await prisma.scene.findUnique({
        where: { id: scene.id },
        include: { tokens: true },
      }),
    ),
    gameplay,
  );
  console.log(
    `PASS Video Browser ${kit.live ? "HTTPS/WSS" : "local"}: DM + 3, real H.264 frames/AAC waveform, Music+Ambience single duck/restore, Pause/Resume/Stop/end, local mute, drift correction, late join/reconnect, real 503/retry, preserved camera/scene/global audio, 1366/1920 contain layout. Screenshots ${shots}.`,
  );
} catch (e) {
  console.error("FAIL Video Browser", e instanceof Error ? e.stack : "unknown");
  process.exitCode = 1;
} finally {
  for (const c of contexts) await c.close();
  await browser?.close();
  await vite?.close();
  await kit.cleanup();
}
