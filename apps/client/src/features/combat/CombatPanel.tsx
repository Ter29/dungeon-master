import { useEffect, useState, type FormEvent } from "react";
import type {
  CombatSnapshot,
  CombatEncounterView,
  CombatParticipantView,
  LocationView,
} from "@dnd/shared";
import { api, errorMessage } from "../../lib/api";
import { useWorkspace } from "../workspace/Workspace";
type Run = (
  path: string,
  body: unknown,
  method?: "POST" | "PATCH" | "DELETE",
) => Promise<boolean>;
function InitiativeInput({
  participant,
  encounter,
  disabled,
  run,
}: {
  participant: CombatParticipantView;
  encounter: CombatEncounterView;
  disabled: boolean;
  run: Run;
}) {
  const [draft, setDraft] = useState<{ value: string; version: number } | null>(
    null,
  );
  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      await run(
        `/${encounter.id}/participants/${participant.id}`,
        {
          version: draft?.version ?? encounter.version,
          initiative: Number(draft?.value ?? participant.initiative),
        },
        "PATCH",
      )
    )
      setDraft(null);
  }
  return (
    <form onSubmit={(e) => void save(e)} style={{ display: "inline-block" }}>
      <label>
        Ініціатива {participant.name}{" "}
        <input
          type="number"
          min="-1000"
          max="1000"
          step="1"
          required
          style={{ width: 80 }}
          disabled={disabled}
          value={draft?.value ?? participant.initiative}
          onChange={(e) =>
            setDraft({
              value: e.target.value,
              version: draft?.version ?? encounter.version,
            })
          }
        />
      </label>{" "}
      <button disabled={disabled}>
        Зберегти ініціативу {participant.name}
      </button>
      {draft && draft.version !== encounter.version && (
        <span> Стан змінився; збереження потребує оновлення.</span>
      )}
      {draft && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setDraft(null)}
        >
          Оновити ініціативу {participant.name}
        </button>
      )}
    </form>
  );
}
export function CombatPanel({
  campaignId,
  dm,
  scene,
  snapshot,
  ready,
  onSnapshot,
  onSync,
}: {
  campaignId: string;
  dm: boolean;
  scene: LocationView | null;
  snapshot: CombatSnapshot | null;
  ready: boolean;
  onSnapshot: (snapshot: CombatSnapshot) => void;
  onSync: () => void;
}) {
  const live = useWorkspace()?.live ?? false;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [tokenId, setTokenId] = useState(""),
    [initiative, setInitiative] = useState("0");
  const encounter = snapshot?.encounter ?? null;
  useEffect(() => {
    setConfirm(false);
    setTokenId("");
    setError("");
  }, [encounter?.id]);
  const disabled = busy || !ready;
  async function run(
    path: string,
    body: unknown,
    method: "POST" | "PATCH" | "DELETE" = "POST",
  ) {
    if (disabled) return false;
    setBusy(true);
    setError("");
    try {
      onSnapshot(
        await api<CombatSnapshot>(
          `/campaigns/${campaignId}/combat${path}`,
          body,
          method,
        ),
      );
      return true;
    } catch (e) {
      setError(errorMessage(e));
      onSync();
      return false;
    } finally {
      setBusy(false);
    }
  }
  function reorder(index: number, offset: number) {
    if (!encounter) return;
    const ids = encounter.participants.map((p) => p.id),
      other = index + offset;
    [ids[index], ids[other]] = [ids[other]!, ids[index]!];
    void run(
      `/${encounter.id}/order`,
      { version: encounter.version, mode: "manual", participantIds: ids },
      "PATCH",
    );
  }
  const tokens =
    scene && (!encounter || scene.id === encounter.sceneId)
      ? scene.tokens.filter(
          (t) => !encounter?.participants.some((p) => p.tokenId === t.id),
        )
      : [];
  const currentIndex =
    encounter?.participants.findIndex(
      (p) => p.id === encounter.currentParticipantId,
    ) ?? -1;
  return (
    <section
      aria-label="Бойова панель"
      style={{ border: "1px solid #888", padding: 12, margin: "12px 0" }}
    >
      <h3>Бій та ініціатива</h3>
      {error && <p role="alert">{error}</p>}
      {dm && encounter?.status === "ACTIVE" && (
        <div className="combat-turnbar">
          <strong>Раунд {encounter.round}</strong>
          <button
            disabled={
              disabled ||
              !encounter.participants.length ||
              (encounter.round === 1 && currentIndex === 0)
            }
            onClick={() =>
              void run(`/${encounter.id}/turn`, {
                version: encounter.version,
                action: "PREVIOUS",
              })
            }
          >
            Попередній хід
          </button>
          <button
            className="primary-button"
            disabled={disabled || !encounter.participants.length}
            onClick={() =>
              void run(`/${encounter.id}/turn`, {
                version: encounter.version,
                action: "NEXT",
              })
            }
          >
            Наступний хід
          </button>
          <button
            disabled={disabled || !encounter.participants.length}
            onClick={() =>
              void run(`/${encounter.id}/turn`, {
                version: encounter.version,
                action: "SKIP",
              })
            }
          >
            Пропустити хід
          </button>
        </div>
      )}
      {!snapshot ? (
        <p>Очікуємо актуальний стан бою…</p>
      ) : !encounter ? (
        <>
          <p>Активного бою немає.</p>
          {dm && (
            <button
              disabled={disabled || !scene}
              onClick={() => void run("", { sceneId: scene!.id })}
            >
              Підготувати бій у цій локації
            </button>
          )}
        </>
      ) : (
        <>
          <p>
            {encounter.status === "PREPARING"
              ? "Підготовка до бою"
              : "Бій триває"}{" "}
            · {encounter.sceneName} · <strong>Раунд {encounter.round}</strong>
          </p>
          {dm && scene?.id !== encounter.sceneId && (
            <p>
              Бій належить іншій локації. Щоб додавати її токени, активуйте «
              {encounter.sceneName}» у менеджері локацій. Поточний бій
              збережено.
            </p>
          )}
          {encounter.status === "ACTIVE" && (
            <p>
              {encounter.currentParticipantId ? (
                <>
                  Активний персонаж:{" "}
                  <strong>
                    {
                      encounter.participants.find(
                        (p) => p.id === encounter.currentParticipantId,
                      )?.name
                    }
                  </strong>
                </>
              ) : dm ? (
                "Додайте учасників, щоб продовжити бій."
              ) : (
                "DM проводить хід."
              )}
            </p>
          )}
          <ol aria-label="Черговість ініціативи">
            {encounter.participants.map((p, index) => (
              <li
                key={p.id}
                data-combat-participant={p.id}
                aria-current={
                  p.id === encounter.currentParticipantId ? "step" : undefined
                }
              >
                {p.id === encounter.currentParticipantId ? (
                  <strong>{p.name} ← поточний хід</strong>
                ) : (
                  <span>{p.name}</span>
                )}{" "}
                · Ініціатива {p.initiative}
                {dm && !p.visible && <em> · не видно гравцям</em>}
                {dm && (
                  <details className="initiative-editor">
                    <summary>Редагувати {p.name}</summary>
                    <div>
                      <InitiativeInput
                        participant={p}
                        encounter={encounter}
                        disabled={disabled}
                        run={run}
                      />{" "}
                      <button
                        disabled={disabled || index === 0}
                        aria-label={`Підняти ${p.name}`}
                        onClick={() => reorder(index, -1)}
                      >
                        ↑
                      </button>{" "}
                      <button
                        disabled={
                          disabled ||
                          index === encounter.participants.length - 1
                        }
                        aria-label={`Опустити ${p.name}`}
                        onClick={() => reorder(index, 1)}
                      >
                        ↓
                      </button>{" "}
                      <button
                        disabled={disabled}
                        onClick={() =>
                          void run(
                            `/${encounter.id}/participants/${p.id}`,
                            { version: encounter.version },
                            "DELETE",
                          )
                        }
                      >
                        Прибрати {p.name} з бою
                      </button>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ol>
          {dm && (
            <>
              <p>
                Порядок: {encounter.manualOrder ? "ручний" : "за ініціативою"}.
                Однакові значення — за порядком додавання.
              </p>
              <details open={!live}>
                <summary>Учасники та порядок · DM</summary>
                <fieldset disabled={disabled}>
                  <legend>Керування списком</legend>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (tokens.some((t) => t.id === tokenId))
                        void run(`/${encounter.id}/participants`, {
                          version: encounter.version,
                          tokenId,
                          initiative: Number(initiative),
                        }).then((ok) => {
                          if (ok) setTokenId("");
                        });
                    }}
                  >
                    <label>
                      Токен для бою{" "}
                      <select
                        required
                        value={tokenId}
                        onChange={(e) => setTokenId(e.target.value)}
                      >
                        <option value="">Оберіть токен…</option>
                        {tokens.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.hidden ? " · прихований" : ""}
                          </option>
                        ))}
                      </select>
                    </label>{" "}
                    <label>
                      Ініціатива нового учасника{" "}
                      <input
                        required
                        type="number"
                        min="-1000"
                        max="1000"
                        step="1"
                        value={initiative}
                        onChange={(e) => setInitiative(e.target.value)}
                      />
                    </label>{" "}
                    <button disabled={!tokens.some((t) => t.id === tokenId)}>
                      Додати учасника бою
                    </button>
                  </form>
                  <button
                    onClick={() =>
                      void run(
                        `/${encounter.id}/order`,
                        { version: encounter.version, mode: "initiative" },
                        "PATCH",
                      )
                    }
                  >
                    Сортувати за ініціативою
                  </button>
                </fieldset>
              </details>
              {encounter.status === "PREPARING" ? (
                <button
                  disabled={disabled || !encounter.participants.length}
                  onClick={() =>
                    void run(`/${encounter.id}/start`, {
                      version: encounter.version,
                    })
                  }
                >
                  Почати бій · раунд 1
                </button>
              ) : (
                <p className="secondary-turnbar">
                  <button
                    disabled={
                      disabled ||
                      !encounter.participants.length ||
                      (encounter.round === 1 && currentIndex === 0)
                    }
                    onClick={() =>
                      void run(`/${encounter.id}/turn`, {
                        version: encounter.version,
                        action: "PREVIOUS",
                      })
                    }
                  >
                    Previous Turn
                  </button>{" "}
                  <button
                    disabled={disabled || !encounter.participants.length}
                    onClick={() =>
                      void run(`/${encounter.id}/turn`, {
                        version: encounter.version,
                        action: "NEXT",
                      })
                    }
                  >
                    Next Turn
                  </button>{" "}
                  <button
                    disabled={disabled || !encounter.participants.length}
                    onClick={() =>
                      void run(`/${encounter.id}/turn`, {
                        version: encounter.version,
                        action: "SKIP",
                      })
                    }
                  >
                    Skip Turn
                  </button>
                </p>
              )}
              {!confirm ? (
                <button disabled={disabled} onClick={() => setConfirm(true)}>
                  Завершити бій…
                </button>
              ) : (
                <p>
                  Завершити поточний бій?{" "}
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void run(`/${encounter.id}/end`, {
                        version: encounter.version,
                        confirm: true,
                      })
                    }
                  >
                    Так, завершити бій
                  </button>{" "}
                  <button disabled={disabled} onClick={() => setConfirm(false)}>
                    Скасувати завершення
                  </button>
                </p>
              )}
              <p>
                Next / Skip переходять до наступного учасника; Skip пропускає
                лише поточний хід. Зміни порядку зберігають активного учасника.
              </p>
            </>
          )}
        </>
      )}
      {busy && <p role="status">Зберігаємо стан бою…</p>}
    </section>
  );
}
