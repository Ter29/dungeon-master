import { Router, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import multer, { MulterError } from "multer";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../database/client.js";
import { sessionUser } from "../auth/router.js";
import { appOrigin } from "../config/app.js";
import { SceneError } from "../scenes/state.js";
import { imageUploadSlot, storageAvailable } from "../scenes/storage.js";
import {
  audioLimits,
  inspectAudio,
  uploadAudio,
  audioDeliveryUrl,
  cleanupAudio,
} from "./storage.js";
import {
  assetView,
  audioSnapshot,
  audioEvents,
  audioPosition,
  audioFade,
} from "./state.js";
export const audioRouter = Router({ mergeParams: true });
const uuid = z.string().uuid(),
  version = z.number().int().min(0),
  gain = z.number().min(0).max(1),
  key = z.enum(["MUSIC", "AMBIENCE"]);
function parse<T>(s: z.ZodType<T>, v: unknown): T {
  const r = s.safeParse(v);
  if (!r.success)
    throw new SceneError(400, "Перевірте аудіо, канал і версію стану.");
  return r.data;
}
audioRouter.use(async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const u = await sessionUser(req);
  if (!u) throw new SceneError(401, "Увійдіть до облікового запису.");
  const id = parse(uuid, req.params.campaignId),
    m = await prisma.campaignMember.findUnique({
      where: { campaignId_userId: { campaignId: id, userId: u.id } },
    });
  if (!m) throw new SceneError(404, "Кампанію не знайдено.");
  res.locals.id = id;
  res.locals.member = m;
  if (!["GET", "HEAD"].includes(req.method)) {
    if (req.headers.origin && req.headers.origin !== appOrigin)
      throw new SceneError(403, "Недозволене джерело запиту.");
    if (!req.is("application/json") && !req.is("multipart/form-data"))
      throw new SceneError(415, "Потрібен JSON або multipart/form-data.");
  }
  next();
});
const dm: RequestHandler = (_req, res, next) => {
  if (res.locals.member.role !== "DM")
    throw new SceneError(403, "Керувати звуком може лише DM.");
  next();
};
const changes = rateLimit({
  windowMs: 60000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Забагато аудіокоманд." },
});
const uploads = rateLimit({
  windowMs: 15 * 60000,
  limit: 15,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Забагато завантажень." },
});
const reads = rateLimit({
  windowMs: 60000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Забагато запитів аудіо." },
});
async function locked<T>(
  id: string,
  task: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${id}::uuid FOR UPDATE`;
      return task(tx);
    },
    { timeout: 10000 },
  );
}
async function asset(
  tx: Prisma.TransactionClient,
  id: string,
  assetId: unknown,
) {
  if (!uuid.safeParse(assetId).success)
    throw new SceneError(404, "Аудіо не знайдено.");
  const a = await tx.audioAsset.findFirst({
    where: { id: String(assetId), campaignId: id, deletedAt: null },
  });
  if (!a) throw new SceneError(404, "Аудіо не знайдено.");
  return a;
}
function notify(id: string, library = false) {
  audioEvents.emit("changed", id, library);
}
audioRouter.get("/state", async (_req, res) =>
  res.json(await audioSnapshot(res.locals.id)),
);
audioRouter.get("/assets", dm, async (_req, res) =>
  res.json({
    assets: (
      await prisma.audioAsset.findMany({
        where: { campaignId: res.locals.id, deletedAt: null },
        orderBy: { createdAt: "asc" },
      })
    ).map(assetView),
    ...audioLimits,
    storageAvailable: storageAvailable(),
  }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: audioLimits.maxBytes,
    files: 1,
    fields: 3,
    fieldSize: 8000,
    parts: 4,
  },
  fileFilter: (_req, f, done) => {
    if (
      ![
        "audio/mpeg",
        "audio/mp3",
        "audio/ogg",
        "application/ogg",
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
      ].includes(f.mimetype)
    )
      done(new SceneError(415, "Лише MP3, OGG або WAV."));
    else done(null, true);
  },
}).single("file");
const multipart: RequestHandler = (req, res, next) =>
  upload(req, res, (e) =>
    next(
      e instanceof MulterError
        ? new SceneError(
            e.code === "LIMIT_FILE_SIZE" ? 413 : 400,
            e.code === "LIMIT_FILE_SIZE"
              ? "Аудіофайл перевищує ліміт."
              : "Некоректне завантаження.",
          )
        : e,
    ),
  );
audioRouter.post(
  "/assets",
  dm,
  uploads,
  imageUploadSlot,
  multipart,
  async (req, res) => {
    const fields = parse(
      z
        .object({
          name: z.string().trim().min(1).max(120),
          description: z.string().trim().max(2000).default(""),
          category: z.enum(["MUSIC", "AMBIENCE", "SFX"]),
        })
        .strict(),
      req.body,
    );
    if (!req.file) throw new SceneError(400, "Оберіть аудіофайл.");
    const info = await inspectAudio(req.file.buffer, fields.category);
    const a = await locked(res.locals.id, async (tx) => {
      const usage = await tx.audioAsset.aggregate({
        where: { campaignId: res.locals.id },
        _count: true,
        _sum: { byteSize: true },
      });
      if (
        usage._count >= audioLimits.maxAssets ||
        (usage._sum.byteSize ?? 0) + req.file!.size > audioLimits.campaignBytes
      )
        throw new SceneError(413, "Ліміт аудіобібліотеки кампанії вичерпано.");
      return tx.audioAsset.create({
        data: {
          ...fields,
          ...info,
          byteSize: req.file!.size,
          campaignId: res.locals.id,
          storageKey: `dungeon-master/${res.locals.id}/audio/${randomUUID()}`,
          deletedAt: new Date(),
        },
      });
    });
    await uploadAudio(a.storageKey, req.file.buffer);
    const current = await prisma.audioAsset.update({
      where: { id: a.id },
      data: { deletedAt: null },
    });
    notify(res.locals.id, true);
    res.status(201).json({ asset: assetView(current) });
  },
);
audioRouter.patch("/assets/:assetId", dm, changes, async (req, res) => {
  const d = parse(
    z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(2000).optional(),
        revision: version,
      })
      .strict(),
    req.body,
  );
  const a = await locked(res.locals.id, async (tx) => {
    const old = await asset(tx, res.locals.id, req.params.assetId);
    if (old.revision !== d.revision)
      throw new SceneError(409, "Аудіо вже змінено.");
    const { revision: _, ...update } = d;
    const current = await tx.audioAsset.update({
      where: { id: old.id },
      data: { ...update, revision: { increment: 1 } },
    });
    await tx.campaign.update({
      where: { id: res.locals.id },
      data: { audioVersion: { increment: 1 } },
    });
    return current;
  });
  notify(res.locals.id, true);
  res.json({ asset: assetView(a) });
});
audioRouter.delete("/assets/:assetId", dm, changes, async (req, res) => {
  const d = parse(z.object({ revision: version }).strict(), req.body);
  const a = await locked(res.locals.id, async (tx) => {
    const old = await asset(tx, res.locals.id, req.params.assetId);
    if (old.revision !== d.revision)
      throw new SceneError(409, "Аудіо вже змінено.");
    await tx.audioChannel.updateMany({
      where: { campaignId: res.locals.id, assetId: old.id },
      data: {
        assetId: null,
        status: "STOPPED",
        position: 0,
        startedAt: null,
        outgoingAssetId: null,
      },
    });
    await tx.audioChannel.updateMany({
      where: { campaignId: res.locals.id, outgoingAssetId: old.id },
      data: { outgoingAssetId: null },
    });
    await tx.audioCue.deleteMany({ where: { assetId: old.id } });
    await tx.audioAsset.update({
      where: { id: old.id },
      data: { deletedAt: new Date() },
    });
    await tx.campaign.update({
      where: { id: res.locals.id },
      data: { audioVersion: { increment: 1 } },
    });
    return old;
  });
  notify(res.locals.id, true);
  res.status(204).end();
  void cleanupAudio(a.id);
});

audioRouter.post("/channels/:key", dm, changes, async (req, res) => {
  const k = parse(key, req.params.key),
    d = parse(
      z
        .object({
          version,
          action: z.enum([
            "PLAY",
            "PAUSE",
            "RESUME",
            "STOP",
            "SETTINGS",
            "FADE_IN",
            "FADE_OUT",
          ]),
          assetId: uuid.optional(),
          assetRevision: version.optional(),
          loop: z.boolean().optional(),
          volume: gain.optional(),
          fadeMs: z.number().int().min(0).max(15000).default(1500),
        })
        .strict(),
      req.body,
    );
  await locked(res.locals.id, async (tx) => {
    const c = await tx.campaign.findUniqueOrThrow({
      where: { id: res.locals.id },
    });
    if (c.audioVersion !== d.version)
      throw new SceneError(
        409,
        "Звук уже змінився. Оновіть стан і повторіть дію.",
      );
    const view = (await audioSnapshot(c.id, tx)).channels.find(
      (c) => c.key === k,
    )!;
    const now = new Date(),
      where = { campaignId_key: { campaignId: c.id, key: k } };
    const old = await tx.audioChannel.upsert({
      where,
      create: { campaignId: c.id, key: k },
      update: {},
    });
    const update: Prisma.AudioChannelUncheckedUpdateInput = {};
    if (d.action === "PLAY") {
      const a = await asset(tx, c.id, d.assetId);
      if (a.category !== k)
        throw new SceneError(400, "Аудіо не відповідає каналу.");
      if (d.assetRevision === undefined || a.revision !== d.assetRevision)
        throw new SceneError(409, "Оновіть вибір композиції.");
      Object.assign(update, {
        assetId: a.id,
        status: "PLAYING",
        position: 0,
        startedAt: now,
        loop: d.loop ?? old.loop,
        volume: d.volume ?? old.volume,
        fadeFrom: d.fadeMs ? 0 : 1,
        fadeTo: 1,
        fadeAt: now,
        fadeMs: d.fadeMs,
        outgoingAssetId: null,
      });
      if (view.status === "PLAYING" && view.voice && d.fadeMs)
        Object.assign(update, {
          outgoingAssetId: view.voice.asset.id,
          outgoingPosition: audioPosition(view.voice, now.getTime()),
          outgoingStartedAt: now,
          outgoingLoop: view.voice.loop,
          outgoingGain: audioFade(view.fade, now.getTime()),
        });
    } else if (d.action === "STOP") {
      Object.assign(update, {
        assetId: null,
        status: "STOPPED",
        position: 0,
        startedAt: null,
        outgoingAssetId: null,
        fadeMs: 0,
      });
    } else if (d.action === "PAUSE") {
      if (view.status !== "PLAYING" || !view.voice)
        throw new SceneError(400, "Канал не відтворюється.");
      Object.assign(update, {
        status: "PAUSED",
        position: audioPosition(view.voice, now.getTime()),
        startedAt: null,
        outgoingAssetId: null,
        fadeFrom: 1,
        fadeTo: 1,
        fadeMs: 0,
      });
    } else if (d.action === "RESUME") {
      if (view.status !== "PAUSED" || !view.voice)
        throw new SceneError(400, "Немає призупиненого треку.");
      Object.assign(update, {
        status: "PLAYING",
        startedAt: now,
        fadeFrom: d.fadeMs ? 0 : 1,
        fadeTo: 1,
        fadeAt: now,
        fadeMs: d.fadeMs,
        outgoingAssetId: null,
      });
    } else if (d.action === "FADE_IN" || d.action === "FADE_OUT") {
      if (view.status !== "PLAYING" || !view.voice)
        throw new SceneError(400, "Спочатку запустіть канал.");
      Object.assign(update, {
        fadeFrom: audioFade(view.fade, now.getTime()),
        fadeTo: d.action === "FADE_OUT" ? 0 : 1,
        fadeAt: now,
        fadeMs: d.fadeMs,
        outgoingAssetId: null,
      });
    } else {
      Object.assign(update, {
        ...(d.loop === undefined ? {} : { loop: d.loop }),
        ...(d.volume === undefined ? {} : { volume: d.volume }),
      });
      if (view.voice) {
        update.position = audioPosition(view.voice, now.getTime());
        update.startedAt = view.status === "PLAYING" ? now : null;
      } else
        Object.assign(update, {
          assetId: null,
          status: "STOPPED",
          startedAt: null,
          position: 0,
          outgoingAssetId: null,
        });
    }
    await tx.audioChannel.update({ where, data: update });
    await tx.campaign.update({
      where: { id: c.id },
      data: { audioVersion: { increment: 1 } },
    });
  });
  notify(res.locals.id);
  res.json(await audioSnapshot(res.locals.id));
});
audioRouter.post("/cues", dm, changes, async (req, res) => {
  const d = parse(
    z.object({ assetId: uuid, assetRevision: version }).strict(),
    req.body,
  );
  const cue = await locked(res.locals.id, async (tx) => {
    const a = await asset(tx, res.locals.id, d.assetId);
    if (a.category !== "SFX") throw new SceneError(400, "Оберіть SFX.");
    if (a.revision !== d.assetRevision)
      throw new SceneError(409, "Ефект уже змінено.");
    const now = Date.now();
    await tx.audioCue.deleteMany({
      where: { expiresAt: { lt: new Date(now) } },
    });
    if (
      (await tx.audioCue.count({
        where: {
          campaignId: res.locals.id,
          createdAt: { gt: new Date(now - 10000) },
        },
      })) >= 12
    )
      throw new SceneError(429, "Забагато ефектів: до 12 за 10 секунд.");
    const cue = await tx.audioCue.create({
      data: {
        campaignId: res.locals.id,
        assetId: a.id,
        expiresAt: new Date(now + (a.duration + 10) * 1000),
      },
    });
    return {
      id: cue.id,
      asset: assetView(a),
      at: cue.createdAt.getTime(),
      expiresAt: cue.expiresAt.getTime(),
    };
  });
  audioEvents.emit("cue", res.locals.id, cue);
  res.status(201).json({ id: cue.id });
});

let streaming = 0;
audioRouter.get("/assets/:assetId/file", reads, async (req, res) => {
  async function allowed() {
    const u = await sessionUser(req);
    if (!u) throw new SceneError(404, "Аудіо не знайдено.");
    const m = await prisma.campaignMember.findUnique({
      where: { campaignId_userId: { campaignId: res.locals.id, userId: u.id } },
    });
    if (!m) throw new SceneError(404, "Аудіо не знайдено.");
    const a = await asset(prisma, res.locals.id, req.params.assetId);
    if (m.role === "DM") return a;
    const state = await audioSnapshot(res.locals.id);
    if (
      state.channels.some(
        (c) => c.voice?.asset.id === a.id || c.outgoing?.asset.id === a.id,
      )
    )
      return a;
    if (
      typeof req.query.cue === "string" &&
      uuid.safeParse(req.query.cue).success &&
      (await prisma.audioCue.findFirst({
        where: {
          id: req.query.cue,
          campaignId: res.locals.id,
          assetId: a.id,
          expiresAt: { gt: new Date() },
        },
      }))
    )
      return a;
    throw new SceneError(404, "Аудіо не знайдено.");
  }
  const a = await allowed();
  if (streaming >= 8)
    throw new SceneError(429, "Зачекайте завершення завантаження аудіо.");
  const range = req.headers.range;
  if (range && !/^bytes=\d*-\d*$/.test(range)) {
    res.status(416).set("Content-Range", `bytes */${a.byteSize}`).end();
    return;
  }
  streaming++;
  const abort = new AbortController(),
    timer = setTimeout(() => abort.abort(), 120000);
  const close = () => abort.abort();
  res.once("close", close);
  try {
    const upstream = await fetch(audioDeliveryUrl(a.storageKey, a.format), {
      headers: range ? { Range: range } : {},
      signal: abort.signal,
    });
    if (upstream.status === 416) {
      res.status(416).set("Content-Range", `bytes */${a.byteSize}`).end();
      return;
    }
    if (!upstream.ok || !upstream.body)
      throw new SceneError(503, "Сховище аудіо тимчасово недоступне.");
    await allowed();
    res
      .status(upstream.status === 206 ? 206 : 200)
      .set({
        "Content-Type": a.mimeType,
        "Cache-Control": "private, no-store",
        "Accept-Ranges": "bytes",
      });
    for (const h of ["content-length", "content-range"]) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    let bytes = 0;
    await pipeline(
      Readable.fromWeb(upstream.body as never),
      new Transform({
        transform(chunk, _encoding, cb) {
          bytes += chunk.length;
          cb(
            bytes > a.byteSize ? Error("Audio response exceeded size") : null,
            chunk,
          );
        },
      }),
      res,
      { signal: abort.signal },
    );
  } catch (e) {
    if (res.headersSent || abort.signal.aborted) res.destroy();
    else if (e instanceof SceneError) throw e;
    else throw new SceneError(503, "Не вдалося завантажити аудіо.");
  } finally {
    clearTimeout(timer);
    res.off("close", close);
    abort.abort();
    streaming--;
  }
});
