import type { Request, Response } from "express";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { SceneError } from "../scenes/state.js";
// Shared bounded streaming for authenticated audio and Director video. Never redirects signed URLs.
let streaming = 0;
export async function streamMedia(
  req: Request,
  res: Response,
  file: { byteSize: number; mimeType: string },
  url: () => string,
  allowed: () => Promise<unknown>,
) {
  const range = req.headers.range;
  let start = 0,
    end = file.byteSize - 1;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    let valid = Boolean(m && (m[1] || m[2]));
    if (m) {
      if (m[1]) {
        start = Number(m[1]);
        if (m[2]) end = Math.min(end, Number(m[2]));
      } else {
        const suffix = Number(m[2]);
        start = Math.max(0, file.byteSize - suffix);
        valid &&= suffix > 0;
      }
    }
    if (
      !valid ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end ||
      start >= file.byteSize
    ) {
      res.status(416).set("Content-Range", `bytes */${file.byteSize}`).end();
      return;
    }
  }
  if (streaming >= 16)
    throw new SceneError(429, "Зачекайте завершення завантаження медіа.");
  res.set({
    "Content-Type": file.mimeType,
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
  });
  if (req.method === "HEAD") {
    res.set("Content-Length", String(file.byteSize)).end();
    return;
  }
  streaming++;
  const abort = new AbortController(),
    timer = setTimeout(() => abort.abort(), 120000),
    close = () => abort.abort();
  res.once("close", close);
  try {
    const upstream = await fetch(url(), {
      headers: range ? { Range: `bytes=${start}-${end}` } : {},
      signal: abort.signal,
    });
    if (!upstream.ok || !upstream.body)
      throw new SceneError(
        503,
        "Медіафайл тимчасово недоступний. Спробуйте ще раз.",
      );
    if (
      range &&
      (upstream.status !== 206 ||
        upstream.headers.get("content-range") !==
          `bytes ${start}-${end}/${file.byteSize}`)
    )
      throw new SceneError(
        503,
        "Не вдалося завантажити фрагмент медіа. Повторіть спробу.",
      );
    const length = range ? end - start + 1 : file.byteSize;
    if (Number(upstream.headers.get("content-length")) !== length)
      throw new SceneError(503, "Некоректна відповідь медіасховища.");
    await allowed();
    res.status(range ? 206 : 200).set("Content-Length", String(length));
    if (range)
      res.set("Content-Range", `bytes ${start}-${end}/${file.byteSize}`);
    let received = 0;
    await pipeline(
      Readable.fromWeb(upstream.body as never),
      new Transform({
        transform(chunk, _encoding, cb) {
          received += chunk.length;
          cb(received > length ? Error("Media size") : null, chunk);
        },
        flush(cb) {
          cb(received !== length ? Error("Incomplete media") : null);
        },
      }),
      res,
      { signal: abort.signal },
    );
  } catch (e) {
    if (res.headersSent || abort.signal.aborted) res.destroy();
    else if (e instanceof SceneError) throw e;
    else throw new SceneError(503, "Не вдалося завантажити медіа.");
  } finally {
    clearTimeout(timer);
    res.off("close", close);
    abort.abort();
    streaming--;
  }
}
