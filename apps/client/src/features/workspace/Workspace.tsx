import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "./icons";
export type Section =
  "table" | "scenes" | "maps" | "director" | "audio" | "combat" | "campaign";
type Summary = {
  scene: string;
  mode: string;
  sync: string;
  music: string;
  members: number;
};
type WorkspaceState = {
  live: boolean;
  immersive: boolean;
  setLive: (value: boolean) => void;
  section: Section;
  dm: boolean;
  summary: Summary;
  navigate: (s: Section) => void;
  update: (s: Partial<Summary>) => void;
  targets: Record<string, HTMLElement>;
  register: (name: string, node: HTMLElement | null) => void;
  draft: (key: string, dirty: boolean) => void;
  drafts: Record<string, boolean>;
};
const Context = createContext<WorkspaceState | null>(null);
export function useWorkspace() {
  return useContext(Context);
}
const sections: { id: Section; label: string; subtitle: string }[] = [
  { id: "table", label: "Table", subtitle: "Ігровий стіл" },
  { id: "scenes", label: "Scenes", subtitle: "Підготовка локацій" },
  { id: "maps", label: "Maps", subtitle: "Карти та знання" },
  { id: "director", label: "Director", subtitle: "Кінематографічна подача" },
  { id: "audio", label: "Audio", subtitle: "Музика й атмосфера" },
  { id: "combat", label: "Combat", subtitle: "Ініціатива та ходи" },
  { id: "campaign", label: "Campaign", subtitle: "Група та запрошення" },
];
function Target({ name }: { name: string }) {
  const workspace = useWorkspace()!,
    [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    workspace.register(name, node);
    return () => workspace.register(name, null);
  }, [name, node, workspace.register]);
  return <div ref={setNode} data-workspace-slot={name} />;
}
export function WorkspaceArea({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  const w = useWorkspace();
  if (!w) return <>{children}</>;
  return w.targets[name] ? createPortal(children, w.targets[name], name) : null;
}
export function useDraftWarning(key: string, dirty: boolean) {
  const draft = useWorkspace()?.draft;
  useEffect(() => {
    draft?.(key, dirty);
    return () => draft?.(key, false);
  }, [key, dirty, draft]);
}
export function DraftNotice({ dirty }: { dirty: boolean }) {
  return dirty ? (
    <p className="draft-notice">
      <span /> Незбережені зміни · натисніть «Зберегти»
    </p>
  ) : null;
}
export function CommandCenter({
  campaignId,
  name,
  dm,
  children,
}: {
  campaignId: string;
  name: string;
  dm: boolean;
  children: ReactNode;
}) {
  const { user, logout } = useAuth(),
    preference = `obsidian-workspace:${user?.id}:${campaignId}`;
  const allowed = dm
    ? sections
    : sections.filter((s) =>
        ["table", "maps", "combat", "campaign"].includes(s.id),
      );
  const [section, setSection] = useState<Section>(() => {
    try {
      const s = localStorage.getItem(preference);
      return allowed.some((a) => a.id === s) ? (s as Section) : "table";
    } catch {
      return "table";
    }
  });
  const [collapsed, setCollapsed] = useState(false),
    [targets, setTargets] = useState<Record<string, HTMLElement>>({}),
    [drafts, setDrafts] = useState<Record<string, boolean>>({}),
    [summary, setSummary] = useState<Summary>({
      scene: "Порожній стіл",
      mode: "Підключення",
      sync: "Підключення…",
      music: "Тиша",
      members: 0,
    }),
    [error, setError] = useState("");
  const [live, setLiveState] = useState(() => {
    try {
      return !dm || localStorage.getItem(`${preference}:mode`) === "live";
    } catch {
      return !dm;
    }
  });
  const [immersive, setImmersive] = useState(false);
  const setLive = useCallback(
    (value: boolean) => {
      setLiveState(value);
      try {
        localStorage.setItem(
          `${preference}:mode`,
          value ? "live" : "preparation",
        );
      } catch {}
    },
    [preference],
  );
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImmersive(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  const navigate = useCallback(
    (s: Section) => {
      if (!dm && !["table", "maps", "combat", "campaign"].includes(s)) return;
      setSection(s);
      try {
        localStorage.setItem(preference, s);
      } catch {}
    },
    [dm, preference],
  );
  const update = useCallback(
    (s: Partial<Summary>) => setSummary((old) => ({ ...old, ...s })),
    [],
  );
  const register = useCallback(
    (key: string, node: HTMLElement | null) =>
      setTargets((old) => {
        if (old[key] === node || (!node && !old[key])) return old;
        const next = { ...old };
        if (node) next[key] = node;
        else delete next[key];
        return next;
      }),
    [],
  );
  const draft = useCallback(
    (key: string, dirty: boolean) =>
      setDrafts((old) => (old[key] === dirty ? old : { ...old, [key]: dirty })),
    [],
  );
  const dirty = Object.values(drafts).some(Boolean);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const done = () => {
      setSaved(true);
      clearTimeout(timer);
      timer = setTimeout(() => setSaved(false), 2500);
    };
    window.addEventListener("workspace:saved", done);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("workspace:saved", done);
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const value = useMemo(
    () => ({
      section,
      dm,
      summary,
      navigate,
      update,
      targets,
      register,
      draft,
      drafts,
      live,
      immersive,
      setLive,
    }),
    [
      section,
      dm,
      summary,
      navigate,
      update,
      targets,
      register,
      draft,
      drafts,
      live,
      immersive,
      setLive,
    ],
  );
  const current = allowed.find((s) => s.id === section) ?? allowed[0]!;
  return (
    <Context.Provider value={value}>
      <div
        data-section={section}
        className={`command-center ${dm ? "dm-workspace" : "player-workspace"} ${collapsed ? "context-collapsed" : ""} ${live ? "session-live" : "session-preparation"} ${immersive ? "immersive-workspace" : ""}`}
        onClickCapture={(e) => {
          const a = (e.target as Element).closest("a");
          if (
            dirty &&
            a &&
            new URL(a.href).pathname !== location.pathname &&
            !window.confirm("Є незбережені зміни. Залишити кампанію?")
          )
            e.preventDefault();
        }}
      >
        <aside className="workspace-sidebar">
          <Link
            className="workspace-brand"
            to="/campaigns"
            aria-label="Obsidian Table · кампанії"
          >
            <Icon name="brand" />
            <span>
              OBSIDIAN<span>TABLE</span>
            </span>
          </Link>
          <div className="sidebar-caption">
            {dm ? "COMMAND CENTER" : "YOUR ADVENTURE"}
          </div>
          <nav aria-label="Розділи кампанії">
            {allowed.map((s) => (
              <button
                key={s.id}
                aria-current={section === s.id ? "page" : undefined}
                onClick={() => navigate(s.id)}
                title={`${s.label} — ${s.subtitle}`}
              >
                <Icon name={s.id} />
                <span>{s.label}</span>
                {section === s.id && <i />}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="avatar">
              {user?.displayName.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{user?.displayName}</strong>
              <small>{dm ? "Dungeon Master" : "Гравець пригоди"}</small>
            </div>
            <button
              aria-label="Вийти з облікового запису"
              title="Вийти"
              onClick={() => {
                if (!dirty || window.confirm("Вийти з незбереженими змінами?"))
                  void logout().catch(() =>
                    setError("Не вдалося вийти. Спробуйте знову."),
                  );
              }}
            >
              <Icon name="exit" />
            </button>
          </div>
        </aside>
        <header className="workspace-header">
          <div>
            <span className="eyebrow">
              {dm ? "КАМПАНІЯ МАЙСТРА" : "СПІЛЬНА ПРИГОДА"}
            </span>
            <h1>{name}</h1>
          </div>
          <div className="header-status">
            <span
              className={`connection-dot ${summary.sync === "Онлайн" ? "connected" : ""}`}
            />
            <span>
              {summary.sync === "Онлайн" ? "Синхронізовано" : summary.sync}
            </span>
            <span className="member-count">
              <Icon name="users" />
              {summary.members}
            </span>
          </div>
          <button
            className="quiet-button"
            onClick={() => navigate("table")}
            title="Швидко повернутися до ігрового стола"
          >
            <Icon name="table" />
            До стола
          </button>
        </header>
        <div className="workspace-heading">
          <div>
            <span className="eyebrow">
              {dm ? "DUNGEON MASTER’S WORKSPACE" : "PLAYER VIEW"}
            </span>
            <h2>
              {current.label}
              <span>{current.subtitle}</span>
            </h2>
          </div>
          <div className="workspace-heading-actions">
            {dm && (
              <div
                className="session-switch"
                role="group"
                aria-label="Режим роботи"
              >
                <button aria-pressed={!live} onClick={() => setLive(false)}>
                  Підготовка
                </button>
                <button aria-pressed={live} onClick={() => setLive(true)}>
                  Жива сесія
                </button>
              </div>
            )}
            {saved && (
              <span className="saved-pill" role="status">
                ✓ Зміни збережено
              </span>
            )}
            {dirty && <span className="draft-pill">Є незбережені зміни</span>}
            <button
              className="quiet-button"
              aria-expanded={!collapsed}
              aria-controls="workspace-context"
              onClick={() => setCollapsed((v) => !v)}
              title={
                collapsed ? "Відкрити інструменти" : "Більше місця для полотна"
              }
            >
              <Icon name="panel" />
              {collapsed ? "Інструменти" : "Згорнути панель"}
            </button>
            <button
              className="quiet-button"
              aria-pressed={immersive}
              onClick={() => setImmersive((v) => !v)}
            >
              Занурення
            </button>
          </div>
        </div>
        <main className="workspace-main" id="workspace-main" tabIndex={-1}>
          {error && <p role="alert">{error}</p>}
          {allowed.map((s) => (
            <section
              key={s.id}
              hidden={section !== s.id}
              className={`workspace-pane pane-${s.id}`}
              aria-label={`${s.label} — робоча область`}
            >
              <Target name={`${s.id}.main`} />
            </section>
          ))}
          <div className="workspace-component-host">{children}</div>
        </main>
        <aside
          className="workspace-context"
          id="workspace-context"
          hidden={collapsed}
        >
          <div className="context-heading">
            <span className="eyebrow">
              {dm ? "DM TOOLS" : "ПОРУЧ ІЗ ПРИГОДОЮ"}
            </span>
            <h3>{current.subtitle}</h3>
          </div>
          {allowed.map((s) => (
            <section
              key={s.id}
              hidden={section !== s.id}
              aria-label={`${s.label} — контекст`}
            >
              <Target name={`${s.id}.context`} />
            </section>
          ))}
        </aside>
        <footer className="workspace-footer">
          {immersive && (
            <button
              className="quiet-button"
              onClick={() => setImmersive(false)}
            >
              Повернути інтерфейс · Esc
            </button>
          )}
          <span>
            <span
              className={`connection-dot ${summary.sync === "Онлайн" ? "connected" : ""}`}
            />{" "}
            {summary.scene}
          </span>
          <span>
            Гравці бачать <strong>{summary.mode}</strong>
          </span>
          <span className="footer-music">
            <Icon name="audio" />
            {summary.music}
          </span>
          <span>
            OBSIDIAN TABLE <em>·</em> {dm ? "DM" : "PLAYER"}
          </span>
          <Target name="audio.footer" />
        </footer>
      </div>
    </Context.Provider>
  );
}
