import { useEffect, useState, type FormEvent } from "react";
import type { LocationView, TokenView } from "@dnd/shared";
import { api, errorMessage } from "../../lib/api";
import { useDraftWarning, DraftNotice } from "../workspace/Workspace";
export function TokenManager({
  scene,
  campaignId,
}: {
  scene: LocationView;
  campaignId: string;
}) {
  const base = `/campaigns/${campaignId}/locations/${scene.id}`;
  const [selected, setSelected] = useState<TokenView | null>(null),
    [name, setName] = useState(""),
    [kind, setKind] = useState<TokenView["kind"]>("NPC");
  const [x, setX] = useState(50),
    [y, setY] = useState(50),
    [size, setSize] = useState(50),
    [hidden, setHidden] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const [grid, setGrid] = useState(scene.grid);
  const dirty =
    name !== (selected?.name ?? "") ||
    kind !== (selected?.kind ?? "NPC") ||
    x !== (selected?.x ?? Math.min(50, scene.width)) ||
    y !== (selected?.y ?? Math.min(50, scene.height)) ||
    size !== (selected?.size ?? 50) ||
    hidden !== (selected?.hidden ?? true);
  const gridDirty = JSON.stringify(grid) !== JSON.stringify(scene.grid);
  useDraftWarning("token-editor", dirty || gridDirty);
  useEffect(
    () => setGrid(scene.grid),
    [
      scene.grid.visible,
      scene.grid.size,
      scene.grid.offsetX,
      scene.grid.offsetY,
    ],
  );
  function edit(token: TokenView | null) {
    setSelected(token);
    setName(token?.name ?? "");
    setKind(token?.kind ?? "NPC");
    setX(token?.x ?? Math.min(50, scene.width));
    setY(token?.y ?? Math.min(50, scene.height));
    setSize(token?.size ?? 50);
    setHidden(token?.hidden ?? true);
    setDeleting(false);
    setError("");
  }
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const result = await api<{ token: TokenView }>(
        selected ? `${base}/tokens/${selected.id}` : `${base}/tokens`,
        {
          name,
          kind,
          x,
          y,
          size,
          hidden,
          ...(selected ? { revision: selected.revision } : {}),
        },
        selected ? "PATCH" : "POST",
      );
      edit(result.token);
    });
  }
  const current = selected
    ? scene.tokens.find((t) => t.id === selected.id)
    : null;
  return (
    <section aria-label="Керування токенами й сіткою">
      <h3>Сітка · DM</h3>
      <DraftNotice dirty={gridDirty} />
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await api(
              `${base}/grid`,
              { ...grid, revision: scene.tableRevision },
              "PATCH",
            );
          });
        }}
      >
        <fieldset disabled={busy}>
          <label>
            <input
              type="checkbox"
              checked={grid.visible}
              onChange={(e) => setGrid({ ...grid, visible: e.target.checked })}
            />
            Показувати сітку
          </label>{" "}
          <label>
            Клітинка, px{" "}
            <input
              type="number"
              min={8}
              max={1000}
              required
              value={grid.size}
              onChange={(e) =>
                setGrid({ ...grid, size: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Зміщення X{" "}
            <input
              type="number"
              min={-10000}
              max={10000}
              required
              value={grid.offsetX}
              onChange={(e) =>
                setGrid({ ...grid, offsetX: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Зміщення Y{" "}
            <input
              type="number"
              min={-10000}
              max={10000}
              required
              value={grid.offsetY}
              onChange={(e) =>
                setGrid({ ...grid, offsetY: Number(e.target.value) })
              }
            />
          </label>
          <button>Зберегти сітку</button>
        </fieldset>
      </form>
      <h3>Токени · DM</h3>
      <DraftNotice dirty={dirty} />
      <button
        disabled={busy}
        onClick={() => {
          if (!dirty || window.confirm("Відкинути чернетку токена?"))
            edit(null);
        }}
      >
        Новий токен
      </button>
      <ul>
        {scene.tokens.map((token) => (
          <li key={token.id}>
            <button disabled={busy} onClick={() => edit(token)}>
              {token.name}
            </button>{" "}
            · {token.kind} · ({Math.round(token.x)}, {Math.round(token.y)}) ·{" "}
            {token.hidden ? "прихований" : "видимий"}{" "}
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api<{ token: TokenView }>(
                    `${base}/tokens/${token.id}`,
                    { hidden: !token.hidden, revision: token.revision },
                    "PATCH",
                  );
                  if (selected?.id === token.id) edit(result.token);
                })
              }
            >
              {token.hidden ? "Reveal" : "Приховати"}
            </button>
          </li>
        ))}
      </ul>
      {selected && current?.revision !== selected.revision && (
        <p>
          Токен змінився.{" "}
          <button onClick={() => edit(current ?? null)}>
            Завантажити актуальні дані
          </button>
        </p>
      )}
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <legend>{selected ? "Редагувати токен" : "Створити токен"}</legend>
          <label>
            Назва токена{" "}
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>{" "}
          <label>
            Тип токена{" "}
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as TokenView["kind"])}
            >
              <option value="PLAYER">Player</option>
              <option value="NPC">NPC</option>
              <option value="ENEMY">Enemy</option>
            </select>
          </label>
          <label>
            Координата X{" "}
            <input
              type="number"
              step="any"
              required
              min={0}
              max={scene.width}
              value={x}
              onChange={(e) => setX(Number(e.target.value))}
            />
          </label>
          <label>
            Координата Y{" "}
            <input
              type="number"
              step="any"
              required
              min={0}
              max={scene.height}
              value={y}
              onChange={(e) => setY(Number(e.target.value))}
            />
          </label>
          <label>
            Розмір токена, px{" "}
            <input
              type="number"
              required
              min={4}
              max={2000}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
            Прихований токен
          </label>
          <button>Зберегти токен</button>
        </fieldset>
      </form>
      {selected && (
        <>
          <form
            key={selected.id}
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              data.set("revision", String(selected.revision));
              void run(async () => {
                const result = await api<{ token: TokenView }>(
                  `${base}/tokens/${selected.id}/image`,
                  data,
                );
                edit(result.token);
                form.reset();
              });
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Зображення токена PNG/JPG{" "}
                <input
                  name="file"
                  type="file"
                  accept="image/png,image/jpeg"
                  required
                />
              </label>
              <button>Завантажити зображення токена</button>
            </fieldset>
          </form>
          {!deleting ? (
            <button disabled={busy} onClick={() => setDeleting(true)}>
              Видалити токен…
            </button>
          ) : (
            <p>
              Видалити токен?{" "}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(
                      `${base}/tokens/${selected.id}`,
                      { revision: selected.revision },
                      "DELETE",
                    );
                    edit(null);
                  })
                }
              >
                Так, видалити токен
              </button>{" "}
              <button onClick={() => setDeleting(false)}>Скасувати</button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
