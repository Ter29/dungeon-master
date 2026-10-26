export type LocationBackground = { id: string; url: string; width: number; height: number; mimeType: string; byteSize: number };
export type TokenView = { id: string; name: string; kind: 'PLAYER' | 'NPC' | 'ENEMY'; x: number; y: number; size: number; hidden: boolean; revision: number; image: LocationBackground | null };
export type GridSettings = { visible: boolean; size: number; offsetX: number; offsetY: number };
export type LocationView = { id: string; name: string; description: string; revision: number; tableRevision: number; width: number; height: number; grid: GridSettings; fog:import('../fog.js').FogState; tokens: TokenView[]; background: LocationBackground | null };
export type LocationSnapshot = { version: number; scene: LocationView | null };
export type LocationPing = { sceneId: string; x: number; y: number; id: string; userId: string; displayName: string };
