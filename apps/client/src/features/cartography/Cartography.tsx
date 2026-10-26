import { useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  CartographyCatalog,
  SharedMapView,
  MapElementView,
  CartographyPoint,
  ClientEvents,
  ServerEvents,
} from "@dnd/shared";
import { api, ApiError, errorMessage } from "../../lib/api";
import { CartographyCanvas } from "./CartographyCanvas";
import { ElementEditor } from "./ElementEditor";
import { MapAdmin, FragmentAdmin } from "./CartographyAdmin";
import { WorkspaceArea } from "../workspace/Workspace";
export function Cartography({
  campaignId,
  dm,
}: {
  campaignId: string;
  dm: boolean;
}) {
  const base = `/campaigns/${campaignId}/cartography`;
  const [catalog, setCatalog] = useState<CartographyCatalog | null>(null),
    [map, setMap] = useState<SharedMapView | null>(null);
  const [selectedId, setSelectedId] = useState(""),
    [selectedElement, setSelectedElement] = useState("");
  const [tool, setTool] = useState("select"),
    [text, setText] = useState(""),
    [color, setColor] = useState("#242424"),
    [fragmentId, setFragmentId] = useState("");
  const [online, setOnline] = useState(false),
    [status, setStatus] = useState("Підключення…"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const selection = useRef(""),
    reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let alive = true,
      loading = false,
      wanted = 0;
    async function load() {
      wanted++;
      if (loading) return;
      loading = true;
      try {
        while (alive) {
          const request = wanted,
            id = selection.current;
          try {
            const next = await api<CartographyCatalog>(base);
            let nextMap: SharedMapView | null = null;
            if (id && next.maps.some((m) => m.id === id)) {
              try {
                nextMap = (
                  await api<{ map: SharedMapView }>(`${base}/maps/${id}`)
                ).map;
              } catch (e) {
                if (!(e instanceof ApiError && e.status === 404)) throw e;
              }
            }
            if (alive && request === wanted && selection.current === id) {
              setCatalog(next);
              setMap((previous) =>
                previous &&
                nextMap &&
                previous.id === nextMap.id &&
                previous.dataVersion > nextMap.dataVersion
                  ? previous
                  : nextMap,
              );
              if (id && !nextMap) {
                selection.current = "";
                setSelectedId("");
                setSelectedElement("");
              }
            }
          } catch (e) {
            if (alive) {
              setError(errorMessage(e));
              if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
                setMap(null);
                setCatalog(null);
              }
            }
          }
          if (request === wanted) break;
        }
      } finally {
        loading = false;
      }
    }
    reload.current = load;
    const socket: Socket<ServerEvents, ClientEvents> = io({
      auth: { campaignId },
      autoConnect: false,
    });
    socket.on("connect", () => {
      setOnline(true);
      setStatus("Онлайн");
      void load();
    });
    socket.on("cartography:changed", () => void load());
    socket.on("disconnect", () => {
      setOnline(false);
      setStatus("З’єднання втрачено. Перепідключення…");
    });
    socket.on("connect_error", (e) => {
      setOnline(false);
      setStatus(e.message);
    });
    socket.connect();
    void load();
    return () => {
      alive = false;
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [base, campaignId]);
  useEffect(() => {
    if (
      fragmentId &&
      catalog &&
      !catalog.fragments.some((f) => f.id === fragmentId)
    ) {
      setFragmentId("");
      setTool("select");
    }
  }, [catalog, fragmentId]);
  function choose(id: string) {
    selection.current = id;
    setSelectedId(id);
    setSelectedElement("");
    setMap(null);
    setTool("select");
    setError("");
    void reload.current();
  }
  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      return await task();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await reload.current();
      setBusy(false);
    }
  }
  async function create(
    fields: Partial<MapElementView> & { kind: MapElementView["kind"] },
  ) {
    if (!map) return;
    const id = map.id;
    await run(async () => {
      const { element } = await api<{ element: MapElementView }>(
        `${base}/maps/${id}/elements`,
        fields,
      );
      setSelectedElement(element.id);
      setTool("select");
    });
  }
  async function move(e: MapElementView, p: CartographyPoint) {
    if (!map) return;
    const id = map.id;
    await run(async () => {
      await api(
        `${base}/maps/${id}/elements/${e.id}`,
        { ...p, revision: e.revision },
        "PATCH",
      );
    });
  }
  async function save(e: MapElementView) {
    if (!map) return;
    const id = map.id;
    return run(async () => {
      return (
        await api<{ element: MapElementView }>(
          `${base}/maps/${id}/elements/${e.id}`,
          {
            revision: e.revision,
            text: e.text,
            color: e.color,
            x: e.x,
            y: e.y,
            points: e.points,
            scale: e.scale,
            rotation: e.rotation,
            ...(dm ? { locked: e.locked } : {}),
          },
          "PATCH",
        )
      ).element;
    });
  }
  async function remove(e: MapElementView) {
    if (!map) return;
    const id = map.id;
    await run(async () => {
      await api(
        `${base}/maps/${id}/elements/${e.id}`,
        { revision: e.revision },
        "DELETE",
      );
      setSelectedElement("");
    });
  }
  function addFragment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      name = String(new FormData(form).get("name"));
    void run(async () => {
      await api(`${base}/fragments`, { name });
      form.reset();
    });
  }
  const ready = online && !busy,
    element = map?.elements.find((e) => e.id === selectedElement),
    selected = catalog?.maps.find((m) => m.id === selectedId) ?? null;
  return (
    <section aria-label="Карти кампанії">
      <h3>Карти та знання світу</h3>
      <p role="status">
        {status}
        {busy ? " · Зберігаємо…" : ""}
      </p>
      {error && <p role="alert">{error}</p>}
      <p>
        Ці карти відображають знання групи й не перемикають активну бойову
        локацію.
      </p>
      <button onClick={() => void reload.current()}>Оновити карти</button>{" "}
      {dm && <button onClick={() => choose("")}>Нова спільна карта</button>}
      {!catalog ? (
        <p>Завантаження карт…</p>
      ) : (
        <>
          <nav aria-label="Список карт">
            {catalog.maps.length ? (
              catalog.maps.map((m) => (
                <button
                  key={m.id}
                  aria-pressed={selectedId === m.id}
                  onClick={() => choose(m.id)}
                >
                  {m.name}
                  {dm && !m.available ? " · приватна" : ""}
                </button>
              ))
            ) : (
              <p>Доступних карт ще немає.</p>
            )}
          </nav>
          {map && (
            <>
              <h4>{map.name}</h4>
              <p>{map.description}</p>
              <WorkspaceArea name="maps.context">
                <fieldset disabled={!ready}>
                  <legend>Інструменти картографії</legend>
                  <label>
                    Інструмент карти{" "}
                    <select
                      value={tool}
                      onChange={(e) => setTool(e.target.value)}
                    >
                      <option value="select">Вибір / камера</option>
                      <option value="NOTE">Текстова нотатка</option>
                      <option value="MARKER">Маркер</option>
                      <option value="LINE">Лінія</option>
                      <option value="ROUTE">Маршрут</option>
                      <option value="CONTOUR">Приблизний контур</option>
                      <option
                        value="FRAGMENT"
                        disabled={
                          !catalog.fragments.some(
                            (f) => f.id === fragmentId && f.image,
                          )
                        }
                      >
                        Розмістити фрагмент
                      </option>
                    </select>
                  </label>{" "}
                  <label>
                    Текст нового елемента{" "}
                    <input
                      maxLength={1000}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </label>{" "}
                  <label>
                    Колір нового елемента{" "}
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                    />
                  </label>
                  <p>
                    Нотатку, маркер чи обраний фрагмент додайте натисканням на
                    карту. Лінію, маршрут або контур намалюйте перетягуванням.
                    Збереження — після відпускання кнопки.
                  </p>
                </fieldset>
              </WorkspaceArea>
              <CartographyCanvas
                key={map.id}
                map={map}
                dm={dm}
                ready={ready}
                tool={tool}
                text={text}
                color={color}
                fragmentId={fragmentId}
                onCreate={create}
                onMove={move}
                onSelect={(e) => setSelectedElement(e.id)}
              />
              <WorkspaceArea name="maps.context">
                <label>
                  Обраний елемент{" "}
                  <select
                    value={selectedElement}
                    onChange={(e) => setSelectedElement(e.target.value)}
                  >
                    <option value="">Оберіть…</option>
                    {map.elements.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.text || e.fragment?.name || e.kind}
                        {e.locked ? " · 🔒" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {element && (
                  <ElementEditor
                    key={element.id}
                    element={element}
                    dm={dm}
                    ready={ready}
                    save={save}
                    remove={remove}
                  />
                )}
              </WorkspaceArea>
            </>
          )}
          <WorkspaceArea name="maps.context">
            <section aria-label="Бібліотека фрагментів">
              <h4>
                {dm ? "Бібліотека фрагментів · DM" : "Отримані фрагменти"}
              </h4>
              {catalog.fragments.length === 0 && <p>Фрагментів ще немає.</p>}
              <ul>
                {catalog.fragments.map((f) => (
                  <li key={f.id}>
                    <strong>{f.name}</strong>
                    {dm && <span> · {f.issued ? "виданий" : "приватний"}</span>}
                    {f.image && (
                      <>
                        <p>
                          <img
                            src={f.image.url}
                            alt={`Фрагмент: ${f.name}`}
                            style={{ maxWidth: 220, maxHeight: 130 }}
                          />
                        </p>
                        <button
                          disabled={!ready || !map}
                          onClick={() => {
                            setFragmentId(f.id);
                            setTool("FRAGMENT");
                          }}
                        >
                          Обрати фрагмент «{f.name}»
                        </button>
                      </>
                    )}
                    {dm && (
                      <FragmentAdmin
                        key={`${f.id}:${f.revision}`}
                        base={base}
                        fragment={f}
                        ready={ready}
                        storage={catalog.storageAvailable}
                        run={run}
                      />
                    )}
                  </li>
                ))}
              </ul>
              {dm && (
                <form onSubmit={addFragment}>
                  <fieldset disabled={!ready}>
                    <label>
                      Новий приватний фрагмент{" "}
                      <input name="name" maxLength={120} required />
                    </label>
                    <button>Створити приватний фрагмент</button>
                  </fieldset>
                </form>
              )}
            </section>
            {dm && (
              <MapAdmin
                key={selected?.id ?? "new"}
                base={base}
                map={selected}
                ready={ready}
                storage={catalog.storageAvailable}
                run={run}
                choose={choose}
              />
            )}
            {!catalog.storageAvailable && dm && (
              <p>
                Завантаження зображень недоступне: перевірте налаштування
                сховища.
              </p>
            )}
          </WorkspaceArea>
        </>
      )}
    </section>
  );
}
