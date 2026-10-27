import { EventEmitter } from "node:events";
import type {
  DirectorSnapshot,
  PresentationMaterialView,
  VideoAssetView,
} from "@dnd/shared";
import type {
  PresentationMaterial,
  MediaFile,
  VideoAsset,
  Prisma,
} from "../generated/prisma/client.js";
import { prisma } from "../database/client.js";
export const directorEvents = new EventEmitter();
export function videoView(v: VideoAsset): VideoAssetView {
  return {
    id: v.id,
    name: v.name,
    description: v.description,
    revision: v.revision,
    duration: v.duration,
    width: v.width,
    height: v.height,
    hasAudio: v.hasAudio,
    byteSize: v.byteSize,
    url: `/api/campaigns/${v.campaignId}/director/videos/${v.id}/file`,
  };
}
export async function lockDirector<T>(
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
export async function restorePresentation(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const p = await tx.videoPlayback.findUnique({ where: { campaignId: id } });
  let mode = p?.previousMode ?? "TABLE",
    materialId = p?.previousMaterialId ?? null;
  if (mode === "VIDEO") mode = "TABLE";
  if (mode === "ILLUSTRATION" || mode === "PORTRAIT") {
    const m = materialId
      ? await tx.presentationMaterial.findFirst({
          where: { id: materialId, campaignId: id },
          include: { image: true },
        })
      : null;
    if (!m?.image || m.image.deletedAt) {
      mode = "BLANK";
      materialId = null;
    }
  } else materialId = null;
  await tx.videoPlayback.updateMany({
    where: { campaignId: id },
    data: { status: "STOPPED", position: 0, startedAt: null, assetId: null },
  });
  await tx.campaign.update({
    where: { id },
    data: {
      presentationMode: mode,
      presentationMaterialId: materialId,
      presentationVersion: { increment: 1 },
    },
  });
}
export async function settleVideo(tx: Prisma.TransactionClient, id: string) {
  const c = await tx.campaign.findUniqueOrThrow({
    where: { id },
    include: { videoPlayback: { include: { asset: true } } },
  });
  if (c.presentationMode !== "VIDEO") return false;
  const p = c.videoPlayback,
    a = p?.asset;
  const elapsed =
    p?.status === "PLAYING" && p.startedAt
      ? (Date.now() - p.startedAt.getTime()) / 1000
      : 0;
  if (
    !a ||
    a.deletedAt ||
    a.campaignId !== id ||
    !p ||
    p.status === "STOPPED" ||
    p.position + elapsed >= a.duration
  ) {
    await restorePresentation(tx, id);
    return true;
  }
  return false;
}
export function startVideoRecovery() {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void prisma.campaign
      .findMany({ where: { presentationMode: "VIDEO" }, select: { id: true } })
      .then(async (rows) => {
        for (const c of rows)
          if (await lockDirector(c.id, (tx) => settleVideo(tx, c.id)))
            directorEvents.emit("changed", c.id);
      })
      .catch(() => console.warn("Video recovery deferred."))
      .finally(() => {
        running = false;
      });
  }, 2000);
  timer.unref();
  return () => clearInterval(timer);
}
export function materialView(
  m: PresentationMaterial & { image: MediaFile | null },
): PresentationMaterialView {
  const f = m.image;
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    category: m.category,
    revision: m.revision,
    image:
      f && !f.deletedAt
        ? {
            id: f.id,
            url: `/api/campaigns/${m.campaignId}/director/materials/${m.id}/image/${f.id}`,
            width: f.width,
            height: f.height,
            mimeType: f.mimeType,
            byteSize: f.byteSize,
          }
        : null,
  };
}
export async function directorSnapshot(
  campaignId: string,
): Promise<DirectorSnapshot> {
  return lockDirector(campaignId, async (tx) => {
    const settled = await settleVideo(tx, campaignId);
    if (settled)
      queueMicrotask(() => directorEvents.emit("changed", campaignId));
    const playback = await tx.videoPlayback.findUnique({
      where: { campaignId },
      include: { asset: true },
    });
    const c = await tx.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: { presentationMaterial: { include: { image: true } } },
    });
    if (c.presentationMode === "VIDEO" && playback?.asset)
      return {
        version: c.presentationVersion,
        mode: "VIDEO",
        material: null,
        serverTime: Date.now(),
        video: {
          asset: videoView(playback.asset),
          status: playback.status,
          position: playback.position,
          startedAt: playback.startedAt?.getTime() ?? null,
          duckMusic: playback.duckMusic,
          duckAmbience: playback.duckAmbience,
        },
      };
    if (c.presentationMode === "TABLE" || c.presentationMode === "BLANK")
      return {
        version: c.presentationVersion,
        mode: c.presentationMode,
        material: null,
      };
    const m = c.presentationMaterial;
    if (!m || m.campaignId !== c.id || !m.image || m.image.deletedAt)
      return { version: c.presentationVersion, mode: "BLANK", material: null };
    return {
      version: c.presentationVersion,
      mode: c.presentationMode,
      material: materialView(m),
    };
  });
}
