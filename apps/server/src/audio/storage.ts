import { parseBuffer } from "music-metadata";
import { v2 as cloudinary } from "cloudinary";
import { configure } from "../scenes/storage.js";
import { SceneError } from "../scenes/state.js";
import { prisma } from "../database/client.js";

function limit(name: string, fallback: number, min: number, max: number) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(n) || n < min || n > max) throw Error(`Invalid ${name}`);
  return Math.floor(n);
}
export const audioLimits = {
  maxBytes: limit("AUDIO_MAX_BYTES", 20 * 1024 * 1024, 1024, 50 * 1024 * 1024),
  maxDuration: limit("AUDIO_MAX_SECONDS", 1800, 1, 7200),
  maxSfxDuration: limit("AUDIO_SFX_MAX_SECONDS", 30, 1, 120),
  maxAssets: limit("AUDIO_MAX_ASSETS", 100, 1, 500),
  campaignBytes: limit(
    "AUDIO_CAMPAIGN_BYTES",
    250 * 1024 * 1024,
    1024,
    2 * 1024 * 1024 * 1024,
  ),
};
export async function inspectAudio(bytes: Buffer, category: string) {
  if (bytes.length > audioLimits.maxBytes)
    throw new SceneError(413, "Аудіофайл перевищує ліміт завантаження.");
  try {
    const m = await parseBuffer(bytes, undefined, {
      duration: true,
      skipCovers: true,
    });
    const container = m.format.container ?? "";
    const format =
      container === "WAVE"
        ? "wav"
        : container === "MPEG" && m.format.codec?.includes("Layer 3")
          ? "mp3"
          : container === "Ogg" && /Vorbis|Opus/i.test(m.format.codec ?? "")
            ? "ogg"
            : null;
    const magic =
      format === "wav"
        ? bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WAVE"
        : format === "ogg"
          ? bytes.subarray(0, 4).toString() === "OggS"
          : format === "mp3";
    const duration = m.format.duration;
    if (
      !format ||
      !magic ||
      !duration ||
      !Number.isFinite(duration) ||
      duration < 0.05 ||
      !m.format.sampleRate ||
      !m.format.numberOfChannels ||
      m.format.numberOfChannels > 2
    )
      throw Error("format");
    if (format === "wav" && !/PCM|IEEE_FLOAT/i.test(m.format.codec ?? ""))
      throw Error("codec");
    if (
      duration >
      (category === "SFX"
        ? audioLimits.maxSfxDuration
        : audioLimits.maxDuration)
    )
      throw new SceneError(413, "Аудіо перевищує дозволену тривалість.");
    return {
      format,
      mimeType:
        format === "mp3"
          ? "audio/mpeg"
          : format === "ogg"
            ? "audio/ogg"
            : "audio/wav",
      duration,
    };
  } catch (error) {
    if (error instanceof SceneError) throw error;
    throw new SceneError(
      415,
      "Потрібен справжній MP3, OGG (Vorbis/Opus) або WAV (PCM), моно чи стерео.",
    );
  }
}
export async function uploadAudio(key: string, bytes: Buffer) {
  configure();
  try {
    await new Promise<void>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: key,
          resource_type: "video",
          type: "authenticated",
          overwrite: false,
          timeout: 60000,
        },
        (error, result) =>
          error || !result ? reject(Error("upload")) : resolve(),
      );
      stream.end(bytes);
    });
  } catch {
    throw new SceneError(503, "Сховище аудіо недоступне. Спробуйте пізніше.");
  }
}
export function audioDeliveryUrl(key: string, format: string) {
  configure();
  return cloudinary.url(key, {
    resource_type: "video",
    type: "authenticated",
    sign_url: true,
    secure: true,
    format,
  });
}
export async function destroyAudio(key: string) {
  configure();
  const r = await cloudinary.uploader.destroy(key, {
    resource_type: "video",
    type: "authenticated",
    invalidate: true,
  });
  if (!["ok", "not found"].includes(r.result))
    throw Error("Audio cleanup failed");
}
export async function cleanupAudio(id?: string) {
  const rows = await prisma.audioAsset.findMany({
    where: {
      deletedAt: id ? { not: null } : { lt: new Date(Date.now() - 3600000) },
      ...(id ? { id } : {}),
    },
    take: 20,
  });
  for (const row of rows)
    try {
      await destroyAudio(row.storageKey);
      await prisma.audioAsset.deleteMany({
        where: { id: row.id, deletedAt: { not: null } },
      });
    } catch {
      console.warn("Audio cleanup deferred.");
    }
}
