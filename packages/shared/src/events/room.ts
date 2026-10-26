export type SceneId = 'scene-1' | 'scene-2';
export type Point = { x: number; y: number };
export type RoomState = { activeScene: SceneId; positions: Record<SceneId, Point> };
export type RoomMember = { userId: string; displayName: string; role: 'DM' | 'PLAYER'; online: boolean };
export type Snapshot = { version: number; state: RoomState; members: RoomMember[] };
export type Reply = { ok: true } | { ok: false; message: string };
export type Ping = Point & { userId: string; displayName: string; id: string };
export interface ClientEvents {
  'location:ping': (data: {sceneId: string; x: number; y: number}, ack: (reply: Reply) => void) => void;
  'room:sync': (ack: (reply: Reply) => void) => void;
  'token:move': (data: Point & { version: number }, ack: (reply: Reply) => void) => void;
  'scene:change': (data: { scene: SceneId; version: number }, ack: (reply: Reply) => void) => void;
  'player:ping': (data: Point, ack: (reply: Reply) => void) => void;
}
export interface ServerEvents {
  'director:snapshot': (snapshot:import('./director.js').DirectorSnapshot) => void;
  'director:library-changed': () => void;
  'combat:snapshot': (snapshot:import('./combat.js').CombatSnapshot) => void;
  'cartography:changed': () => void;
  'location:ping': (ping: import('./locations.js').LocationPing) => void;
  'location:snapshot': (snapshot: import('./locations.js').LocationSnapshot) => void;
  'locations:changed': () => void;
  'room:snapshot': (snapshot: Snapshot) => void;
  'room:ping': (ping: Ping) => void;
  'room:error': (message: string) => void;
}
