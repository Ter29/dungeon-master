import { useEffect, useRef, useState } from "react";
import type {
  AudioSnapshot,
  AudioCueView,
  AudioLibrary,
  AudioAssetView,
  AudioKey,
  AudioCategory,
} from "@dnd/shared";
import { audioPosition } from "@dnd/shared";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { CampaignAudioEngine, defaultAudio, type LocalAudio } from "./engine";
import "./audio.css";
import { WorkspaceArea, useWorkspace } from "../workspace/Workspace";
export function CampaignAudio({
  campaignId,
  dm,
  state,
  cues,
  libraryKey,
  refresh,
}: {
  campaignId: string;
  dm: boolean;
  state: AudioSnapshot | null;
  cues: AudioCueView[];
  libraryKey: number;
  refresh: () => void;
}) {
  const { user } = useAuth();
  const updateWorkspace = useWorkspace()?.update;
  const favoritesKey = `obsidian-sfx:${user?.id}:${campaignId}`;
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(favoritesKey) ?? "[]");
      return Array.isArray(v)
        ? v.filter((x: unknown) => typeof x === "string").slice(0, 24)
        : [];
    } catch {
      return [];
    }
  });
  function favorite(id: string) {
    setFavorites((old) => {
      const next = old.includes(id)
        ? old.filter((v) => v !== id)
        : [...old.slice(-23), id];
      try {
        localStorage.setItem(favoritesKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  useEffect(() => {
    const c = state?.channels.find((c) => c.key === "MUSIC");
    updateWorkspace?.({ music: c?.voice ? c.voice.asset.name : "Тиша" });
  }, [state, updateWorkspace]);
  const engine = useRef<CampaignAudioEngine | null>(null);
  const [status, setStatus] = useState(
    "Натисніть «Увімкнути звук», щоб чути кампанію.",
  );
  const [local, setLocal] = useState<LocalAudio>(defaultAudio),
    [loaded, setLoaded] = useState(false),
    [library, setLibrary] = useState<AudioLibrary | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState("ALL"),
    [preview, setPreview] = useState<AudioAssetView | null>(null);
  const storageKey = `dnd-audio-v1:${user?.id ?? "anonymous"}`;
  const [clock, setClock] = useState(Date.now());
  const clockOffset = useRef(0);
  useEffect(() => {
    if (state) {
      clockOffset.current = state.serverTime - Date.now();
      setClock(Date.now());
    }
  }, [state]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const e = new CampaignAudioEngine(setStatus);
    engine.current = e;
    return () => {
      e.dispose();
      engine.current = null;
    };
  }, [campaignId]);
  useEffect(() => {
    setLoaded(false);
    try {
      const s = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (s) {
        const value = { ...defaultAudio };
        for (const k of ["master", "music", "ambience", "sfx"] as const)
          if (typeof s[k] === "number" && Number.isFinite(s[k]))
            value[k] = Math.min(1, Math.max(0, s[k]));
        value.muted = s.muted === true;
        setLocal(value);
      } else setLocal(defaultAudio);
    } catch {
      setLocal(defaultAudio);
    }
    setLoaded(true);
  }, [storageKey]);
  useEffect(() => {
    engine.current?.setSettings(local);
    if (loaded)
      try {
        localStorage.setItem(storageKey, JSON.stringify(local));
      } catch {
        /* Playback remains available without local storage. */
      }
  }, [local, loaded, storageKey]);
  useEffect(() => engine.current?.update(state), [state]);
  useEffect(() => {
    for (const cue of cues) engine.current?.cue(cue);
  }, [cues]);
  async function load() {
    if (!dm) return;
    try {
      setLibrary(
        await api<AudioLibrary>(`/campaigns/${campaignId}/audio/assets`),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
  }, [campaignId, dm, libraryKey]);
  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      refresh();
      void load();
    }
  }
  const base = `/campaigns/${campaignId}/audio`;
  function command(
    key: AudioKey,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    if (!state) return;
    void run(() =>
      api(`${base}/channels/${key}`, {
        version: state.version,
        action,
        ...extra,
      }),
    );
  }
  return (
    <>
      <aside className="audio-personal" aria-label="Особистий звук">
        <button onClick={() => void engine.current?.enable()}>
          Увімкнути звук
        </button>
        <p
          className={
            /заблок|недоступ|не почал|призупинив|не вдало/i.test(status)
              ? "audio-error"
              : "audio-state"
          }
          role="status"
        >
          {/Відтворюється/.test(status)
            ? "● Відтворюється"
            : /Тиша/.test(status)
              ? "○ Тиша"
              : /^Натисніть/.test(status)
                ? "○ Звук ще не активовано"
                : status}
        </p>
        <details>
          <summary>♫ Гучність і стан</summary>
          <p>
            {state
              ? "Аудіостан синхронізовано."
              : "З’єднання відновлюється; відтворення призупинено."}
          </p>
          <label>
            <input
              type="checkbox"
              checked={local.muted}
              onChange={(e) => setLocal({ ...local, muted: e.target.checked })}
            />{" "}
            Mute
          </label>
          {(["master", "music", "ambience", "sfx"] as const).map((k) => (
            <label className="audio-volume" key={k}>
              {k}{" "}
              <input
                aria-label={`${k} volume`}
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={local[k]}
                onChange={(e) =>
                  setLocal({ ...local, [k]: Number(e.target.value) })
                }
              />
              <output>{Math.round(local[k] * 100)}%</output>
            </label>
          ))}
        </details>
      </aside>
      {dm && (
        <WorkspaceArea name="audio.main">
          <section className="audio-dashboard">
            <div className="section-intro">
              <span className="eyebrow">THE SOUND OF YOUR WORLD</span>
              <h3>Атмосфера починається зі звуку</h3>
              <p>Два незалежні канали. Один простір для вашої історії.</p>
            </div>
            {error && <p role="alert">{error}</p>}
            <div className="audio-channels">
              {(["MUSIC", "AMBIENCE"] as const).map((key) => {
                const c = state?.channels.find((c) => c.key === key);
                const now = clock + clockOffset.current;
                const finished =
                  c?.status === "PLAYING" &&
                  c.voice &&
                  ((!c.voice.loop &&
                    audioPosition(c.voice, now) >= c.voice.asset.duration) ||
                    (c.fade.to === 0 && now >= c.fade.at + c.fade.ms));
                return (
                  <Channel
                    key={key}
                    channelKey={key}
                    current={c?.voice?.asset.name ?? "Немає треку"}
                    status={finished ? "STOPPED" : (c?.status ?? "STOPPED")}
                    loop={c?.voice?.loop ?? true}
                    volume={c?.volume ?? 1}
                    disabled={busy || !state}
                    assets={
                      library?.assets.filter((a) => a.category === key) ?? []
                    }
                    command={(action, extra) => command(key, action, extra)}
                  />
                );
              })}
            </div>
            <h3>
              Швидкі ефекти <small>SFX</small>
            </h3>
            <p className="muted">
              Зірочка додає ефект до вашої особистої швидкої панелі.
            </p>
            {!library?.assets.some((a) => a.category === "SFX") && (
              <div className="empty-card">
                Додайте перший ефект у бібліотеці праворуч: двері, грім або
                голос монстра.
              </div>
            )}
            <div className="audio-sfx">
              {library?.assets
                .filter((a) => a.category === "SFX")
                .sort(
                  (a, b) =>
                    Number(favorites.includes(b.id)) -
                    Number(favorites.includes(a.id)),
                )
                .map((a) => (
                  <div className="sfx-tile" key={a.id}>
                    <button
                      key={a.id}
                      disabled={busy || !state}
                      onClick={() =>
                        void run(() =>
                          api(`${base}/cues`, {
                            assetId: a.id,
                            assetRevision: a.revision,
                          }),
                        )
                      }
                    >
                      {a.name}
                    </button>
                    <button
                      className="sfx-favorite"
                      aria-label={`${favorites.includes(a.id) ? "Прибрати з" : "Додати до"} улюблених ${a.name}`}
                      aria-pressed={favorites.includes(a.id)}
                      onClick={() => favorite(a.id)}
                    >
                      {favorites.includes(a.id) ? "★" : "☆"}
                    </button>
                  </div>
                ))}
            </div>
            <div className="info-card">
              <strong>Приватне прослуховування ≠ показ гравцям</strong>
              <p>
                Preview у бібліотеці чуєте тільки ви. Канали Music, Ambience та
                кнопки SFX керують звуком усієї групи.
              </p>
            </div>
          </section>
        </WorkspaceArea>
      )}
      {dm && (
        <WorkspaceArea name="audio.context">
          <details open>
            <summary>Бібліотека аудіо</summary>
            <p>
              MP3 / OGG / WAV · до{" "}
              {Math.round((library?.maxBytes ?? 0) / 1048576)} МіБ · до{" "}
              {library?.maxDuration ?? 0} с · SFX до{" "}
              {library?.maxSfxDuration ?? 0} с.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  data = new FormData(form);
                void run(async () => {
                  await api(`${base}/assets`, data);
                  form.reset();
                });
              }}
            >
              <input
                name="name"
                aria-label="Назва аудіо"
                placeholder="Назва аудіо"
                maxLength={120}
                required
              />
              <input
                name="description"
                aria-label="Опис аудіо"
                placeholder="Опис"
                maxLength={2000}
              />
              <select name="category" aria-label="Категорія аудіо">
                {(["MUSIC", "AMBIENCE", "SFX"] as const).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input
                name="file"
                aria-label="Аудіофайл"
                type="file"
                accept=".mp3,.ogg,.wav,audio/mpeg,audio/ogg,audio/wav"
                required
              />
              <button disabled={busy || !library?.storageAvailable}>
                Завантажити аудіо
              </button>
            </form>
            <input
              aria-label="Пошук аудіо"
              placeholder="Пошук"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="Фільтр аудіо"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="ALL">Усі категорії</option>
              {(["MUSIC", "AMBIENCE", "SFX"] as AudioCategory[]).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            {preview && (
              <div>
                <p>Приватне прослуховування: {preview.name}</p>
                <audio key={preview.id} src={preview.url} controls />
                <button onClick={() => setPreview(null)}>
                  Закрити Preview
                </button>
              </div>
            )}
            <ul className="audio-library">
              {library?.assets
                .filter(
                  (a) =>
                    (category === "ALL" || a.category === category) &&
                    `${a.name} ${a.description}`
                      .toLocaleLowerCase()
                      .includes(search.toLocaleLowerCase()),
                )
                .map((a) => (
                  <li key={`${a.id}:${a.revision}`}>
                    <strong>{a.name}</strong> · {a.category} ·{" "}
                    {Math.floor(a.duration / 60)}:
                    {String(Math.floor(a.duration % 60)).padStart(2, "0")}
                    <p>{a.description}</p>
                    <button onClick={() => setPreview(a)}>
                      Preview · тільки DM
                    </button>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        void run(() =>
                          api(
                            `${base}/assets/${a.id}`,
                            {
                              name: data.get("name"),
                              description: data.get("description"),
                              revision: a.revision,
                            },
                            "PATCH",
                          ),
                        );
                      }}
                    >
                      <input
                        name="name"
                        aria-label={`Назва ${a.name}`}
                        defaultValue={a.name}
                        required
                        maxLength={120}
                      />
                      <input
                        name="description"
                        aria-label={`Опис ${a.name}`}
                        defaultValue={a.description}
                        maxLength={2000}
                      />
                      <button disabled={busy}>Зберегти</button>
                    </form>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Видалити «${a.name}»? Активне відтворення буде зупинено.`,
                          )
                        ) {
                          setPreview(null);
                          void run(() =>
                            api(
                              `${base}/assets/${a.id}`,
                              { revision: a.revision },
                              "DELETE",
                            ),
                          );
                        }
                      }}
                    >
                      Видалити
                    </button>
                  </li>
                ))}
            </ul>
          </details>
        </WorkspaceArea>
      )}
    </>
  );
}
function Channel({
  channelKey,
  current,
  status,
  loop,
  volume,
  disabled,
  assets,
  command,
}: {
  channelKey: AudioKey;
  current: string;
  status: string;
  loop: boolean;
  volume: number;
  disabled: boolean;
  assets: AudioAssetView[];
  command: (action: string, extra?: Record<string, unknown>) => void;
}) {
  const [selected, setSelected] = useState(""),
    [fadeMs, setFadeMs] = useState(1500),
    [globalVolume, setGlobalVolume] = useState(volume);
  useEffect(() => setGlobalVolume(volume), [volume]);
  return (
    <section className="audio-channel">
      <h3>{channelKey}</h3>
      <p>
        {current} · {status}
      </p>
      <select
        aria-label={`${channelKey} track`}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">Оберіть трек</option>
        {assets.map((a) => (
          <option value={a.id} key={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <button
        disabled={disabled || !assets.some((a) => a.id === selected)}
        onClick={() => {
          const a = assets.find((a) => a.id === selected)!;
          command("PLAY", { assetId: a.id, assetRevision: a.revision, fadeMs });
        }}
      >
        Play / Перехід
      </button>
      <button
        disabled={disabled || status !== "PLAYING"}
        onClick={() => command("PAUSE")}
      >
        Pause
      </button>
      <button
        disabled={disabled || status !== "PAUSED"}
        onClick={() => command("RESUME", { fadeMs })}
      >
        Продовжити
      </button>
      <button disabled={disabled} onClick={() => command("STOP")}>
        Stop
      </button>
      <label>
        <input
          type="checkbox"
          checked={loop}
          disabled={disabled}
          onChange={(e) => command("SETTINGS", { loop: e.target.checked })}
        />{" "}
        Loop
      </label>
      <label>
        Fade, с{" "}
        <input
          type="number"
          min="0"
          max="15"
          step=".5"
          value={fadeMs / 1000}
          onChange={(e) =>
            setFadeMs(
              Math.min(15000, Math.max(0, Number(e.target.value) * 1000)),
            )
          }
        />
      </label>
      <button
        disabled={disabled || status !== "PLAYING"}
        onClick={() => command("FADE_IN", { fadeMs })}
      >
        Fade In
      </button>
      <button
        disabled={disabled || status !== "PLAYING"}
        onClick={() => command("FADE_OUT", { fadeMs })}
      >
        Fade Out
      </button>
      <label>
        Гучність каналу{" "}
        <input
          aria-label={`${channelKey} global volume`}
          type="range"
          min="0"
          max="1"
          step=".05"
          value={globalVolume}
          disabled={disabled}
          onChange={(e) => setGlobalVolume(Number(e.target.value))}
        />
      </label>
      <button
        disabled={disabled || globalVolume === volume}
        onClick={() => command("SETTINGS", { volume: globalVolume })}
      >
        Застосувати гучність
      </button>
    </section>
  );
}
