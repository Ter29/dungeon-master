import { EventEmitter } from 'node:events';
import type { LocationView, LocationSnapshot } from '@dnd/shared';
import type { Scene, MediaFile } from '../generated/prisma/client.js';
import { prisma } from '../database/client.js';

export const locationEvents = new EventEmitter();
export function sceneView(scene: Scene & { background: MediaFile | null }): LocationView {
  const file = scene.background;
  return { id: scene.id, name: scene.name, description: scene.description, revision: scene.revision,
    background: file && !file.deletedAt ? { id: file.id, url: `/api/campaigns/${scene.campaignId}/locations/${scene.id}/background/${file.id}`,
      width: file.width, height: file.height, mimeType: file.mimeType, byteSize: file.byteSize } : null };
}
export async function activeSnapshot(campaignId: string): Promise<LocationSnapshot> {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { activeLocation: { include: { background: true } } } });
  const active = campaign.activeLocation;
  return { version: campaign.locationVersion, scene: active && active.campaignId === campaignId ? sceneView(active) : null };
}
export class SceneError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
