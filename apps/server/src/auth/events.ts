import { EventEmitter } from 'node:events';
// In-process session revocation for the single-server deployment.
export const sessionEvents = new EventEmitter();
sessionEvents.setMaxListeners(0);
