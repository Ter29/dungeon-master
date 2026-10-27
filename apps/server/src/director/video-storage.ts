import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { configure } from "../scenes/storage.js";
import { SceneError } from "../scenes/state.js";
import { prisma } from "../database/client.js";
import { destroyAudio } from "../audio/storage.js";
function limit(key: string, fallback: number, max: number) {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isInteger(n) || n < 1 || n > max) throw Error(`Invalid ${key}`);
  return n;
}
export const videoLimits = {
  maxBytes: limit("VIDEO_MAX_BYTES", 25 * 1024 * 1024, 50 * 1024 * 1024),
  maxDuration: limit("VIDEO_MAX_SECONDS", 180, 600),
  maxAssets: limit("VIDEO_MAX_ASSETS", 20, 100),
  campaignBytes: limit(
    "VIDEO_CAMPAIGN_BYTES",
    150 * 1024 * 1024,
    1024 * 1024 * 1024,
  ),
};
type Box = { type: string; start: number; end: number };
// Bounded ISO BMFF inspection; no subprocess, transcoding or external references.
function boxes(b: Buffer, start = 0, end = b.length): Box[] {
  const out: Box[] = [];
  while (start < end) {
    if (out.length > 4096 || start + 8 > end) throw Error("box");
    const size = b.readUInt32BE(start),
      type = b.toString("ascii", start + 4, start + 8);
    let header = 8,
      n = size;
    if (size === 1) {
      if (start + 16 > end) throw Error("box");
      const big = b.readBigUInt64BE(start + 8);
      if (big > BigInt(b.length)) throw Error("box");
      n = Number(big);
      header = 16;
    }
    if (size === 0) n = end - start;
    if (n < header || start + n > end) throw Error("box");
    out.push({ type, start: start + header, end: start + n });
    start += n;
  }
  return out;
}
export function inspectVideo(b: Buffer) {
  if (b.length > videoLimits.maxBytes)
    throw new SceneError(413, "Відео перевищує ліміт розміру.");
  try {
    const top = boxes(b),
      moov = top.find((x) => x.type === "moov");
    if (
      !moov ||
      !top.some((x) => x.type === "ftyp") ||
      !top.some((x) => x.type === "mdat") ||
      top.some((x) => x.type === "moof")
    )
      throw Error("container");
    const children = boxes(b, moov.start, moov.end);
    let duration = 0,
      width = 0,
      height = 0,
      video = 0,
      audio = 0;
    for (const trak of children.filter((x) => x.type === "trak")) {
      const mdia = boxes(b, trak.start, trak.end).find(
        (x) => x.type === "mdia",
      );
      if (!mdia) throw Error("track");
      const md = boxes(b, mdia.start, mdia.end),
        handler = md.find((x) => x.type === "hdlr"),
        header = md.find((x) => x.type === "mdhd"),
        minf = md.find((x) => x.type === "minf");
      if (!handler || !header || !minf || handler.start + 12 > handler.end)
        throw Error("track");
      const kind = b.toString("ascii", handler.start + 8, handler.start + 12);
      if (!["vide", "soun"].includes(kind)) throw Error("unsupported track");
      const h = header.start,
        v = b[h];
      if (v !== 0 && v !== 1) throw Error("version");
      if (header.end - h < (v ? 32 : 20)) throw Error("header");
      const scale = b.readUInt32BE(h + (v ? 20 : 12)),
        ticks = v ? Number(b.readBigUInt64BE(h + 24)) : b.readUInt32BE(h + 16);
      if (!scale || !ticks || !Number.isFinite(ticks / scale))
        throw Error("duration");
      duration = Math.max(duration, ticks / scale);
      const dinf = boxes(b, minf.start, minf.end).find(
        (x) => x.type === "dinf",
      );
      if (!dinf) throw Error("references");
      const dref = boxes(b, dinf.start, dinf.end).find(
        (x) => x.type === "dref",
      );
      if (
        !dref ||
        dref.end - dref.start < 8 ||
        b.readUInt32BE(dref.start + 4) !== 1
      )
        throw Error("references");
      const references = boxes(b, dref.start + 8, dref.end),
        reference = references[0];
      if (
        references.length !== 1 ||
        !reference ||
        reference.type !== "url " ||
        reference.end - reference.start !== 4 ||
        (b.readUInt32BE(reference.start) & 0xffffff) !== 1
      )
        throw Error("external reference");
      const stbl = boxes(b, minf.start, minf.end).find(
        (x) => x.type === "stbl",
      );
      if (!stbl) throw Error("samples");
      const stsd = boxes(b, stbl.start, stbl.end).find(
        (x) => x.type === "stsd",
      );
      if (!stsd || b.readUInt32BE(stsd.start + 4) !== 1) throw Error("samples");
      const entries = boxes(b, stsd.start + 8, stsd.end);
      if (entries.length !== 1) throw Error("entry");
      const entry = entries[0]!;
      if (kind === "vide") {
        if (entry.type !== "avc1" || entry.start + 78 > entry.end)
          throw Error("H264");
        width = b.readUInt16BE(entry.start + 24);
        height = b.readUInt16BE(entry.start + 26);
        const config = boxes(b, entry.start + 78, entry.end).find(
          (x) => x.type === "avcC",
        );
        if (
          !config ||
          config.end - config.start < 7 ||
          b[config.start] !== 1 ||
          ![66, 77, 100].includes(b[config.start + 1]!)
        )
          throw Error("H264");
        video++;
      } else {
        if (
          entry.type !== "mp4a" ||
          entry.start + 28 > entry.end ||
          b.readUInt16BE(entry.start + 16) > 2
        )
          throw Error("AAC");
        if (
          !boxes(b, entry.start + 28, entry.end).some((x) => x.type === "esds")
        )
          throw Error("AAC");
        audio++;
      }
    }
    if (
      video !== 1 ||
      audio > 1 ||
      width < 16 ||
      height < 16 ||
      width > 1920 ||
      height > 1080 ||
      duration < 0.1
    )
      throw Error("limits");
    if (duration > videoLimits.maxDuration)
      throw new SceneError(413, "Відео перевищує дозволену тривалість.");
    return { duration, width, height, hasAudio: audio === 1 };
  } catch (e) {
    if (e instanceof SceneError) throw e;
    throw new SceneError(
      415,
      "Потрібен MP4 з H.264 (Baseline/Main/High) та AAC, до 1920×1080. Файл пошкоджений або несумісний.",
    );
  }
}
export async function uploadVideo(
  key: string,
  bytes: Buffer,
  expected: ReturnType<typeof inspectVideo>,
) {
  configure();
  let result: UploadApiResponse;
  try {
    result = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            public_id: key,
            resource_type: "video",
            type: "authenticated",
            overwrite: false,
            timeout: 90000,
          },
          (e, r) => (e || !r ? reject(Error("upload")) : resolve(r)),
        )
        .end(bytes);
    });
  } catch {
    throw new SceneError(503, "Сховище відео недоступне. Спробуйте пізніше.");
  }
  if (
    result.format !== "mp4" ||
    result.video?.codec !== "h264" ||
    (expected.hasAudio && result.audio?.codec !== "aac") ||
    Math.abs(Number(result.duration) - expected.duration) > 1 ||
    result.width !== expected.width ||
    result.height !== expected.height
  )
    throw new SceneError(
      415,
      "Сховище не підтвердило формат H.264/AAC або тривалість відео.",
    );
}
export async function cleanupVideo(id?: string) {
  const rows = await prisma.videoAsset.findMany({
    where: {
      deletedAt: id ? { not: null } : { lt: new Date(Date.now() - 3600000) },
      ...(id ? { id } : {}),
    },
    take: 20,
  });
  for (const row of rows)
    try {
      await destroyAudio(row.storageKey);
      await prisma.videoAsset.deleteMany({
        where: { id: row.id, deletedAt: { not: null } },
      });
    } catch {
      console.warn("Video cleanup deferred.");
    }
}
