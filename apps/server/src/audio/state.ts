import { EventEmitter } from "node:events";
import type {
  AudioAssetView,
  AudioChannelView,
  AudioSnapshot,
  AudioKey,
} from "@dnd/shared";
import { audioPosition, audioFade } from "@dnd/shared";
import type {
  AudioAsset,
  AudioChannel,
  Prisma,
} from "../generated/prisma/client.js";
import { prisma } from "../database/client.js";
export const audioEvents = new EventEmitter();
export const keys: AudioKey[] = ["MUSIC", "AMBIENCE"];
export function assetView(a: AudioAsset): AudioAssetView {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    category: a.category,
    duration: a.duration,
    byteSize: a.byteSize,
    revision: a.revision,
    url: `/api/campaigns/${a.campaignId}/audio/assets/${a.id}/file`,
  };
}
export function channelView(
  key: AudioKey,
  c:
    | (AudioChannel & {
        asset: AudioAsset | null;
        outgoingAsset: AudioAsset | null;
      })
    | undefined,
  now: number,
): AudioChannelView {
  const fade = {
    from: c?.fadeFrom ?? 1,
    to: c?.fadeTo ?? 1,
    at: c?.fadeAt?.getTime() ?? now,
    ms: c?.fadeMs ?? 0,
  };
  let voice =
    c?.asset && !c.asset.deletedAt && c.asset.campaignId === c.campaignId
      ? {
          asset: assetView(c.asset),
          position: c.position,
          startedAt:
            c.status === "PLAYING" ? (c.startedAt?.getTime() ?? null) : null,
          loop: c.loop,
        }
      : null;
  let status = c?.status ?? "STOPPED";
  if (
    !voice ||
    (status === "PLAYING" &&
      ((!voice.loop && audioPosition(voice, now) >= voice.asset.duration) ||
        (fade.to === 0 && now >= fade.at + fade.ms)))
  ) {
    status = "STOPPED";
    voice = null;
  }
  const o = c?.outgoingAsset;
  const outgoing =
    status === "PLAYING" &&
    o &&
    !o.deletedAt &&
    o.campaignId === c.campaignId &&
    fade.ms > 0 &&
    now < fade.at + fade.ms
      ? {
          asset: assetView(o),
          position: c.outgoingPosition,
          startedAt: c.outgoingStartedAt?.getTime() ?? null,
          loop: c.outgoingLoop,
          gain: c.outgoingGain,
        }
      : null;
  return { key, status, voice, volume: c?.volume ?? 1, fade, outgoing };
}
export async function audioSnapshot(
  id: string,
  tx?: Prisma.TransactionClient,
): Promise<AudioSnapshot> {
  if (!tx)
    return prisma.$transaction((inner) => audioSnapshot(id, inner), {
      isolationLevel: "RepeatableRead",
    });
  const c = await tx.campaign.findUniqueOrThrow({
    where: { id },
    select: {
      audioVersion: true,
      audioChannels: { include: { asset: true, outgoingAsset: true } },
    },
  });
  const now = Date.now();
  return {
    version: c.audioVersion,
    serverTime: now,
    channels: keys.map((key) =>
      channelView(
        key,
        c.audioChannels.find((c) => c.key === key),
        now,
      ),
    ),
  };
}
export { audioPosition, audioFade };
