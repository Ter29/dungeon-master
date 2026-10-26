import { useEffect, useState } from "react";
import type { DirectorSnapshot } from "@dnd/shared";
import "./director.css";
function PresentationContent({ state }: { state: DirectorSnapshot | null }) {
  const [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  if (!state) return <p role="status">Відновлюємо подачу…</p>;
  if (state.mode === "TABLE") return <p>Table · поточний ігровий стіл</p>;
  if (state.mode === "BLANK")
    return <span className="director-sr-only">Темний екран для розповіді</span>;
  const material = state.material;
  if (!material?.image) return <p role="status">Зображення недоступне.</p>;
  return (
    <figure
      className={`director-figure ${state.mode === "PORTRAIT" ? "director-portrait" : "director-illustration"}`}
    >
      {failed ? (
        <p role="alert">
          Зображення тимчасово недоступне.{" "}
          <button
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            Повторити завантаження
          </button>
        </p>
      ) : (
        <img
          key={attempt}
          src={material.image.url}
          alt={material.name}
          onError={() => setFailed(true)}
        />
      )}
      {state.mode === "PORTRAIT" && (
        <figcaption>
          <h2>{material.name}</h2>
          {material.description && <p>{material.description}</p>}
        </figcaption>
      )}
    </figure>
  );
}
export function PresentationScreen({
  state,
  fullscreen = false,
  label = "Поточна подача",
}: {
  state: DirectorSnapshot | null;
  fullscreen?: boolean;
  label?: string;
}) {
  const [visual, setVisual] = useState(state),
    [visible, setVisible] = useState(true);
  useEffect(() => {
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 180;
    setVisible(false);
    let frame = 0;
    const timer = window.setTimeout(() => {
      setVisual(state);
      frame = window.requestAnimationFrame(() => setVisible(true));
    }, delay);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [state?.version, state?.mode, state?.material?.image?.id]);
  const showing = visual?.mode !== "TABLE" || state?.mode !== "TABLE";
  if (fullscreen && !showing) return null;
  return (
    <section
      aria-label={label}
      data-presentation-mode={visual?.mode ?? "LOADING"}
      className={
        fullscreen
          ? "director-screen director-fullscreen"
          : "director-screen director-monitor"
      }
      style={
        fullscreen ? { opacity: state?.mode === "TABLE" ? 0 : 1 } : undefined
      }
    >
      <div className="director-fade" style={{ opacity: visible ? 1 : 0 }}>
        {!(fullscreen && visual?.mode === "TABLE") && (
          <PresentationContent
            key={`${visual?.version}:${visual?.mode}:${visual?.material?.image?.id}`}
            state={visual}
          />
        )}
      </div>
    </section>
  );
}
