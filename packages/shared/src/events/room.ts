export type SceneId = 'scene-1' | 'scene-2';
export type Point = { x: number; y: number };
export type RoomState = { activeScene: SceneId; positions: Record<SceneId, Point> };
export type RoomMember = { userId: string; displayName: string; role: 'DM' | 'PLAYER'; online: boolean };
export type Snapshot = { version: number; state: RoomState; members: RoomMember[] };
export type Reply = { ok: true } | { ok: false; message: string };
export type Ping = Point & { userId: string; displayName: string; id: string };
export interface ClientEvents {
  'room:sync': (ack: (reply: Reply) => void) => void;
  'token:move': (data: Point & { version: number }, ack: (reply: Reply) => void) => void;
  'scene:change': (data: { scene: SceneId; version: number }, ack: (reply: Reply) => void) => void;
  'player:ping': (data: Point, ack: (reply: Reply) => void) => void;
}
export interface ServerEvents {
  'room:snapshot': (snapshot: Snapshot) => void;
  'room:ping': (ping: Ping) => void;
  'room:error': (message: string) => void;
}
