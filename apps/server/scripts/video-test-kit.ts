import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { prisma } from "../src/database/client.js";
import { destroyAudio } from "../src/audio/storage.js";
import { destroyImage } from "../src/scenes/storage.js";
export async function wait(
  fn: () => boolean | Promise<boolean>,
  label: string,
  ms = 35000,
) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await new Promise((r) => setTimeout(r, 100));
  }
}
export class VideoTestKit {
  users: string[] = [];
  campaignId = "";
  child: ChildProcess | undefined;
  base: string;
  origin: string;
  constructor(
    public live: string | undefined,
    public browser = false,
  ) {
    this.base = live ? new URL(live).origin : "http://127.0.0.1:3118";
    this.origin = live
      ? this.base
      : browser
        ? "http://localhost:5178"
        : "http://localhost:5173";
  }
  async identity() {
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url");
    this.users.push(id);
    await prisma.user.create({
      data: {
        id,
        email: `${id}@example.invalid`,
        displayName: "Video QA",
        passwordHash: "test-only",
        sessions: {
          create: {
            tokenHash: createHash("sha256").update(token).digest("hex"),
            expiresAt: new Date(Date.now() + 3600000),
          },
        },
      },
    });
    return {
      id,
      token,
      cookie: `${this.live ? "__Host-dnd_session" : "dnd_session"}=${token}`,
    };
  }
  async start() {
    if (this.live) return;
    this.child = spawn(
      process.execPath,
      ["--env-file-if-exists=.env", "dist/index.js"],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          PORT: "3118",
          APP_ORIGIN: this.origin,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let started = false;
    this.child.stdout!.on("data", () => {
      started = true;
    });
    await wait(() => started, "server start");
  }
  async restart() {
    if (this.live) return;
    await this.stop();
    await this.start();
  }
  async stop() {
    if (!this.child) return;
    const c = this.child;
    this.child = undefined;
    const done = new Promise((r) => c.once("exit", r));
    c.kill();
    await done;
  }
  async req(
    path: string,
    cookie?: string,
    data?: unknown,
    method = data === undefined ? "GET" : "POST",
    headers: Record<string, string> = {},
  ) {
    return fetch(this.base + path, {
      method,
      signal: AbortSignal.timeout(120000),
      headers: {
        Origin: this.origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data === undefined || data instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(data === undefined
        ? {}
        : { body: data instanceof FormData ? data : JSON.stringify(data) }),
    });
  }
  async json<T>(
    path: string,
    cookie: string,
    data?: unknown,
    method = data === undefined ? "GET" : "POST",
    status = 200,
  ): Promise<T> {
    const r = await this.req(path, cookie, data, method);
    assert.equal(
      r.status,
      status,
      `${method} ${path}: ${await r.clone().text()}`,
    );
    return r.json();
  }
  path(suffix = "") {
    return `/api/campaigns/${this.campaignId}/director${suffix}`;
  }
  async upload(cookie: string, name = "Synthetic cutscene", bytes?: Buffer) {
    const form = new FormData();
    form.set("name", name);
    form.set(
      "description",
      "Synthetic H.264/AAC test pattern; no player media",
    );
    form.set(
      "file",
      new Blob(
        [
          new Uint8Array(
            bytes ?? (await readFile("scripts/fixtures/video/cutscene.mp4")),
          ),
        ],
        { type: "video/mp4" },
      ),
      "cutscene.mp4",
    );
    return this.json<{ video: import("@dnd/shared").VideoAssetView }>(
      this.path("/videos"),
      cookie,
      form,
      "POST",
      201,
    );
  }
  async cleanup() {
    await this.stop();
    try {
      if (this.campaignId) {
        for (const f of await prisma.videoAsset.findMany({
          where: { campaignId: this.campaignId },
        }))
          await destroyAudio(f.storageKey);
        for (const f of await prisma.audioAsset.findMany({
          where: { campaignId: this.campaignId },
        }))
          await destroyAudio(f.storageKey);
        for (const f of await prisma.mediaFile.findMany({
          where: { campaignId: this.campaignId },
        }))
          await destroyImage(f.storageKey);
        await prisma.campaign.updateMany({
          where: { id: this.campaignId },
          data: {
            activeLocationId: null,
            presentationMaterialId: null,
            presentationMode: "TABLE",
          },
        });
        await prisma.campaign.deleteMany({ where: { id: this.campaignId } });
      }
      await prisma.user.deleteMany({ where: { id: { in: this.users } } });
      console.log(
        "Video synthetic accounts, campaign and provider files removed.",
      );
    } finally {
      await prisma.$disconnect();
    }
  }
}
