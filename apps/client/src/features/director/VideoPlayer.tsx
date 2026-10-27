import { useEffect, useRef, useState } from "react";
import { videoPosition, type DirectorSnapshot } from "@dnd/shared";
import { api, errorMessage } from "../../lib/api";
import { usePlayback } from "../audio/PlaybackContext";
import "./video.css";
export function VideoPlayer({
  campaignId,
  state,
  dm,
  onState,
  refresh,
  closing = false,
}: {
  campaignId: string;
  state: DirectorSnapshot;
  dm: boolean;
  onState: (s: DirectorSnapshot) => void;
  refresh: () => Promise<void>;
  closing?: boolean;
}) {
  const audio = usePlayback(),
    v = state.video!,
    root = useRef<HTMLElement | null>(null),
    element = useRef<HTMLVideoElement | null>(null),
    offset = useRef((state.serverTime ?? Date.now()) - Date.now()),
    spec = useRef(v),
    [status, setStatus] = useState("Завантажуємо відеосцену…"),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [visualReady, setVisualReady] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => previous?.focus();
  }, []);
  spec.current = v;
  useEffect(() => {
    offset.current = (state.serverTime ?? Date.now()) - Date.now();
  }, [state.version]);
  const engine = audio?.engine,
    enabled = audio?.enabled ?? false;
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    el.muted = !enabled;
    if (enabled) return engine?.attachVideo(el);
  }, [engine, enabled, attempt, v.asset.id]);
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    let disposed = false,
      pending = false,
      last = 0;
    const duck = (active: boolean) =>
      engine?.setVideoDucking(
        active && enabled && spec.current.asset.hasAudio,
        spec.current.duckMusic,
        spec.current.duckAmbience,
      );
    const playing = () => {
      setStatus(
        enabled
          ? "Відео відтворюється"
          : "Відео без звуку · натисніть «Увімкнути звук»",
      );
      setFailed(false);
      duck(true);
    };
    const waiting = () => {
      setStatus("Завантажуємо відео… Сцена наздожене поточну позицію.");
      duck(false);
    };
    const fail = () => {
      setFailed(true);
      setStatus(
        "Відео недоступне або формат не підтримується. Повторіть спробу.",
      );
      duck(false);
    };
    const sync = async (force = false) => {
      if (disposed || pending) return;
      const current = spec.current,
        now = Date.now() + offset.current,
        wanted = videoPosition(current, now);
      if (closing) {
        el.pause();
        duck(false);
        return;
      }
      if (wanted >= current.asset.duration) {
        el.pause();
        duck(false);
        setStatus("Відеосцена завершилася. Повертаємо попередній екран…");
        void refresh();
        return;
      }
      if (el.readyState < 1) return;
      if (force || Date.now() - last > 3000) {
        last = Date.now();
        if (Math.abs(el.currentTime - wanted) > 1.2)
          try {
            el.currentTime = wanted;
          } catch {
            /* retry after metadata */
          }
      }
      if (current.status !== "PLAYING") {
        el.pause();
        duck(false);
        setStatus("Відео на паузі");
        return;
      }
      if (el.paused) {
        pending = true;
        try {
          await el.play();
          if (disposed) el.pause();
        } catch {
          if (!disposed) {
            setStatus(
              "Браузер не запустив відео. Натисніть «Повторити відео / звук».",
            );
            duck(false);
          }
        } finally {
          pending = false;
        }
      }
    };
    const metadata = () => void sync(true),
      ended = () => {
        duck(false);
        setStatus("Відеосцена завершилася. Повертаємо попередній екран…");
        void refresh();
      };
    el.addEventListener("loadedmetadata", metadata);
    el.addEventListener("playing", playing);
    el.addEventListener("waiting", waiting);
    el.addEventListener("error", fail);
    el.addEventListener("ended", ended);
    const timer = setInterval(() => void sync(), 1000);
    const slow = window.setTimeout(() => {
      if (el.readyState < 2 && !disposed) {
        setStatus(
          "Відео завантажується довше звичайного. Перевірте мережу або повторіть спробу.",
        );
        duck(false);
      }
    }, 10000);
    void sync(true);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.clearTimeout(slow);
      el.removeEventListener("loadedmetadata", metadata);
      el.removeEventListener("playing", playing);
      el.removeEventListener("waiting", waiting);
      el.removeEventListener("error", fail);
      el.removeEventListener("ended", ended);
      el.pause();
      duck(false);
    };
  }, [engine, enabled, attempt, v.asset.id, v.status, state.version, closing]);
  async function command(action: string) {
    setBusy(true);
    setError("");
    try {
      onState(
        await api<DirectorSnapshot>(`/campaigns/${campaignId}/director/video`, {
          version: state.version,
          action,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      className="video-cinema"
      aria-label="Відеосцена Director"
      data-video-status={v.status}
      data-closing={closing}
      data-ready={visualReady}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const controls = [
          ...root.current!.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled)",
          ),
        ];
        const first = controls[0],
          last = controls.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === root.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
    >
      <video
        key={`${v.asset.id}:${attempt}`}
        ref={element}
        src={v.asset.url}
        playsInline
        preload="auto"
        muted={!enabled}
        controls={false}
        disablePictureInPicture
        controlsList="nodownload noremoteplayback"
        onLoadedData={() => setVisualReady(true)}
        onError={() => setVisualReady(false)}
        aria-label={v.asset.name}
      />
      <div className="video-cinema-controls">
        <strong>{v.asset.name}</strong>
        <span role={failed ? "alert" : "status"}>{status}</span>
        {error && <p role="alert">{error}</p>}
        <button
          onClick={() => {
            audio?.enable();
            setFailed(false);
            setVisualReady(false);
            setAttempt((n) => n + 1);
          }}
        >
          Повторити відео / звук
        </button>
        {!enabled && (
          <button onClick={() => audio?.enable()}>Увімкнути звук</button>
        )}
        <label>
          Гучність відео{" "}
          <input
            aria-label="video volume"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={audio?.local.video ?? 0.8}
            onChange={(e) =>
              audio &&
              audio.change({ ...audio.local, video: Number(e.target.value) })
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={audio?.local.muted ?? false}
            onChange={(e) =>
              audio && audio.change({ ...audio.local, muted: e.target.checked })
            }
          />
          Без звуку
        </label>
        <button
          onClick={() => {
            const root = element.current?.parentElement;
            if (!document.fullscreenElement)
              void root
                ?.requestFullscreen()
                .catch(() =>
                  setError(
                    "Повноекранний режим недоступний. Кінематографічний екран уже розгорнуто.",
                  ),
                );
            else void document.exitFullscreen();
          }}
        >
          На весь екран
        </button>
        {dm && (
          <div className="video-dm-actions">
            <button
              disabled={busy || v.status !== "PLAYING"}
              onClick={() => void command("PAUSE")}
            >
              Пауза відео
            </button>
            <button
              disabled={busy || v.status !== "PAUSED"}
              onClick={() => void command("RESUME")}
            >
              Продовжити відео
            </button>
            <button disabled={busy} onClick={() => void command("STOP")}>
              Зупинити відео
            </button>
            <button disabled={busy} onClick={() => void command("RETURN")}>
              Повернути попередній екран
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
