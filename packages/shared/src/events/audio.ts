export type AudioCategory = "MUSIC" | "AMBIENCE" | "SFX";
export type AudioKey = "MUSIC" | "AMBIENCE";
export type AudioAssetView = {
  id: string;
  name: string;
  description: string;
  category: AudioCategory;
  duration: number;
  byteSize: number;
  revision: number;
  url: string;
};
export type AudioVoice = {
  asset: AudioAssetView;
  position: number;
  startedAt: number | null;
  loop: boolean;
};
export type AudioChannelView = {
  key: AudioKey;
  status: "PLAYING" | "PAUSED" | "STOPPED";
  voice: AudioVoice | null;
  volume: number;
  fade: { from: number; to: number; at: number; ms: number };
  outgoing: (AudioVoice & { gain: number }) | null;
};
export type AudioSnapshot = {
  version: number;
  serverTime: number;
  channels: AudioChannelView[];
};
export type AudioCueView = {
  id: string;
  asset: AudioAssetView;
  at: number;
  expiresAt: number;
};
export type AudioLibrary = {
  assets: AudioAssetView[];
  maxBytes: number;
  maxDuration: number;
  maxSfxDuration: number;
  storageAvailable: boolean;
};
export function audioPosition(voice: AudioVoice, now: number) {
  const p =
    voice.position +
    (voice.startedAt === null ? 0 : Math.max(0, now - voice.startedAt) / 1000);
  return voice.loop
    ? p % voice.asset.duration
    : Math.min(p, voice.asset.duration);
}
export function audioFade(f: AudioChannelView["fade"], now: number) {
  return (
    f.from +
    (f.to - f.from) * (f.ms ? Math.min(1, Math.max(0, (now - f.at) / f.ms)) : 1)
  );
}
