import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { normalizeImage, uploadImage, readImage, destroyImage } from '../src/scenes/storage.js';
import { prisma } from '../src/database/client.js';
const key = `dungeon-master/checks/${randomUUID()}`;
try {
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#865929' } }).png().toBuffer();
  const image = await normalizeImage(png, 'image/png');
  await uploadImage(key, image.data);
  const downloaded = await readImage(key, 'png');
  assert.ok(downloaded.equals(image.data));
  const cloud = new URL(process.env.CLOUDINARY_URL!).hostname;
  const unsigned = await fetch(`https://res.cloudinary.com/${cloud}/image/authenticated/${key}.png`, { signal: AbortSignal.timeout(15000) });
  assert.ok([401, 403, 404].includes(unsigned.status));
  console.log('PASS: real Cloudinary authenticated upload, signed server-side download, byte equality, unsigned access denied.');
} catch { console.error('FAIL: storage integration; check Cloudinary credentials and authenticated delivery settings.'); process.exitCode = 1; }
finally {
  try { await destroyImage(key); console.log('Temporary Cloudinary image removed.'); }
  catch { console.error('Temporary asset cleanup failed; rerun cleanup for this check.'); process.exitCode = 1; }
  await prisma.$disconnect();
}
