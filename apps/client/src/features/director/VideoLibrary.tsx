import { useEffect, useState, type FormEvent } from "react";
import type {
  DirectorSnapshot,
  VideoAssetView,
  VideoLibrary as Library,
} from "@dnd/shared";
import { api, errorMessage } from "../../lib/api";
import {
  WorkspaceArea,
  useWorkspace,
  useDraftWarning,
  DraftNotice,
} from "../workspace/Workspace";
import "./video.css";
export function VideoLibrary({
  campaignId,
  state,
  ready,
  refreshKey,
  onState,
  refresh,
}: {
  campaignId: string;
  state: DirectorSnapshot | null;
  ready: boolean;
  refreshKey: number;
  onState: (s: DirectorSnapshot) => void;
  refresh: () => Promise<void>;
}) {
  const base = `/campaigns/${campaignId}/director`,
    workspace = useWorkspace(),
    [library, setLibrary] = useState<Library | null>(null),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [preview, setPreview] = useState<VideoAssetView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [duckMusic, setDuckMusic] = useState(0.25),
    [duckAmbience, setDuckAmbience] = useState(0.25),
    [uploadDirty, setUploadDirty] = useState(false);
  useDraftWarning("video-upload", uploadDirty);
  async function load() {
    setLibrary(await api<Library>(`${base}/videos`));
  }
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, [base, refreshKey]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      await Promise.all([load(), refresh()]).catch((e) =>
        setError(errorMessage(e)),
      );
    }
  }
  async function play(id = selected) {
    const a = library?.videos.find((v) => v.id === id);
    if (!state || !a) return;
    await run(async () => {
      onState(
        await api<DirectorSnapshot>(`${base}/video`, {
          action: "PLAY",
          version: state.version,
          videoId: a.id,
          revision: a.revision,
          duckMusic,
          duckAmbience,
        }),
      );
      setPreview(null);
    });
  }
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form),
      file = data.get("file");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > (library?.limits.maxBytes ?? 0)
    ) {
      setError("Оберіть MP4 у межах ліміту.");
      return;
    }
    await run(async () => {
      const r = await api<{ video: VideoAssetView }>(`${base}/videos`, data);
      setSelected(r.video.id);
      form.reset();
      setUploadDirty(false);
    });
  }
  return (
    <>
      <WorkspaceArea name="director.main">
        <section className="video-library" aria-label="Відеосцени Director">
          <h3>Відеосцени</h3>
          <p>MP4 · приватна підготовка, спільний показ лише за командою DM.</p>
          {error && <p role="alert">{error}</p>}
          <div className="video-quick-actions">
            <select
              aria-label="Вибір відеосцени"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Оберіть відео</option>
              {library?.videos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {Math.round(v.duration)} с
                </option>
              ))}
            </select>
            <button
              disabled={!ready || busy || !selected}
              onClick={() => void play()}
            >
              Показати відео всім
            </button>
            <button
              disabled={!selected || busy}
              onClick={() =>
                setPreview(
                  library?.videos.find((v) => v.id === selected) ?? null,
                )
              }
            >
              Приватний Preview відео
            </button>
          </div>
          {preview && (
            <div>
              <p>ПРИВАТНИЙ PREVIEW · лише DM · не змінює екран гравців</p>
              <video
                controls
                playsInline
                preload="metadata"
                muted
                src={preview.url}
                aria-label={`Приватне відео ${preview.name}`}
              />
              <button onClick={() => setPreview(null)}>
                Закрити Preview відео
              </button>
            </div>
          )}
          <div className="preparation-only">
            <form
              onSubmit={(e) => void upload(e)}
              onChange={() => setUploadDirty(true)}
              aria-label="Завантаження відео"
            >
              <DraftNotice dirty={uploadDirty} />
              <h4>Додати приватне відео</h4>
              <label>
                Назва відео
                <input name="name" required maxLength={120} />
              </label>
              <label>
                Опис відео
                <textarea name="description" maxLength={2000} />
              </label>
              <label>
                MP4 H.264/AAC
                <input
                  name="file"
                  type="file"
                  accept="video/mp4,.mp4"
                  required
                />
              </label>
              <p>
                До {Math.round((library?.limits.maxBytes ?? 0) / 1024 / 1024)}{" "}
                МіБ, {library?.limits.maxDuration ?? 0} с, 1920×1080. Без
                перекодування.
              </p>
              <button disabled={busy || !library?.storageAvailable}>
                Завантажити відео
              </button>
            </form>
            <fieldset>
              <legend>Приглушення фону під відео</legend>
              <label>
                Music, %{" "}
                <input
                  aria-label="Приглушення Music"
                  type="number"
                  min="0"
                  max="100"
                  value={duckMusic * 100}
                  onChange={(e) =>
                    setDuckMusic(
                      Math.max(0, Math.min(1, Number(e.target.value) / 100)),
                    )
                  }
                />
              </label>
              <label>
                Ambience, %{" "}
                <input
                  aria-label="Приглушення Ambience"
                  type="number"
                  min="0"
                  max="100"
                  value={duckAmbience * 100}
                  onChange={(e) =>
                    setDuckAmbience(
                      Math.max(0, Math.min(1, Number(e.target.value) / 100)),
                    )
                  }
                />
              </label>
            </fieldset>
            <label>
              Пошук відео
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <ul>
              {library?.videos
                .filter((v) =>
                  `${v.name} ${v.description}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((v) => (
                  <li key={v.id}>
                    <strong>{v.name}</strong>
                    <p>
                      {Math.round(v.duration)} с · {v.width}×{v.height} ·{" "}
                      {v.hasAudio ? "зі звуком" : "без звуку"}
                    </p>
                    <VideoMetadata
                      key={`${v.id}:${v.revision}`}
                      asset={v}
                      disabled={busy}
                      save={(data) =>
                        void run(async () => {
                          await api(
                            `${base}/videos/${v.id}`,
                            { ...data, revision: v.revision },
                            "PATCH",
                          );
                        })
                      }
                    />
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Видалити «${v.name}»? Активна відеосцена завершиться.`,
                          )
                        )
                          void run(async () => {
                            await api(
                              `${base}/videos/${v.id}`,
                              { revision: v.revision },
                              "DELETE",
                            );
                            if (preview?.id === v.id) setPreview(null);
                            if (selected === v.id) setSelected("");
                          });
                      }}
                    >
                      Видалити відео {v.name}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
          {library?.videos.length === 0 && (
            <p>
              Бібліотека відео порожня.
              {workspace?.live && (
                <button onClick={() => workspace.setLive(false)}>
                  Перейти до підготовки
                </button>
              )}
            </p>
          )}
        </section>
      </WorkspaceArea>
    </>
  );
}
function VideoMetadata({
  asset,
  disabled,
  save,
}: {
  asset: VideoAssetView;
  disabled: boolean;
  save: (data: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState(asset.name),
    [description, setDescription] = useState(asset.description);
  const dirty = name !== asset.name || description !== asset.description;
  useDraftWarning(`video-${asset.id}`, dirty);
  return (
    <details>
      <summary>Редагувати відео {asset.name}</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({ name, description });
        }}
      >
        <DraftNotice dirty={dirty} />
        <label>
          Назва
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Опис
          <textarea
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <button disabled={disabled || !dirty}>Зберегти відео</button>
      </form>
    </details>
  );
}
