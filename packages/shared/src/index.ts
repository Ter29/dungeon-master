// Shared schemas, types and event contracts will be exported here.
export type {
  SceneId,
  Point,
  RoomState,
  RoomMember,
  Snapshot,
  Reply,
  Ping,
  ClientEvents,
  ServerEvents,
} from "./events/room.js";
export type {
  LocationBackground,
  LocationView,
  LocationSnapshot,
} from "./events/locations.js";
export type {
  TokenView,
  GridSettings,
  LocationPing,
} from "./events/locations.js";
export {
  FOG_SIZE,
  FOG_HEX_LENGTH,
  fogCell,
  tokenInOpenFog,
  applyFog,
} from "./fog.js";
export type { FogState, FogPoint, FogOperation } from "./fog.js";
export type {
  CartographyPoint,
  MapFragmentView,
  MapElementView,
  SharedMapSummary,
  SharedMapView,
  CartographyCatalog,
} from "./events/cartography.js";

export type {
  CombatSnapshot,
  CombatEncounterView,
  CombatParticipantView,
} from "./events/combat.js";

export type {
  DisplayMode,
  PresentationCategory,
  PresentationMaterialView,
  DirectorSnapshot,
  DirectorLibrary,
} from "./events/director.js";
export * from "./events/audio.js";
export { videoPosition } from "./events/director.js";
export type {
  VideoAssetView,
  VideoState,
  VideoLibrary,
} from "./events/director.js";
