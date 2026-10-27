import { createContext, useContext } from "react";
import type { CampaignAudioEngine, LocalAudio } from "./engine";
export const PlaybackContext = createContext<{
  engine: CampaignAudioEngine | null;
  local: LocalAudio;
  enabled: boolean;
  enable: () => void;
  change: (v: LocalAudio) => void;
} | null>(null);
export const usePlayback = () => useContext(PlaybackContext);
