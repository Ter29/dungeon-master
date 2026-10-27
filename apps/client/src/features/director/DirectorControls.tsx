import { useEffect, useState, type FormEvent } from "react";
import type {
  DirectorLibrary,
  DirectorSnapshot,
  DisplayMode,
  PresentationMaterialView,
  PresentationCategory,
} from "@dnd/shared";
import { api, errorMessage } from "../../lib/api";
import { PresentationScreen } from "./PresentationScreen";
import { VideoLibrary } from "./VideoLibrary";
import {
  WorkspaceArea,
  useDraftWarning,
  DraftNotice,
  useWorkspace,
} from "../workspace/Workspace";
type Run = <T>(task: () => Promise<T>) => Promise<T | undefined>;
function MaterialEditor({
  base,
  selected,
  latest,
  disabled,
  storage,
  run,
  onSaved,
  onDeleted,
}: {
  base: string;
  selected: PresentationMaterialView | null;
  latest: PresentationMaterialView | null;
  disabled: boolean;
  storage: boolean;
  run: Run;
  onSaved: (m: PresentationMaterialView) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState(
      selected ?? {
        name: "",
        description: "",
        category: "LOCATION" as PresentationCategory,
        revision: 0,
      },
    ),
    [confirm, setConfirm] = useState(false),
    [uploadError, setUploadError] = useState("");
  const dirty =
    draft.name !== (selected?.name ?? "") ||
    draft.description !== (selected?.description ?? "") ||
    draft.category !== (selected?.category ?? "LOCATION");
  useDraftWarning("material-editor", dirty);
  async function save(event: FormEvent) {
    event.preventDefault();
    const fields = {
      name: draft.name,
      description: draft.description,
      category: draft.category,
    };
    const result = await run(() =>
      api<{ material: PresentationMaterialView }>(
        selected ? `${base}/materials/${selected.id}` : `${base}/materials`,
        selected ? { ...fields, revision: draft.revision } : fields,
        selected ? "PATCH" : "POST",
      ),
    );
    if (result) {
      setDraft(result.material);
      onSaved(result.material);
    }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget,
      data = new FormData(form),
      file = data.get("file");
    setUploadError("");
    if (!(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024) {
      setUploadError("Оберіть PNG/JPG розміром до 8 МіБ.");
      return;
    }
    data.set("revision", String(draft.revision));
    const result = await run(() =>
      api<{ material: PresentationMaterialView }>(
        `${base}/materials/${selected.id}/image`,
        data,
      ),
    );
    if (result) {
      setDraft(result.material);
      onSaved(result.material);
      form.reset();
    }
  }
  return (
    <section aria-label="Редактор презентаційного матеріалу">
      <h4>{selected ? "Редагувати матеріал" : "Новий приватний матеріал"}</h4>
      <DraftNotice dirty={dirty} />
      {selected && latest && latest.revision !== draft.revision && (
        <p role="alert">Матеріал змінився. Оновіть форму перед редагуванням.</p>
      )}
      {selected && latest && (
        <button
          disabled={disabled}
          onClick={() => {
            setDraft(latest);
            onSaved(latest);
            setConfirm(false);
          }}
        >
          Оновити форму матеріалу
        </button>
      )}
      <form onSubmit={(e) => void save(e)}>
        <fieldset disabled={disabled}>
          <p>
            <label>
              Назва матеріалу / ім’я NPC{" "}
              <input
                required
                maxLength={120}
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
            </label>
          </p>
          <p>
            <label>
              Категорія матеріалу{" "}
              <select
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    category: e.target.value as PresentationCategory,
                  }))
                }
              >
                <option value="LOCATION">Location</option>
                <option value="NPC">NPC</option>
                <option value="EVENT">Event</option>
              </select>
            </label>
          </p>
          <p>
            <label>
              Опис для гравців під час показу{" "}
              <textarea
                maxLength={4000}
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
              />
            </label>
          </p>
          <button>
            {selected ? "Зберегти матеріал" : "Створити приватний матеріал"}
          </button>
        </fieldset>
      </form>
      {uploadError && <p role="alert">{uploadError}</p>}
      {selected && (
        <>
          <form onSubmit={(e) => void upload(e)}>
            <fieldset disabled={disabled || !storage}>
              <label>
                Зображення презентації PNG/JPG, до 8 МіБ{" "}
                <input
                  name="file"
                  type="file"
                  accept="image/png,image/jpeg"
                  required
                />
              </label>
              <button>Завантажити зображення презентації</button>
            </fieldset>
          </form>
          <p>
            Перед заміною показаного зображення натисніть Hide. Збережені зміни
            назви й опису активного матеріалу бачать гравці.
          </p>
          {!confirm ? (
            <button disabled={disabled} onClick={() => setConfirm(true)}>
              Видалити матеріал…
            </button>
          ) : (
            <p>
              Видалити матеріал? Якщо він показаний, гравці отримають Blank.{" "}
              <button
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    await api(
                      `${base}/materials/${selected.id}`,
                      { revision: draft.revision },
                      "DELETE",
                    );
                    onDeleted();
                  })
                }
              >
                Підтвердити видалення матеріалу
              </button>{" "}
              <button onClick={() => setConfirm(false)}>
                Скасувати видалення
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
export function DirectorControls({
  campaignId,
  state,
  ready,
  refreshKey,
  onState,
  refreshState,
}: {
  campaignId: string;
  state: DirectorSnapshot | null;
  ready: boolean;
  refreshKey: number;
  onState: (s: DirectorSnapshot) => void;
  refreshState: () => Promise<void>;
}) {
  const base = `/campaigns/${campaignId}/director`;
  const workspace = useWorkspace();
  const [library, setLibrary] = useState<DirectorLibrary | null>(null),
    [selected, setSelected] = useState<PresentationMaterialView | null>(null),
    [preview, setPreview] = useState<{
      material: PresentationMaterialView;
      mode: "ILLUSTRATION" | "PORTRAIT";
    } | null>(null);
  const [mode, setMode] = useState<DisplayMode>("ILLUSTRATION"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [category, setCategory] = useState("ALL");
  async function load() {
    setLibrary(await api<DirectorLibrary>(`${base}/materials`));
  }
  useEffect(() => {
    let alive = true;
    void api<DirectorLibrary>(`${base}/materials`)
      .then((value) => {
        if (alive) setLibrary(value);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [base, refreshKey]);
  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      return await task();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      try {
        await Promise.all([load(), refreshState()]);
      } catch (e) {
        setError(errorMessage(e));
      }
      setBusy(false);
    }
  }
  function choose(m: PresentationMaterialView) {
    if (
      workspace?.drafts["material-editor"] &&
      !window.confirm("Відкинути незбережені зміни матеріалу?")
    )
      return;
    setSelected(m);
    setPreview(null);
    setMode(m.category === "NPC" ? "PORTRAIT" : "ILLUSTRATION");
    setError("");
  }
  async function show(target: DisplayMode) {
    if (!state) return;
    await run(async () => {
      const data =
        target === "TABLE" || target === "BLANK"
          ? { version: state.version, mode: target }
          : {
              version: state.version,
              mode: target,
              materialId: selected?.id,
              materialRevision: selected?.revision,
            };
      onState(await api<DirectorSnapshot>(`${base}/state`, data, "PATCH"));
    });
  }
  const latest = selected
    ? (library?.materials.find((m) => m.id === selected.id) ?? null)
    : null;
  const disabled = !ready || busy,
    needsImage = mode === "ILLUSTRATION" || mode === "PORTRAIT";
  return (
    <section aria-label="Cinematic Scene Director">
      <VideoLibrary
        campaignId={campaignId}
        state={state}
        ready={ready}
        refreshKey={refreshKey}
        onState={onState}
        refresh={refreshState}
      />
      <WorkspaceArea name="director.main">
        <div className="section-intro">
          <span className="eyebrow">SET THE SCENE</span>
          <h3>Момент, який вони запам’ятають</h3>
          <p>
            Покажіть історію. Ігровий стіл і поточний бій залишаться на місці.
          </p>
        </div>
        {error && <p role="alert">{error}</p>}
        <p>
          Гравці зараз бачать: <strong>{state?.mode ?? "Підключення…"}</strong>
          {state?.material ? ` · ${state.material.name}` : ""}
        </p>
        <fieldset disabled={disabled}>
          <legend>Глобальна подача</legend>
          <label>
            Режим подачі{" "}
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as DisplayMode)}
            >
              <option value="TABLE">Table</option>
              <option value="ILLUSTRATION">Illustration</option>
              <option value="PORTRAIT">Portrait</option>
              <option value="BLANK">Blank</option>
            </select>
          </label>{" "}
          <button
            disabled={needsImage && !selected?.image}
            onClick={() => void show(mode)}
          >
            Показати гравцям
          </button>{" "}
          <button onClick={() => void show("BLANK")}>Темний екран</button>{" "}
          <button onClick={() => void show("TABLE")}>Повернути до стола</button>
        </fieldset>
        <div className="director-preview-label">
          <span className="live-pill">
            {preview ? "ПРИВАТНИЙ PREVIEW" : "ЕКРАН ГРАВЦІВ"}
          </span>
          <span>
            {preview
              ? preview.material.name
              : (state?.material?.name ?? state?.mode)}
          </span>
        </div>
        <PresentationScreen
          state={
            preview
              ? {
                  version: preview.material.revision,
                  mode: preview.mode,
                  material: preview.material,
                }
              : state
          }
          label={
            preview ? "Приватний перегляд матеріалу" : "Монітор подачі гравцям"
          }
        />
      </WorkspaceArea>
      <WorkspaceArea name="director.context">
        <p>
          Перегляд бібліотеки та Preview приватні. Ігрова локація й бій не
          перемикаються.
        </p>
        <p>
          <button disabled={busy} onClick={() => void run(load)}>
            Оновити бібліотеку
          </button>{" "}
          <button
            disabled={busy}
            onClick={() => {
              if (
                workspace?.drafts["material-editor"] &&
                !window.confirm("Відкинути незбережені зміни матеріалу?")
              )
                return;
              setSelected(null);
              workspace?.setLive(false);
              setPreview(null);
              setError("");
            }}
          >
            Новий приватний матеріал
          </button>{" "}
          <label>
            Фільтр категорії{" "}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="ALL">Усі</option>
              <option value="LOCATION">Location</option>
              <option value="NPC">NPC</option>
              <option value="EVENT">Event</option>
            </select>
          </label>
        </p>
        {library?.materials.length === 0 && (
          <div className="empty-card">
            Бібліотека порожня. Створіть першу ілюстрацію або портрет NPC.
          </div>
        )}
        {!library ? (
          <p>Завантаження бібліотеки…</p>
        ) : (
          <ul className="director-library-list">
            {library.materials
              .filter((m) => category === "ALL" || m.category === category)
              .map((m) => (
                <li key={m.id}>
                  <strong>{m.name}</strong>
                  <p>
                    {m.category}
                    {state?.material?.id === m.id
                      ? " · показується гравцям"
                      : " · приватний"}
                  </p>
                  {m.image && (
                    <img src={m.image.url} alt={`Бібліотека: ${m.name}`} />
                  )}
                  <button
                    disabled={busy}
                    aria-pressed={selected?.id === m.id}
                    onClick={() => choose(m)}
                  >
                    Обрати «{m.name}»
                  </button>
                </li>
              ))}
          </ul>
        )}
        {selected && (
          <p>
            Обрано: <strong>{selected.name}</strong>
            {latest && latest.revision !== selected.revision && (
              <>
                {" "}
                · матеріал змінився{" "}
                <button disabled={busy} onClick={() => choose(latest)}>
                  Оновити вибір матеріалу
                </button>
              </>
            )}{" "}
            <button
              disabled={busy || !selected.image || !needsImage}
              onClick={() =>
                setPreview({
                  material: selected,
                  mode: mode as "ILLUSTRATION" | "PORTRAIT",
                })
              }
            >
              Preview · тільки DM
            </button>
          </p>
        )}
        {preview && (
          <section aria-label="Приватний Preview">
            <h4>Preview · тільки DM</h4>
            <button onClick={() => setPreview(null)}>Закрити Preview</button>
          </section>
        )}
        <div className="preparation-only">
          <MaterialEditor
            key={selected?.id ?? "new"}
            base={base}
            selected={selected}
            latest={latest}
            disabled={disabled}
            storage={Boolean(library?.storageAvailable)}
            run={run}
            onSaved={(m) => {
              if (!selected)
                setMode(m.category === "NPC" ? "PORTRAIT" : "ILLUSTRATION");
              setSelected(m);
              setPreview(null);
            }}
            onDeleted={() => {
              setSelected(null);
              setPreview(null);
            }}
          />
        </div>
        {busy && <p role="status">Зберігаємо подачу…</p>}
      </WorkspaceArea>
    </section>
  );
}
