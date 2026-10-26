import { cleanupMedia, storageAvailable } from '../src/scenes/storage.js';
import { prisma } from '../src/database/client.js';
try {
  if (!storageAvailable()) throw new Error();
  await cleanupMedia();
  await cleanupAudio();
  await prisma.audioCue.deleteMany({where:{expiresAt:{lt:new Date()}}});
  console.log('Cleanup batch completed (up to 20 tombstones older than one hour). Failures remain retryable.');
} catch { console.error('Media cleanup unavailable.'); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
import {cleanupAudio} from '../src/audio/storage.js';
