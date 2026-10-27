import type {
  AudioSnapshot,
  AudioCueView,
  AudioVoice,
  AudioKey,
} from "@dnd/shared";
import { audioPosition, audioFade } from "@dnd/shared";
export type LocalAudio = {
  master: number;
  music: number;
  ambience: number;
  sfx: number;
  video: number;
  muted: boolean;
};
export const defaultAudio: LocalAudio = {
  master: 0.7,
  music: 0.7,
  ambience: 0.6,
  sfx: 0.8,
  video: 0.8,
  muted: false,
};
type Voice = {
  audio: HTMLAudioElement;
  gain: GainNode;
  source: MediaElementAudioSourceNode;
  id: string;
  key: AudioKey | "SFX";
  spec: AudioVoice;
  ended: boolean;
  outgoing: boolean;
};
export class CampaignAudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<string, Voice>();
  private seen = new Set<string>();
  private snapshot: AudioSnapshot | null = null;
  private offset = 0;
  private enabled = false;
  private settings: LocalAudio = defaultAudio;
  private timer: ReturnType<typeof setInterval>;
  private lastDrift = 0;
  private disposed = false;
  private outputWasPlaying = false;
  private video: {
    element: HTMLVideoElement;
    source: MediaElementAudioSourceNode;
    gain: GainNode;
  } | null = null;
  private videoNodes = new WeakMap<
    HTMLVideoElement,
    { source: MediaElementAudioSourceNode; gain: GainNode }
  >();
  private duck = { music: 1, ambience: 1 };
  isEnabled() {
    return this.enabled && this.context?.state === "running";
  }
  setVideoDucking(active: boolean, music = 0.25, ambience = 0.25) {
    this.duck = { music: active ? music : 1, ambience: active ? ambience : 1 };
    this.tick();
  }
  attachVideo(element: HTMLVideoElement) {
    if (!this.context || !this.master || !this.isEnabled()) return () => {};
    let nodes = this.videoNodes.get(element);
    if (!nodes) {
      nodes = {
        source: this.context.createMediaElementSource(element),
        gain: this.context.createGain(),
      };
      nodes.source.connect(nodes.gain);
      this.videoNodes.set(element, nodes);
    }
    nodes.gain.connect(this.master);
    this.video = { element, ...nodes };
    element.muted = false;
    this.tick();
    return () => {
      nodes!.gain.disconnect();
      if (this.video?.element === element) this.video = null;
      this.setVideoDucking(false);
    };
  }
  constructor(private report: (message: string) => void) {
    this.timer = setInterval(() => this.tick(), 100);
    document.addEventListener("visibilitychange", this.visibility);
  }
  private visibility = () => {
    if (document.visibilityState === "visible") {
      this.lastDrift = 0;
      this.reconcile();
    }
  };
  async enable() {
    if (this.disposed) return;
    try {
      this.context ??= new AudioContext();
      if (!this.master) {
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
        this.context.onstatechange = () => {
          if (this.context?.state === "suspended")
            this.report(
              "Браузер призупинив звук. Натисніть «Увімкнути звук» повторно.",
            );
        };
      }
      let timer: number | undefined;
      try {
        await Promise.race([
          this.context.resume(),
          new Promise((_, reject) => {
            timer = window.setTimeout(() => reject(Error("blocked")), 5000);
          }),
        ]);
      } finally {
        window.clearTimeout(timer);
      }
      if (this.context.state !== "running") throw Error("blocked");
      this.enabled = true;
      this.report("Звук увімкнено. Очікуємо відтворення DM.");
      this.reconcile();
      for (const v of this.voices.values())
        if (!v.ended && v.spec.startedAt !== null) {
          if (v.audio.error) v.audio.load();
          void this.play(v);
        }
    } catch {
      this.report(
        "Браузер заблокував звук. Натисніть «Увімкнути звук» повторно.",
      );
    }
  }
  setSettings(settings: LocalAudio) {
    this.settings = settings;
    this.tick();
  }
  update(snapshot: AudioSnapshot | null) {
    if (snapshot && this.snapshot && snapshot.version < this.snapshot.version)
      return;
    this.snapshot = snapshot;
    if (snapshot) this.offset = snapshot.serverTime - Date.now();
    this.reconcile();
  }
  private remove(id: string) {
    const v = this.voices.get(id);
    if (!v) return;
    v.audio.pause();
    v.audio.removeAttribute("src");
    v.audio.load();
    v.source.disconnect();
    v.gain.disconnect();
    this.voices.delete(id);
  }
  private async play(v: Voice) {
    try {
      await v.audio.play();
      if (this.disposed || !this.voices.has(v.id)) v.audio.pause();
    } catch {
      if (this.voices.has(v.id))
        this.report(
          "Відтворення не почалося. Натисніть «Увімкнути звук»; перевірте з’єднання та формат.",
        );
    }
  }
  private make(
    id: string,
    key: Voice["key"],
    spec: AudioVoice,
    outgoing = false,
  ) {
    if (!this.context || !this.master) return;
    const audio = new Audio();
    audio.preload = "auto";
    audio.loop = spec.loop;
    const gain = this.context.createGain();
    gain.gain.value = 0;
    const source = this.context.createMediaElementSource(audio);
    source.connect(gain);
    gain.connect(this.master);
    const v: Voice = {
      audio,
      gain,
      source,
      id,
      key,
      spec,
      ended: false,
      outgoing,
    };
    this.voices.set(id, v);
    audio.onloadedmetadata = () => {
      if (!this.voices.has(id)) return;
      try {
        audio.currentTime = audioPosition(v.spec, Date.now() + this.offset);
      } catch {
        this.report("Не вдалося відновити позицію треку.");
      }
    };
    audio.onplaying = () => this.report("Відтворюється звук кампанії.");
    audio.onerror = () => {
      if (this.voices.has(id))
        this.report(
          "Аудіо недоступне або формат не підтримується браузером. Увімкніть звук повторно для спроби.",
        );
    };
    audio.onended = () => {
      v.ended = true;
      if (key === "SFX") this.remove(id);
    };
    audio.src = spec.asset.url;
    if (spec.startedAt !== null) void this.play(v);
  }
  private reconcile() {
    if (!this.enabled || !this.context) return;
    const desired = new Set<string>();
    for (const c of this.snapshot?.channels ?? []) {
      for (const [spec, outgoing] of [
        [c.voice, false],
        [c.outgoing, true],
      ] as const) {
        if (!spec || c.status === "STOPPED") continue;
        const id = `${c.key}:${outgoing ? "out" : "in"}:${spec.asset.id}:${spec.startedAt}`;
        desired.add(id);
        const old = this.voices.get(id);
        if (!old) this.make(id, c.key, spec, outgoing);
        else {
          old.spec = spec;
          old.audio.loop = spec.loop;
        }
      }
    }
    for (const [id, v] of this.voices)
      if (v.key !== "SFX" && !desired.has(id)) this.remove(id);
    if (!this.snapshot) for (const [id] of this.voices) this.remove(id);
    this.tick();
  }
  cue(cue: AudioCueView) {
    if (this.seen.has(cue.id)) return;
    this.seen.add(cue.id);
    if (this.seen.size > 512)
      this.seen.delete(this.seen.values().next().value!);
    const now = Date.now() + this.offset;
    if (
      !this.enabled ||
      !this.snapshot ||
      now - cue.at > 3000 ||
      now >= cue.expiresAt ||
      [...this.voices.values()].filter((v) => v.key === "SFX").length >= 6
    )
      return;
    this.make(`sfx:${cue.id}`, "SFX", {
      asset: { ...cue.asset, url: `${cue.asset.url}?cue=${cue.id}` },
      position: 0,
      startedAt: cue.at,
      loop: false,
    });
    this.tick();
  }
  private tick() {
    if (!this.context || !this.master) return;
    const now = Date.now() + this.offset;
    this.master.gain.setTargetAtTime(
      this.settings.muted ? 0 : this.settings.master,
      this.context.currentTime,
      0.03,
    );
    const drift = now - this.lastDrift > 4000;
    this.video?.gain.gain.setTargetAtTime(
      this.settings.video,
      this.context.currentTime,
      0.03,
    );
    if (drift) this.lastDrift = now;
    for (const [id, v] of this.voices) {
      let volume = this.settings.sfx;
      if (v.key !== "SFX") {
        const c = this.snapshot?.channels.find((c) => c.key === v.key);
        if (!c) {
          this.remove(id);
          continue;
        }
        const progress = c.fade.ms
          ? Math.min(1, Math.max(0, (now - c.fade.at) / c.fade.ms))
          : 1;
        if (v.outgoing && progress >= 1) {
          this.remove(id);
          continue;
        }
        if (
          !v.outgoing &&
          ((c.fade.to === 0 && progress >= 1) ||
            (!v.spec.loop &&
              audioPosition(v.spec, now) >= v.spec.asset.duration))
        ) {
          v.audio.pause();
          v.ended = true;
        }
        volume =
          (v.key === "MUSIC" ? this.duck.music : this.duck.ambience) *
          c.volume *
          (v.key === "MUSIC" ? this.settings.music : this.settings.ambience) *
          (v.outgoing
            ? (c.outgoing?.gain ?? 0) * (1 - progress)
            : audioFade(c.fade, now));
      }
      v.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.025);
      if (
        drift &&
        v.audio.readyState >= 1 &&
        v.spec.startedAt !== null &&
        !v.ended
      ) {
        const wanted = audioPosition(v.spec, now);
        if (Math.abs(v.audio.currentTime - wanted) > 1.2)
          try {
            v.audio.currentTime = wanted;
          } catch {
            /* Retry on metadata/next drift check. */
          }
      }
    }
    const playing =
      this.context.state === "running" &&
      (Boolean(
        this.video &&
          !this.video.element.paused &&
          this.video.element.readyState >= 2,
      ) ||
        [...this.voices.values()].some(
          (v) => !v.audio.paused && !v.ended && v.audio.readyState >= 2,
        ));
    if (playing !== this.outputWasPlaying) {
      this.outputWasPlaying = playing;
      this.report(
        playing
          ? "Відтворюється звук кампанії."
          : !this.snapshot
            ? "Відновлюємо аудіоз’єднання…"
            : this.context.state !== "running"
              ? "Браузер призупинив звук. Натисніть «Увімкнути звук» повторно."
              : "Тиша · відтворення зупинено або призупинено.",
      );
    }
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.visibility);
    for (const [id] of this.voices) this.remove(id);
    this.video?.gain.disconnect();
    this.video?.source.disconnect();
    this.video = null;
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close();
    }
  }
}
