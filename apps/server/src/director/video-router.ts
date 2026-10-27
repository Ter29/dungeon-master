import { Router, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import multer, { MulterError } from "multer";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../database/client.js";
import { sessionUser } from "../auth/router.js";
import { SceneError } from "../scenes/state.js";
import { imageUploadSlot, storageAvailable } from "../scenes/storage.js";
import { audioDeliveryUrl } from "../audio/storage.js";
import { streamMedia } from "../media/stream.js";
import {
  videoLimits,
  inspectVideo,
  uploadVideo,
  cleanupVideo,
} from "./video-storage.js";
import {
  videoView,
  directorEvents,
  directorSnapshot,
  lockDirector,
  restorePresentation,
  settleVideo,
} from "./state.js";
import type { Prisma } from "../generated/prisma/client.js";
export const videoRouter = Router({ mergeParams: true });
const uuid = z.string().uuid(),
  revision = z.number().int().min(0),
  gain = z.number().min(0).max(1),
  fields = z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(""),
  });
function parse<T>(s: z.ZodType<T>, v: unknown): T {
  const r = s.safeParse(v);
  if (!r.success)
    throw new SceneError(400, "Перевірте відео, команду та версію.");
  return r.data;
}
const dm: RequestHandler = (_req, res, next) => {
  if (res.locals.member.role !== "DM")
    throw new SceneError(403, "Керувати відео може лише DM.");
  next();
};
const commands = rateLimit({
    windowMs: 60000,
    limit: 90,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Забагато відеокоманд." },
  }),
  uploads = rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Забагато завантажень відео." },
  }),
  reads = rateLimit({
    windowMs: 60000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Забагато запитів відео." },
  });
async function asset(
  tx: Prisma.TransactionClient,
  id: string,
  key: unknown,
  rev?: number,
) {
  if (!uuid.safeParse(key).success)
    throw new SceneError(404, "Відео не знайдено.");
  const v = await tx.videoAsset.findFirst({
    where: { id: String(key), campaignId: id, deletedAt: null },
  });
  if (!v) throw new SceneError(404, "Відео не знайдено.");
  if (rev !== undefined && v.revision !== rev)
    throw new SceneError(409, "Відео змінилося. Оновіть бібліотеку.");
  return v;
}
videoRouter.get("/videos", dm, async (_req, res) =>
  res.json({
    videos: (
      await prisma.videoAsset.findMany({
        where: { campaignId: res.locals.campaignId, deletedAt: null },
        orderBy: { createdAt: "asc" },
      })
    ).map(videoView),
    storageAvailable: storageAvailable(),
    limits: videoLimits,
  }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: videoLimits.maxBytes,
    files: 1,
    fields: 2,
    fieldSize: 2200,
    parts: 3,
  },
  fileFilter: (_req, f, done) =>
    f.mimetype === "video/mp4"
      ? done(null, true)
      : done(new SceneError(415, "Дозволено лише MP4 H.264/AAC.")),
});
const multipart: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (e) =>
    next(
      e instanceof MulterError
        ? new SceneError(
            e.code === "LIMIT_FILE_SIZE" ? 413 : 400,
            "Файл перевищує ліміт або має некоректні поля.",
          )
        : e,
    ),
  );
};
videoRouter.post(
  "/videos",
  dm,
  uploads,
  imageUploadSlot,
  multipart,
  async (req, res) => {
    if (!req.file) throw new SceneError(400, "Оберіть MP4-файл.");
    const data = parse(fields.strict(), req.body),
      info = inspectVideo(req.file.buffer),
      id = res.locals.campaignId as string;
    const row = await lockDirector(id, async (tx) => {
      const quota = await tx.videoAsset.aggregate({
        where: { campaignId: id },
        _count: true,
        _sum: { byteSize: true },
      });
      if (
        quota._count >= videoLimits.maxAssets ||
        (quota._sum.byteSize ?? 0) + req.file!.size > videoLimits.campaignBytes
      )
        throw new SceneError(413, "Вичерпано ліміт відеобібліотеки кампанії.");
      return tx.videoAsset.create({
        data: {
          ...data,
          ...info,
          campaignId: id,
          byteSize: req.file!.size,
          storageKey: `dungeon-master/${id}/video/${randomUUID()}`,
          deletedAt: new Date(),
        },
      });
    });
    try {
      await uploadVideo(row.storageKey, req.file.buffer, info);
      const ready = await prisma.videoAsset.update({
        where: { id: row.id },
        data: { deletedAt: null },
      });
      directorEvents.emit("changed", id, true);
      res.status(201).json({ video: videoView(ready) });
    } catch (e) {
      void cleanupVideo(row.id).catch(() => {});
      throw e;
    }
  },
);
videoRouter.patch("/videos/:videoId", dm, commands, async (req, res) => {
  const data = parse(
      fields
        .partial()
        .extend({
          description: z.string().trim().max(2000).optional(),
          revision,
        })
        .strict(),
      req.body,
    ),
    id = res.locals.campaignId as string;
  const v = await lockDirector(id, async (tx) => {
    const old = await asset(tx, id, req.params.videoId, data.revision),
      { revision: _, ...changes } = data;
    const result = await tx.videoAsset.update({
      where: { id: old.id },
      data: { ...changes, revision: { increment: 1 } },
    });
    if (
      await tx.videoPlayback.findFirst({
        where: { campaignId: id, assetId: old.id, status: { not: "STOPPED" } },
      })
    )
      await tx.campaign.update({
        where: { id },
        data: { presentationVersion: { increment: 1 } },
      });
    return result;
  });
  directorEvents.emit("changed", id, true);
  res.json({ video: videoView(v) });
});
videoRouter.delete("/videos/:videoId", dm, commands, async (req, res) => {
  const data = parse(z.object({ revision }).strict(), req.body),
    id = res.locals.campaignId as string;
  const v = await lockDirector(id, async (tx) => {
    const old = await asset(tx, id, req.params.videoId, data.revision);
    if (
      await tx.videoPlayback.findFirst({
        where: { campaignId: id, assetId: old.id },
      })
    )
      await restorePresentation(tx, id);
    return tx.videoAsset.update({
      where: { id: old.id },
      data: { deletedAt: new Date(), revision: { increment: 1 } },
    });
  });
  directorEvents.emit("changed", id, true);
  res.status(204).end();
  void cleanupVideo(v.id).catch(() => {});
});
videoRouter.post("/video", dm, commands, async (req, res) => {
  const data = parse(
      z.discriminatedUnion("action", [
        z
          .object({
            action: z.literal("PLAY"),
            version: revision,
            videoId: uuid,
            revision,
            duckMusic: gain.default(0.25),
            duckAmbience: gain.default(0.25),
          })
          .strict(),
        z
          .object({
            action: z.enum(["PAUSE", "RESUME", "STOP", "RETURN"]),
            version: revision,
          })
          .strict(),
      ]),
      req.body,
    ),
    id = res.locals.campaignId as string;
  // Commit overdue recovery before a version conflict, so a retry never revives an expired clip.
  await directorSnapshot(id);
  await lockDirector(id, async (tx) => {
    const c = await tx.campaign.findUniqueOrThrow({ where: { id } });
    if (c.presentationVersion !== data.version)
      throw new SceneError(
        409,
        "Подача вже змінилася. Оновіть стан і повторіть дію.",
      );
    if (data.action === "PLAY") {
      const v = await asset(tx, id, data.videoId, data.revision);
      const prior =
        c.presentationMode !== "VIDEO"
          ? {
              previousMode: c.presentationMode,
              previousMaterialId: c.presentationMaterialId,
            }
          : {};
      await tx.videoPlayback.upsert({
        where: { campaignId: id },
        create: {
          campaignId: id,
          assetId: v.id,
          status: "PLAYING",
          startedAt: new Date(),
          duckMusic: data.duckMusic,
          duckAmbience: data.duckAmbience,
          ...prior,
        },
        update: {
          assetId: v.id,
          status: "PLAYING",
          position: 0,
          startedAt: new Date(),
          duckMusic: data.duckMusic,
          duckAmbience: data.duckAmbience,
          ...prior,
        },
      });
      await tx.campaign.update({
        where: { id },
        data: {
          presentationMode: "VIDEO",
          presentationMaterialId: null,
          presentationVersion: { increment: 1 },
        },
      });
      return;
    }
    const p = await tx.videoPlayback.findUnique({ where: { campaignId: id } });
    if (c.presentationMode !== "VIDEO" || !p?.assetId)
      throw new SceneError(409, "Активної відеосцени немає.");
    if (data.action === "STOP" || data.action === "RETURN") {
      await restorePresentation(tx, id);
      return;
    }
    if (data.action === "PAUSE" && p.status === "PLAYING")
      await tx.videoPlayback.update({
        where: { campaignId: id },
        data: {
          status: "PAUSED",
          position:
            p.position +
            (p.startedAt
              ? Math.max(0, Date.now() - p.startedAt.getTime()) / 1000
              : 0),
          startedAt: null,
        },
      });
    else if (data.action === "RESUME" && p.status === "PAUSED")
      await tx.videoPlayback.update({
        where: { campaignId: id },
        data: { status: "PLAYING", startedAt: new Date() },
      });
    else
      throw new SceneError(
        409,
        "Цю команду вже застосовано або стан змінився.",
      );
    await tx.campaign.update({
      where: { id },
      data: { presentationVersion: { increment: 1 } },
    });
  });
  directorEvents.emit("changed", id);
  res.json(await directorSnapshot(id));
});
videoRouter.get("/videos/:videoId/file", reads, async (req, res) => {
  async function allowed() {
    const u = await sessionUser(req);
    if (!u) throw new SceneError(404, "Відео не знайдено.");
    const id = res.locals.campaignId as string,
      m = await prisma.campaignMember.findUnique({
        where: { campaignId_userId: { campaignId: id, userId: u.id } },
      });
    if (!m) throw new SceneError(404, "Відео не знайдено.");
    const a = await asset(prisma, id, req.params.videoId);
    if (m.role !== "DM") {
      const s = await directorSnapshot(id);
      if (s.mode !== "VIDEO" || s.video?.asset.id !== a.id)
        throw new SceneError(404, "Відео не знайдено.");
    }
    return a;
  }
  const a = await allowed();
  await streamMedia(
    req,
    res,
    { byteSize: a.byteSize, mimeType: "video/mp4" },
    () => audioDeliveryUrl(a.storageKey, "mp4"),
    allowed,
  );
});
