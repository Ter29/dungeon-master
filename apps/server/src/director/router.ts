import { Router, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../database/client.js";
import { sessionUser } from "../auth/router.js";
import { appOrigin } from "../config/app.js";
import { SceneError } from "../scenes/state.js";
import {
  imageUploadSlot,
  MAX_IMAGE_BYTES,
  storageAvailable,
  normalizeImage,
  uploadImage,
  readImage,
  cleanupMedia,
} from "../scenes/storage.js";
import { directorEvents, directorSnapshot, materialView } from "./state.js";
import { videoRouter } from "./video-router.js";
export const directorRouter = Router({ mergeParams: true });
const uuid = z.string().uuid(),
  revision = z.number().int().min(0),
  fields = z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(4000).default(""),
    category: z.enum(["LOCATION", "NPC", "EVENT"]),
  });
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const value = schema.safeParse(body);
  if (!value.success)
    throw new SceneError(
      400,
      "Перевірте матеріал, режим та версію презентації.",
    );
  return value.data;
}
directorRouter.use(async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const user = await sessionUser(req);
  if (!user) throw new SceneError(401, "Увійдіть до облікового запису.");
  const campaignId = parse(uuid, req.params.campaignId);
  const member = await prisma.campaignMember.findUnique({
    where: { campaignId_userId: { campaignId, userId: user.id } },
  });
  if (!member) throw new SceneError(404, "Кампанію не знайдено.");
  res.locals.member = member;
  res.locals.campaignId = campaignId;
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
    throw new SceneError(403, "Керувати подачею може лише DM.");
  next();
};
const limit = rateLimit({
  windowMs: 15 * 60000,
  limit: 600,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Забагато змін презентації. Зачекайте." },
});
const uploadLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Забагато завантажень. Зачекайте." },
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
async function material(
  tx: Prisma.TransactionClient,
  campaignId: string,
  id: unknown,
  expected?: number,
) {
  if (!uuid.safeParse(id).success)
    throw new SceneError(404, "Матеріал не знайдено.");
  const m = await tx.presentationMaterial.findFirst({
    where: { id: String(id), campaignId },
    include: { image: true },
  });
  if (!m) throw new SceneError(404, "Матеріал не знайдено.");
  if (expected !== undefined && m.revision !== expected)
    throw new SceneError(
      409,
      "Матеріал змінився. Оновіть вибір або форму та перегляньте його ще раз.",
    );
  return m;
}
async function isActive(
  tx: Prisma.TransactionClient,
  campaignId: string,
  id: string,
) {
  return Boolean(
    await tx.campaign.findFirst({
      where: {
        id: campaignId,
        presentationMaterialId: id,
        presentationMode: { in: ["ILLUSTRATION", "PORTRAIT"] },
      },
      select: { id: true },
    }),
  );
}
function notify(id: string, library = false) {
  directorEvents.emit("changed", id, library);
}
directorRouter.get("/state", async (_req, res) =>
  res.json(await directorSnapshot(res.locals.campaignId)),
);
directorRouter.use(videoRouter);
directorRouter.patch("/state", dm, limit, async (req, res) => {
  const data = parse(
    z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("TABLE"), version: revision }).strict(),
      z.object({ mode: z.literal("BLANK"), version: revision }).strict(),
      z
        .object({
          mode: z.literal("ILLUSTRATION"),
          version: revision,
          materialId: uuid,
          materialRevision: revision,
        })
        .strict(),
      z
        .object({
          mode: z.literal("PORTRAIT"),
          version: revision,
          materialId: uuid,
          materialRevision: revision,
        })
        .strict(),
    ]),
    req.body,
  );
  await locked(res.locals.campaignId, async (tx) => {
    const c = await tx.campaign.findUniqueOrThrow({
      where: { id: res.locals.campaignId },
    });
    if (c.presentationVersion !== data.version)
      throw new SceneError(
        409,
        "Подача вже змінилася. Оновлено до актуального стану; повторіть дію.",
      );
    let id: string | null = null;
    if ("materialId" in data) {
      const m = await material(
        tx,
        c.id,
        data.materialId,
        data.materialRevision,
      );
      if (!m.image || m.image.deletedAt)
        throw new SceneError(400, "Спочатку завантажте зображення.");
      id = m.id;
    }
    await tx.videoPlayback.updateMany({
      where: { campaignId: c.id },
      data: { assetId: null, status: "STOPPED", position: 0, startedAt: null },
    });
    await tx.campaign.update({
      where: { id: c.id },
      data: {
        presentationMode: data.mode,
        presentationMaterialId: id,
        presentationVersion: { increment: 1 },
      },
    });
  });
  notify(res.locals.campaignId);
  res.json(await directorSnapshot(res.locals.campaignId));
});
directorRouter.get("/materials", dm, async (_req, res) => {
  const materials = await prisma.presentationMaterial.findMany({
    where: { campaignId: res.locals.campaignId },
    include: { image: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  res.json({
    materials: materials.map(materialView),
    storageAvailable: storageAvailable(),
  });
});
directorRouter.post("/materials", dm, limit, async (req, res) => {
  const data = parse(fields.strict(), req.body);
  const m = await locked(res.locals.campaignId, async (tx) => {
    if (
      (await tx.presentationMaterial.count({
        where: { campaignId: res.locals.campaignId },
      })) >= 100
    )
      throw new SceneError(
        400,
        "Ліміт: 100 презентаційних матеріалів на кампанію.",
      );
    return tx.presentationMaterial.create({
      data: { ...data, campaignId: res.locals.campaignId },
      include: { image: true },
    });
  });
  notify(m.campaignId, true);
  res.status(201).json({ material: materialView(m) });
});
directorRouter.get("/materials/:materialId", dm, async (req, res) => {
  res.json({
    material: materialView(
      await material(prisma, res.locals.campaignId, req.params.materialId),
    ),
  });
});
directorRouter.patch("/materials/:materialId", dm, limit, async (req, res) => {
  const data = parse(
    fields
      .partial()
      .extend({ description: z.string().trim().max(4000).optional(), revision })
      .strict(),
    req.body,
  );
  const m = await locked(res.locals.campaignId, async (tx) => {
    const old = await material(
      tx,
      res.locals.campaignId,
      req.params.materialId,
      data.revision,
    );
    const { revision: _, ...update } = data;
    const result = await tx.presentationMaterial.update({
      where: { id: old.id },
      data: { ...update, revision: { increment: 1 } },
      include: { image: true },
    });
    if (await isActive(tx, old.campaignId, old.id))
      await tx.campaign.update({
        where: { id: old.campaignId },
        data: { presentationVersion: { increment: 1 } },
      });
    return result;
  });
  notify(m.campaignId, true);
  res.json({ material: materialView(m) });
});
directorRouter.delete("/materials/:materialId", dm, limit, async (req, res) => {
  const data = parse(z.object({ revision }).strict(), req.body);
  const image = await locked(res.locals.campaignId, async (tx) => {
    const m = await material(
      tx,
      res.locals.campaignId,
      req.params.materialId,
      data.revision,
    );
    await tx.campaign.updateMany({
      where: { id: m.campaignId, presentationMaterialId: m.id },
      data: {
        presentationMode: "BLANK",
        presentationMaterialId: null,
        presentationVersion: { increment: 1 },
      },
    });
    await tx.presentationMaterial.delete({ where: { id: m.id } });
    if (m.imageId)
      await tx.mediaFile.update({
        where: { id: m.imageId },
        data: { deletedAt: new Date() },
      });
    return m.imageId;
  });
  notify(res.locals.campaignId, true);
  res.status(204).end();
  if (image) void cleanupMedia(image).catch(() => {});
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: 1,
    fields: 1,
    fieldSize: 32,
    parts: 2,
  },
  fileFilter: (_req, file, done) => {
    if (!["image/png", "image/jpeg"].includes(file.mimetype))
      done(new SceneError(415, "Дозволено лише PNG/JPG."));
    else done(null, true);
  },
});
directorRouter.post(
  "/materials/:materialId/image",
  dm,
  uploadLimit,
  async (req, res, next) => {
    await material(prisma, res.locals.campaignId, req.params.materialId);
    next();
  },
  imageUploadSlot,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) throw new SceneError(400, "Оберіть PNG/JPG-файл.");
    const rev = parse(z.coerce.number().int().min(0), req.body?.revision),
      old = await material(
        prisma,
        res.locals.campaignId,
        req.params.materialId,
        rev,
      );
    if (await isActive(prisma, old.campaignId, old.id))
      throw new SceneError(
        409,
        "Спочатку приховайте активний матеріал перед заміною зображення.",
      );
    const image = await normalizeImage(req.file.buffer, req.file.mimetype);
    const file = await prisma.mediaFile.create({
      data: {
        campaignId: old.campaignId,
        storageKey: `dungeon-master/${old.campaignId}/${randomUUID()}`,
        format: image.format,
        mimeType: image.mimeType,
        byteSize: image.data.length,
        width: image.width,
        height: image.height,
        deletedAt: new Date(),
      },
    });
    await uploadImage(file.storageKey, image.data);
    const result = await locked(old.campaignId, async (tx) => {
      const current = await material(tx, old.campaignId, old.id, rev);
      if (await isActive(tx, current.campaignId, current.id))
        throw new SceneError(
          409,
          "Матеріал вже показано. Приховайте його та повторіть завантаження.",
        );
      await tx.mediaFile.update({
        where: { id: file.id },
        data: { deletedAt: null },
      });
      const updated = await tx.presentationMaterial.update({
        where: { id: current.id },
        data: { imageId: file.id, revision: { increment: 1 } },
        include: { image: true },
      });
      if (current.imageId)
        await tx.mediaFile.update({
          where: { id: current.imageId },
          data: { deletedAt: new Date() },
        });
      return { updated, oldId: current.imageId };
    });
    notify(old.campaignId, true);
    res.json({ material: materialView(result.updated) });
    if (result.oldId) void cleanupMedia(result.oldId).catch(() => {});
  },
);
directorRouter.get(
  "/materials/:materialId/image/:mediaId",
  async (req, res) => {
    async function allowed() {
      const user = await sessionUser(req);
      if (!user) throw new SceneError(404, "Зображення не знайдено.");
      const member = await prisma.campaignMember.findUnique({
        where: {
          campaignId_userId: {
            campaignId: res.locals.campaignId,
            userId: user.id,
          },
        },
      });
      if (!member) throw new SceneError(404, "Зображення не знайдено.");
      const m = await material(
        prisma,
        res.locals.campaignId,
        req.params.materialId,
      );
      if (member.role !== "DM" && !(await isActive(prisma, m.campaignId, m.id)))
        throw new SceneError(404, "Зображення не знайдено.");
      if (!m.image || m.image.deletedAt || m.image.id !== req.params.mediaId)
        throw new SceneError(404, "Зображення не знайдено.");
      return m.image;
    }
    const file = await allowed(),
      bytes = await readImage(file.storageKey, file.format);
    await allowed();
    res.set({
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    });
    res.end(bytes);
  },
);
