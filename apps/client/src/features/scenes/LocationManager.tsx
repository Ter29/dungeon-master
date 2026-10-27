import { useEffect, useState, type FormEvent } from "react";
import type { LocationView } from "@dnd/shared";
import { api, errorMessage } from "../../lib/api";
import {
  WorkspaceArea,
  useWorkspace,
  useDraftWarning,
  DraftNotice,
} from "../workspace/Workspace";

type List = {
  scenes: LocationView[];
  version: number;
  activeLocationId: string | null;
  storageAvailable: boolean;
};
export function LocationManager({
  campaignId,
  refreshKey,
}: {
  campaignId: string;
  refreshKey: number;
}) {
  const base = `/campaigns/${campaignId}/locations`;
  const [list, setList] = useState<List | null>(null);
  const [selected, setSelected] = useState<LocationView | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [initialFog, setInitialFog] = useState("hidden");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const workspace = useWorkspace();
  const dirty =
    name !== (selected?.name ?? "") ||
    description !== (selected?.description ?? "") ||
    (!selected && initialFog !== "hidden");
  useDraftWarning("location-editor", dirty);
  async function load() {
    setList(await api<List>(base));
  }
  useEffect(() => {
    let live = true;
    void api<List>(base)
      .then((result) => {
        if (live) setList(result);
      })
      .catch((error) => {
        if (live) setError(errorMessage(error));
      });
    return () => {
      live = false;
    };
  }, [base, refreshKey]);
  function edit(scene: LocationView | null, force = false) {
    if(!force)workspace?.setLive(false);
    if (
      !force &&
      dirty &&
      !window.confirm("Відкинути незбережені зміни локації?")
    )
      return;
    setSelected(scene);
    setName(scene?.name ?? "");
    setDescription(scene?.description ?? "");
    setInitialFog("hidden");
    setDeleting(false);
    setError("");
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const { scene } = await api<{ scene: LocationView }>(
        selected ? `${base}/${selected.id}` : base,
        {
          name,
          description,
          ...(selected ? { revision: selected.revision } : { initialFog }),
        },
        selected ? "PATCH" : "POST",
      );
      edit(scene, true);
    });
  }
  function activate(sceneId: string | null) {
    if (!list) return;
    void run(async () => {
      await api(`${base}/activate`, { sceneId, version: list.version });
    });
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024) {
      setError("Оберіть PNG/JPG розміром до 8 МіБ.");
      return;
    }
    data.set("revision", String(selected.revision));
    await run(async () => {
      const { scene } = await api<{ scene: LocationView }>(
        `${base}/${selected.id}/background`,
        data,
      );
      edit(scene, true);
      form.reset();
    });
  }
  return (
    <section aria-label="Менеджер локацій">
      <WorkspaceArea name="scenes.context">
        <h3>Підготовлені локації</h3>
        <p className="private-note">
          Приватна підготовка · гравці бачать лише активну локацію
        </p>
        {error && <p role="alert">{error}</p>}
        <button disabled={busy} onClick={() => void run(load)}>
          Оновити список
        </button>{" "}
        <button disabled={busy} onClick={() => edit(null)}>
          Нова локація
        </button>{" "}
        <button disabled={busy || !list} onClick={() => activate(null)}>
          Залишити стіл порожнім
        </button>
        {!list ? (
          <p>Завантаження списку…</p>
        ) : (
          <>
            {!list.storageAvailable && (
              <p>
                Завантаження зображень недоступне: сховище ще не налаштовано.
              </p>
            )}
            {!list.scenes.length && <p>Підготовлених локацій ще немає.</p>}
            <ul className="scene-library">
              {list.scenes.map((scene) => (
                <li key={scene.id}>
                  {scene.background && (
                    <img src={scene.background.url} alt="" loading="lazy" />
                  )}
                  <button disabled={busy} onClick={() => edit(scene)}>
                    {scene.name}
                  </button>{" "}
                  {list.activeLocationId === scene.id ? (
                    <strong>Активна</strong>
                  ) : (
                    <button disabled={busy} onClick={() => activate(scene.id)}>
                      Активувати
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {workspace && (
          <div className="info-card">
            <h4>Ілюстрації та портрети</h4>
            <p>
              Покажіть NPC або атмосферне зображення, зберігши ігрову локацію.
            </p>
            <button onClick={() => workspace.navigate("director")}>
              Відкрити Director →
            </button>
          </div>
        )}
      </WorkspaceArea>
      <WorkspaceArea name="scenes.main">
        <div className="live-only">
          <h3>Швидка зміна локації</h3>
          <p>
            Активуйте локацію для всієї групи. Повний редактор залишається в
            підготовці.
          </p>
          <div className="live-scene-grid">
            {list?.scenes.map((s) => (
              <button
                key={s.id}
                disabled={busy}
                aria-pressed={list.activeLocationId === s.id}
                onClick={() => activate(s.id)}
              >
                {s.background && <img src={s.background.url} alt="" />}
                <strong>{s.name}</strong>
                <span>
                  {list.activeLocationId === s.id
                    ? "Активна"
                    : "Показати локацію"}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="preparation-only">
          <div className="section-intro">
            <span className="eyebrow">THE WORLD BUILDER</span>
            <h3>{selected ? selected.name : "Наступна сцена вашої історії"}</h3>
            <p>
              Підготуйте локацію приватно. Активуйте її, коли група буде готова.
            </p>
          </div>
          <DraftNotice dirty={dirty} />
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              <legend>
                {selected ? "Редагувати локацію" : "Створити локацію"}
              </legend>
              <p>
                <label>
                  Назва{" "}
                  <input
                    required
                    maxLength={120}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              </p>
              <p>
                <label>
                  Опис, видимий гравцям активної локації{" "}
                  <textarea
                    maxLength={4000}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
              </p>
              {!selected && (
                <p>
                  <label>
                    Початковий туман{" "}
                    <select
                      value={initialFog}
                      onChange={(e) => setInitialFog(e.target.value)}
                    >
                      <option value="hidden">Уся локація прихована</option>
                      <option value="revealed">Уся локація відкрита</option>
                    </select>
                  </label>
                </p>
              )}
              <button>{busy ? "Зберігаємо…" : "Зберегти"}</button>
              {selected && (
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      edit(
                        (
                          await api<{ scene: LocationView }>(
                            `${base}/${selected.id}`,
                          )
                        ).scene,
                      );
                    })
                  }
                >
                  Перезавантажити локацію
                </button>
              )}
            </fieldset>
          </form>
          {selected && (
            <div>
              <h4>Фонове зображення</h4>
              {selected.background && (
                <img
                  key={selected.background.id}
                  src={selected.background.url}
                  alt={`Попередній перегляд: ${selected.name}`}
                  style={{ maxWidth: "100%", maxHeight: 240 }}
                />
              )}
              <form key={selected.id} onSubmit={(event) => void upload(event)}>
                <fieldset disabled={busy || !list?.storageAvailable}>
                  <label>
                    PNG/JPG, до 8 МіБ і 20 мегапікселів{" "}
                    <input
                      type="file"
                      name="file"
                      accept="image/png,image/jpeg"
                      required
                    />
                  </label>{" "}
                  <button>
                    {busy
                      ? "Завантаження…"
                      : selected.background
                        ? "Замінити фон"
                        : "Завантажити фон"}
                  </button>
                </fieldset>
              </form>
              {!deleting ? (
                <button disabled={busy} onClick={() => setDeleting(true)}>
                  Видалити локацію…
                </button>
              ) : (
                <p>
                  Видалити «{selected.name}»? Її токени та прив’язані бої також
                  будуть видалені. Якщо вона активна, стіл стане порожнім.{" "}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(
                          `${base}/${selected.id}`,
                          { revision: selected.revision },
                          "DELETE",
                        );
                        edit(null);
                      })
                    }
                  >
                    Так, видалити
                  </button>{" "}
                  <button disabled={busy} onClick={() => setDeleting(false)}>
                    Скасувати
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      </WorkspaceArea>
    </section>
  );
}
