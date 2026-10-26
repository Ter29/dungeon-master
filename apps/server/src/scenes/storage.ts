import type {RequestHandler} from 'express';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
import { prisma } from '../database/client.js';
import { SceneError } from './state.js';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// One shared multipart image slot across scenes, cartography and director.
let imageUploading=false;
export const imageUploadSlot:RequestHandler=(_req,res,next)=>{
 if(!storageAvailable())throw new SceneError(503,'Сховище зображень ще не налаштовано.');
 if(imageUploading)throw new SceneError(429,'Інше зображення ще завантажується. Спробуйте за кілька секунд.');
 imageUploading=true;let released=false;const release=()=>{if(!released){released=true;imageUploading=false;}};
 res.once('finish',release);res.once('close',release);next();
};
sharp.concurrency(1);
sharp.cache({ memory: 16, files: 0, items: 20 });
export function storageAvailable() { return Boolean(process.env.CLOUDINARY_URL); }
export function configure() {
  if (!storageAvailable()) throw new SceneError(503, 'Сховище зображень ще не налаштовано.');
  const url = new URL(process.env.CLOUDINARY_URL!);
  if (url.protocol !== 'cloudinary:' || !url.hostname || !url.username || !url.password) throw new SceneError(503, 'Сховище зображень налаштовано некоректно.');
  cloudinary.config({ cloud_name: url.hostname, api_key: decodeURIComponent(url.username), api_secret: decodeURIComponent(url.password), secure: true,
    timeout: 15000,
    ...(process.env.NODE_ENV === 'test' && process.env.CLOUDINARY_TEST_PREFIX ? { upload_prefix: process.env.CLOUDINARY_TEST_PREFIX } : {}) });
}
export async function normalizeImage(buffer: Buffer, mimeType: string) {
  if (buffer.length > MAX_IMAGE_BYTES) throw new SceneError(413, 'Максимальний розмір — 8 МіБ.');
  try {
    const metadata = await sharp(buffer, { limitInputPixels: 20_000_000, failOn: 'warning' }).metadata();
    if (!['png', 'jpeg'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) throw new SceneError(415, 'Потрібне неанімоване PNG або JPG.');
    const detectedMime = metadata.format === 'png' ? 'image/png' : 'image/jpeg';
    if (mimeType !== detectedMime) throw new SceneError(415, 'Тип файлу не відповідає його вмісту.');
    const pipeline = sharp(buffer, { limitInputPixels: 20_000_000, failOn: 'warning' }).rotate();
    const { data, info } = await (metadata.format === 'png' ? pipeline.png() : pipeline.jpeg({ quality: 92 })).toBuffer({ resolveWithObject: true });
    if (data.length > MAX_IMAGE_BYTES) throw new SceneError(413, 'Оброблене зображення перевищує 8 МіБ.');
    return { data, width: info.width, height: info.height, mimeType: detectedMime, format: metadata.format === 'png' ? 'png' : 'jpg' };
  } catch (error) {
    if (error instanceof SceneError) throw error;
    throw new SceneError(415, 'Файл пошкоджений, не є PNG/JPG або перевищує 20 мегапікселів.');
  }
}
export async function uploadImage(storageKey: string, bytes: Buffer) {
  configure();
  try {
    await new Promise<void>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ public_id: storageKey, resource_type: 'image', type: 'authenticated', overwrite: false, timeout: 30000 },
        (error, result) => error || !result ? reject(new Error('Storage upload failed')) : resolve());
      stream.end(bytes);
    });
  } catch { throw new SceneError(503, 'Не вдалося завантажити файл у сховище. Спробуйте пізніше.'); }
}
export async function destroyImage(storageKey: string) {
  configure();
  const result = await cloudinary.uploader.destroy(storageKey, { resource_type: 'image', type: 'authenticated', invalidate: true });
  if (!['ok', 'not found'].includes(result.result)) throw new Error('Storage deletion failed');
}
export async function readImage(storageKey: string, format: string) {
  configure();
  try {
    const url = cloudinary.utils.private_download_url(storageKey, format, { resource_type: 'image', type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + 60, attachment: false });
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok || !response.body) throw new Error('Download failed');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) { await response.body.cancel().catch(() => {}); throw new Error('Download too large'); }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch { throw new SceneError(503, 'Зображення тимчасово недоступне.'); }
}
export async function cleanupMedia(id?: string) {
  if (!storageAvailable()) return;
  const files = await prisma.mediaFile.findMany({ where: { deletedAt: id ? { not: null } : { lt: new Date(Date.now() - 3600000) }, ...(id ? { id } : {}) }, take: 20 });
  for (const file of files) {
    try { await destroyImage(file.storageKey); await prisma.mediaFile.deleteMany({ where: { id: file.id, deletedAt: { not: null } } }); }
    catch { console.warn('Media cleanup deferred; run media:cleanup later.'); }
  }
}
