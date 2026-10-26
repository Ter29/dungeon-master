import { cleanupMedia, storageAvailable } from '../src/scenes/storage.js';
import { prisma } from '../src/database/client.js';
try {
  if (!storageAvailable()) throw new Error();
  await cleanupMedia();
  console.log('Cleanup batch completed (up to 20 tombstones older than one hour). Failures remain retryable.');
} catch { console.error('Media cleanup unavailable.'); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
