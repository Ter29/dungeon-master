import assert from "node:assert/strict";
import { createServer } from "node:http";
import express, { type ErrorRequestHandler } from "express";
import { streamMedia } from "../src/media/stream.js";
import { SceneError } from "../src/scenes/state.js";
const bytes = Buffer.from("synthetic-range-proof");
const upstream = createServer((req, res) => {
  if (req.url === "/outage") {
    res.writeHead(503).end();
    return;
  }
  if (req.url === "/ignore") {
    res.writeHead(200, { "Content-Length": bytes.length }).end(bytes);
    return;
  }
  res
    .writeHead(206, {
      "Content-Length": 3,
      "Content-Range":
        req.url === "/bad" ? "bytes 1-3/999" : `bytes 0-2/${bytes.length}`,
    })
    .end(bytes.subarray(0, 3));
});
const app = express();
let origin = "";
app.get("/:mode", async (req, res) => {
  await streamMedia(
    req,
    res,
    { byteSize: bytes.length, mimeType: "video/mp4" },
    () => origin + "/" + req.params.mode,
    async () => {
      if (req.params.mode === "revoked")
        throw new SceneError(404, "Недоступно.");
    },
  );
});
const handler: ErrorRequestHandler = (e, _req, res, _next) => {
  res
    .status(e instanceof SceneError ? e.status : 500)
    .json({ message: e instanceof SceneError ? e.message : "Помилка." });
};
app.use(handler);
const server = createServer(app);
try {
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (const [mode, status] of [
    ["ok", 206],
    ["outage", 503],
    ["ignore", 503],
    ["bad", 503],
    ["revoked", 404],
  ] as const) {
    const r = await fetch(base + "/" + mode, {
      headers: { Range: "bytes=0-2" },
    });
    assert.equal(r.status, status);
    if (status === 206)
      assert.deepEqual(
        Buffer.from(await r.arrayBuffer()),
        bytes.subarray(0, 3),
      );
    else assert.ok(!(await r.text()).includes(origin));
  }
  const head = await fetch(base + "/ok", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), bytes.length);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  console.log(
    "PASS shared Media proxy: real HTTP 206, upstream outage, ignored/mismatched Range rejected, authorization recheck, HEAD, no provider URL leak.",
  );
} finally {
  server.closeAllConnections();
  upstream.closeAllConnections();
  await Promise.all([
    new Promise((r) => server.close(r)),
    new Promise((r) => upstream.close(r)),
  ]);
}
