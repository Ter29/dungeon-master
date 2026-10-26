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
import { prisma } from "../src/database/client.js";
import { destroyAudio } from "../src/audio/storage.js";
import { destroyImage } from "../src/scenes/storage.js";
import { wav } from "./audio-fixture.js";
const live = process.argv[2],
  base = live ? new URL(live).origin : "http://localhost:5176",
  apiBase = live ? base : "http://127.0.0.1:3116";
const users: string[] = [],
  contexts: BrowserContext[] = [];
let campaignId: string | undefined,
  child: ReturnType<typeof spawn> | undefined,
  vite: ViteDevServer | undefined,
  browser: Browser | undefined;
async function wait(
  fn: () => Promise<boolean>,
  label: string,
  timeout = 25000,
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
          PORT: "3116",
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
        port: 5176,
        strictPort: true,
        proxy: { "/api": apiBase, "/socket.io": { target: apiBase, ws: true } },
      },
    });
    await vite.listen();
  }
  async function identity(name: string) {
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url");
    users.push(id);
    await prisma.user.create({
      data: {
        id,
        email: `${id}@example.invalid`,
        displayName: name,
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
  const dm = await identity("Елдрік"),
    player = await identity("Арія"),
    c = await prisma.campaign.create({
      data: {
        name: "Хроніки Тіньової Долини",
        members: {
          create: [
            { userId: dm.id, role: "DM" },
            { userId: player.id, role: "PLAYER" },
          ],
        },
      },
    });
  campaignId = c.id;
  async function request(
    path: string,
    data?: unknown,
    method = data === undefined ? "GET" : "POST",
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
    assert.ok(r.ok, `${path}: ${await r.clone().text()}`);
    return r.status === 204 ? null : r.json();
  }
  const prefix = `/api/campaigns/${c.id}`,
    scene = (
      await request(prefix + "/locations", {
        name: "Забутий храм",
        description: "Камінь пам’ятає голоси тих, хто давно пішов.",
        initialFog: "hidden",
      })
    ).scene;
  const fallback = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><pattern id="g" width="64" height="64" patternUnits="userSpaceOnUse"><rect width="64" height="64" fill="#514b40"/><path d="M0 0H64V64" fill="none" stroke="#252722" stroke-width="3"/></pattern></defs><rect width="1024" height="1024" fill="#171c20"/><rect x="64" y="64" width="896" height="896" rx="20" fill="url(#g)" stroke="#8c8065" stroke-width="18"/><path d="M64 320H320V64M576 64V320H960M64 704H320V960M576 960V704H960" fill="none" stroke="#292b25" stroke-width="25"/><circle cx="512" cy="500" r="100" fill="#716852" stroke="#36392f" stroke-width="12"/><circle cx="512" cy="500" r="60" fill="none" stroke="#a59161" stroke-width="5"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const image = process.env.UI_MAP_PATH
    ? await readFile(process.env.UI_MAP_PATH)
    : fallback;
  const f = new FormData();
  f.set("revision", "0");
  f.set(
    "file",
    new Blob([new Uint8Array(image)], { type: "image/png" }),
    "temple.png",
  );
  await request(prefix + "/locations/" + scene.id + "/background", f);
  await request(prefix + "/locations/activate", {
    version: (await request(prefix + "/locations")).version,
    sceneId: scene.id,
  });
  const hero = (
    await request(prefix + "/locations/" + scene.id + "/tokens", {
      name: "Арія",
      kind: "PLAYER",
      hidden: false,
      x: 300,
      y: 480,
      size: 42,
    })
  ).token;
  const ally = (
    await request(prefix + "/locations/" + scene.id + "/tokens", {
      name: "Торін",
      kind: "PLAYER",
      hidden: false,
      x: 400,
      y: 520,
      size: 42,
    })
  ).token;
  await request(prefix + "/locations/" + scene.id + "/tokens", {
    name: "Невідомий вартовий 58329",
    kind: "ENEMY",
    hidden: true,
    x: 720,
    y: 450,
    size: 42,
  });
  await request(
    prefix + "/locations/" + scene.id + "/fog",
    {
      revision: 0,
      operations: [
        {
          kind: "rectangle",
          mode: "reveal",
          from: { x: 0, y: 0 },
          to: { x: 530, y: 1024 },
        },
      ],
    },
    "PATCH",
  );
  let combat = await request(prefix + "/combat", { sceneId: scene.id });
  for (const [token, initiative] of [
    [hero, 18],
    [ally, 14],
  ])
    combat = await request(
      prefix + `/combat/${combat.encounter.id}/participants`,
      { version: combat.encounter.version, tokenId: token.id, initiative },
    );
  combat = await request(prefix + `/combat/${combat.encounter.id}/start`, {
    version: combat.encounter.version,
  });
  const map = await prisma.sharedMap.create({
    data: {
      campaignId: c.id,
      name: "Карта знань групи",
      available: true,
      width: 1400,
      height: 900,
      elements: {
        create: [
          { kind: "NOTE", text: "Срібний Брід", x: 320, y: 280 },
          {
            kind: "MARKER",
            text: "Забутий храм",
            x: 640,
            y: 440,
            color: "#89552e",
          },
          {
            kind: "ROUTE",
            text: "Старий шлях",
            x: 330,
            y: 300,
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 60 },
              { x: 260, y: 130 },
            ],
          },
        ],
      },
    },
  });
  const material = (
    await request(prefix + "/director/materials", {
      name: "Таємниця храму",
      category: "LOCATION",
      description: "Світло за дверима чекає на вас.",
    })
  ).material;
  const mf = new FormData();
  mf.set("revision", "0");
  mf.set(
    "file",
    new Blob([new Uint8Array(image)], { type: "image/png" }),
    "illustration.png",
  );
  const readyMaterial = (
    await request(prefix + `/director/materials/${material.id}/image`, mf)
  ).material;
  const assets = [];
  for (const [name, category, hz] of [
    ["Вогні таверни", "MUSIC", 220],
    ["Віддалений грім", "SFX", 60],
  ] as const) {
    const form = new FormData();
    form.set("name", name);
    form.set("category", category);
    form.set(
      "file",
      new Blob([new Uint8Array(wav(3, hz))], { type: "audio/wav" }),
      "tone.wav",
    );
    assets.push((await request(prefix + "/audio/assets", form)).asset);
  }
  const initialAudio = await request(prefix + "/audio/state");
  await request(prefix + "/audio/channels/MUSIC", {
    version: initialAudio.version,
    action: "PLAY",
    assetId: assets[0]!.id,
    assetRevision: assets[0]!.revision,
    fadeMs: 0,
    loop: true,
  });
  browser = await chromium.launch({
    channel: process.env.AUDIO_BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  const errors: string[] = [];
  async function open(user: typeof dm) {
    const context = await browser!.newContext({
      viewport: { width: 1920, height: 1080 },
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
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/campaigns/" + c.id);
    await page.locator(".workspace-header").waitFor();
    return page;
  }
  const dmPage = await open(dm),
    playerPage = await open(player);
  const nav = (page: Page, name: string) =>
    page
      .getByRole("navigation", { name: "Розділи кампанії" })
      .getByRole("button", { name, exact: true })
      .click();
  const output = resolve(
    "../../.backups/workspace-ui" + (live ? "-public" : ""),
  );
  await mkdir(output, { recursive: true });
  async function shot(page: Page, name: string) {
    // SVG image layout is ready before its authenticated background finishes.
    // Wait for visible background bytes, not merely the canvas element.
    await page.locator("svg image:visible").evaluateAll(async (images) => {
      await Promise.all(
        images.map(async (el) => {
          const source = (el as SVGImageElement).href.baseVal;
          if (!source) return;
          const image = new Image();
          image.src = source;
          await image.decode();
        }),
      );
    });
    await page.screenshot({
      path: resolve(output, name + ".png"),
      fullPage: false,
      animations: "disabled",
    });
  }
  async function check(page: Page, label: string) {
    const bad = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      main:
        document.querySelector(".workspace-main")!.scrollWidth >
        document.querySelector(".workspace-main")!.clientWidth + 1,
      context:
        document.querySelector(".workspace-context")!.scrollWidth >
        document.querySelector(".workspace-context")!.clientWidth + 1,
    }));
    assert.ok(
      !bad.overflow && !bad.main && !bad.context,
      `${label} horizontal overflow: ${JSON.stringify(bad)}`,
    );
    const unlabeled = await page
      .locator("button:visible")
      .evaluateAll(
        (buttons) =>
          buttons.filter(
            (b) =>
              !b.textContent?.trim() &&
              !b.getAttribute("aria-label") &&
              !b.getAttribute("title"),
          ).length,
      );
    assert.equal(unlabeled, 0, `${label} unlabeled buttons`);
  }
  await dmPage
    .getByRole("img", { name: "Інтерактивна локація: Забутий храм" })
    .waitFor();
  await playerPage
    .getByRole("img", { name: "Інтерактивна локація: Забутий храм" })
    .waitFor();
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
  ]) {
    await dmPage.setViewportSize({ width, height });
    await playerPage.setViewportSize({ width, height });
    for (const name of [
      "Table",
      "Scenes",
      "Maps",
      "Director",
      "Audio",
      "Combat",
      "Campaign",
    ]) {
      await nav(dmPage, name);
      if (name === "Director") {
        await dmPage
          .getByRole("button", { name: "Обрати «Таємниця храму»", exact: true })
          .click();
        await dmPage
          .getByRole("button", { name: "Preview · тільки DM", exact: true })
          .click();
        await dmPage
          .locator('[aria-label="Приватний перегляд матеріалу"] img')
          .evaluate(async (img) => {
            await (img as HTMLImageElement).decode();
          });
        await wait(
          async () =>
            dmPage
              .locator(
                '[aria-label="Приватний перегляд матеріалу"] .director-fade',
              )
              .evaluate((el) => Number(getComputedStyle(el).opacity) === 1),
          "Director fade fully visible for screenshot",
        );
      }
      if (name === "Maps") {
        await dmPage
          .getByRole("button", { name: "Карта знань групи", exact: true })
          .click();
        await dmPage
          .getByRole("img", { name: "Спільна карта: Карта знань групи" })
          .waitFor();
      }
      await check(dmPage, `DM ${name} ${width}`);
      await shot(dmPage, `dm-${name.toLowerCase()}-${width}`);
    }
    for (const name of ["Table", "Maps", "Combat", "Campaign"]) {
      await nav(playerPage, name);
      await check(playerPage, `Player ${name} ${width}`);
    }
    await nav(playerPage, "Table");
    await shot(playerPage, `player-table-${width}`);
    assert.equal(
      await playerPage
        .getByRole("button", { name: "Scenes", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await playerPage
        .getByText("Невідомий вартовий 58329", { exact: false })
        .count(),
      0,
    );
  }
  await nav(dmPage, "Table");
  await dmPage.getByRole("button", { name: "Збільшити", exact: true }).click();
  const camera = await dmPage
    .locator('svg[aria-label="Інтерактивна локація: Забутий храм"]>g')
    .getAttribute("transform");
  await nav(dmPage, "Scenes");
  await dmPage
    .getByRole("button", { name: "Забутий храм", exact: true })
    .click();
  const title = dmPage.getByRole("textbox", { name: "Назва", exact: true });
  await title.fill("Чернетка храму");
  await dmPage.getByText("Є незбережені зміни", { exact: true }).waitFor();
  await nav(dmPage, "Table");
  assert.equal(
    await dmPage
      .locator('svg[aria-label="Інтерактивна локація: Забутий храм"]>g')
      .getAttribute("transform"),
    camera,
    "table camera preserved",
  );
  await nav(dmPage, "Scenes");
  assert.equal(await title.inputValue(), "Чернетка храму");
  await title.fill("Забутий храм");
  await nav(dmPage, "Table");
  const tokenPoint = await dmPage
    .locator('svg[aria-label="Інтерактивна локація: Забутий храм"]>g')
    .evaluate((g) => {
      const m = (g as SVGGElement).getScreenCTM()!;
      return [
        new DOMPoint(300, 480).matrixTransform(m),
        new DOMPoint(345, 480).matrixTransform(m),
      ].map((p) => ({ x: p.x, y: p.y }));
    });
  await dmPage.mouse.move(tokenPoint[0]!.x, tokenPoint[0]!.y);
  await dmPage.mouse.down();
  await dmPage.mouse.move(tokenPoint[1]!.x, tokenPoint[1]!.y, { steps: 8 });
  await dmPage.mouse.up();
  await wait(
    async () =>
      Math.abs(
        (
          await request(
            prefix + "/locations/" + scene.id + "/tokens/" + hero.id,
          )
        ).token.x - 345,
      ) < 2,
    "real token drag saved",
  );
  await dmPage
    .getByLabel("Інструмент туману", { exact: true })
    .selectOption("reveal-brush");
  const fogPoint = await dmPage
    .locator('svg[aria-label="Інтерактивна локація: Забутий храм"]>g')
    .evaluate((g) => {
      const m = (g as SVGGElement).getScreenCTM()!;
      return [
        new DOMPoint(680, 250).matrixTransform(m),
        new DOMPoint(730, 250).matrixTransform(m),
      ].map((p) => ({ x: p.x, y: p.y }));
    });
  const fogBefore = (await request(prefix + "/locations/" + scene.id)).scene.fog
    .revision;
  await dmPage.mouse.move(fogPoint[0]!.x, fogPoint[0]!.y);
  await dmPage.mouse.down();
  await dmPage.mouse.move(fogPoint[1]!.x, fogPoint[1]!.y, { steps: 8 });
  await dmPage.mouse.up();
  await wait(
    async () =>
      (await request(prefix + "/locations/" + scene.id)).scene.fog.revision >
      fogBefore,
    "real Fog brush saved",
  );
  await dmPage
    .getByLabel("Інструмент туману", { exact: true })
    .selectOption("camera");
  await nav(dmPage, "Director");
  await dmPage
    .getByRole("button", { name: "Обрати «Таємниця храму»", exact: true })
    .click();
  const before = await request(prefix + "/director/state");
  await dmPage
    .getByRole("button", { name: "Preview · тільки DM", exact: true })
    .click();
  assert.equal(
    (await request(prefix + "/director/state")).version,
    before.version,
    "Preview remains private",
  );
  await dmPage
    .getByRole("button", { name: "Show to Players", exact: true })
    .click();
  await playerPage.locator("[data-presentation-mode=ILLUSTRATION]").waitFor();
  await shot(playerPage, "player-illustration-1366");
  await dmPage
    .getByRole("button", { name: "Повернути до Table Mode", exact: true })
    .click();
  await playerPage
    .locator(".director-fullscreen")
    .waitFor({ state: "detached" });
  await nav(dmPage, "Table");
  const toolbar = dmPage.getByRole("button", {
    name: "Згорнути панель",
    exact: true,
  });
  await toolbar.click();
  assert.equal(await dmPage.locator("#workspace-context").isVisible(), false);
  await dmPage
    .getByRole("button", { name: "Інструменти", exact: true })
    .click();
  await nav(dmPage, "Audio");
  await dmPage
    .getByLabel("MUSIC track", { exact: true })
    .selectOption(assets[0]!.id);
  await dmPage
    .locator(".audio-channel")
    .first()
    .getByRole("button", { name: "Play / Перехід", exact: true })
    .click();
  await wait(
    async () =>
      (await request(prefix + "/audio/state")).channels[0].status === "PLAYING",
    "Audio UI play",
  );
  const favorite = dmPage.getByRole("button", {
    name: "Додати до улюблених Віддалений грім",
    exact: true,
  });
  await favorite.click();
  await dmPage
    .getByRole("button", {
      name: "Прибрати з улюблених Віддалений грім",
      exact: true,
    })
    .waitFor();
  await dmPage.reload();
  await dmPage.locator(".command-center[data-section=audio]").waitFor();
  await dmPage
    .getByRole("button", {
      name: "Прибрати з улюблених Віддалений грім",
      exact: true,
    })
    .waitFor();
  await nav(dmPage, "Combat");
  await dmPage.getByRole("button", { name: "Next Turn", exact: true }).click();
  await wait(
    async () =>
      (await request(prefix + "/combat")).encounter.currentParticipantId !==
      combat.encounter.currentParticipantId,
    "initiative UI next turn",
  );
  await contexts[1]!.setOffline(true);
  await wait(
    async () =>
      !(await playerPage.locator(".header-status").textContent())?.includes(
        "Синхронізовано",
      ),
    "Player offline status",
    65000,
  );
  await contexts[1]!.setOffline(false);
  await playerPage.getByText("Синхронізовано", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    `PASS Workspace Browser: ${live ? "public HTTPS/WSS" : "local"} seven DM/four Player sections, 1920x1080 and 1366x768, no horizontal overflow/unlabeled buttons, private Player view, mounted camera/draft persistence, private Preview/show/Table, Audio controls/favorites, Combat turn, section restore, reconnect. Screenshots: ${output}`,
  );
} catch (e) {
  console.error(
    "FAIL Workspace Browser:",
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
