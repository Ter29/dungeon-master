import type { LocationBackground } from "./locations.js";
export type DisplayMode =
  | "TABLE"
  | "ILLUSTRATION"
  | "PORTRAIT"
  | "BLANK"
  | "VIDEO";
export type PresentationCategory = "LOCATION" | "NPC" | "EVENT";
export type PresentationMaterialView = {
  id: string;
  name: string;
  description: string;
  category: PresentationCategory;
  revision: number;
  image: LocationBackground | null;
};
export type VideoAssetView = {
  id: string;
  name: string;
  description: string;
  revision: number;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  byteSize: number;
  url: string;
};
export type VideoState = {
  asset: VideoAssetView;
  status: "PLAYING" | "PAUSED" | "STOPPED";
  position: number;
  startedAt: number | null;
  duckMusic: number;
  duckAmbience: number;
};
export type DirectorSnapshot = {
  version: number;
  mode: DisplayMode;
  material: PresentationMaterialView | null;
  video?: VideoState | null;
  serverTime?: number;
};
export type VideoLibrary = {
  videos: VideoAssetView[];
  storageAvailable: boolean;
  limits: {
    maxBytes: number;
    maxDuration: number;
    maxAssets: number;
    campaignBytes: number;
  };
};
export function videoPosition(v: VideoState, now: number) {
  return Math.min(
    v.asset.duration,
    Math.max(
      0,
      v.position +
        (v.status === "PLAYING" && v.startedAt !== null
          ? Math.max(0, now - v.startedAt) / 1000
          : 0),
    ),
  );
}
export type DirectorLibrary = {
  materials: PresentationMaterialView[];
  storageAvailable: boolean;
};
