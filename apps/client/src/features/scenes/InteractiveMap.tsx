import { FogLayer } from "./FogLayer";
import { WorkspaceArea, useWorkspace } from "../workspace/Workspace";
import { fitCamera, resizeCamera, type Viewport } from "./camera";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  tokenInOpenFog,
  type FogOperation,
  type LocationView,
  type TokenView,
  type LocationPing,
} from "@dnd/shared";
type Point = { x: number; y: number };
type Camera = Point & { scale: number };
export function InteractiveMap({
  scene,
  dm,
  ready,
  move,
  ping,
  pulse,
  saveFog,
}: {
  scene: LocationView;
  dm: boolean;
  ready: boolean;
  move: (token: TokenView, point: Point) => Promise<void>;
  ping: (point: Point) => void;
  pulse: LocationPing | null;
  saveFog: (ops: FogOperation[]) => Promise<void>;
}) {
  const live = useWorkspace()?.live ?? false;
  const [fogSaving, setFogSaving] = useState(false);
  async function commitFog(ops: FogOperation[]) {
    if (fogSaving) return;
    setFogSaving(true);
    try {
      await saveFog(ops);
    } finally {
      setFogSaving(false);
    }
  }
  const [tool, setTool] = useState("camera");
  const [radius, setRadius] = useState(50);
  const [playerPreview, setPlayerPreview] = useState(false);
  const editing = dm && !playerPreview;
  const visibleTokens = scene.tokens.filter(
    (t) =>
      !playerPreview ||
      (!t.hidden &&
        tokenInOpenFog(scene.fog.bits, t, scene.width, scene.height)),
  );
  const svg = useRef<SVGSVGElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({
    width: 1000,
    height: 650,
  });
  const viewportRef = useRef(viewport),
    autoFit = useRef(true);
  const fit = () => fitCamera(scene.width, scene.height, viewport);
  const [camera, setCamera] = useState<Camera>(fit);
  function changeCamera(task: (c: Camera) => Camera) {
    autoFit.current = false;
    setCamera(task);
  }
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const next = { width: 1000, height: (1000 * r.height) / r.width },
        previous = viewportRef.current;
      if (Math.abs(next.height - previous.height) < 0.1) return;
      viewportRef.current = next;
      setViewport(next);
      setCamera((c) =>
        autoFit.current
          ? fitCamera(scene.width, scene.height, next)
          : resizeCamera(c, previous, next),
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scene.width, scene.height]);
  const [preview, setPreview] = useState<(Point & { id: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [imageError, setImageError] = useState(false);
  useEffect(() => setImageError(false), [scene.background?.id]);
  const gesture = useRef<{
    start: Point;
    last: Point;
    token?: TokenView;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    autoFit.current = true;
    setCamera(fit());
    setPreview(null);
    gesture.current = null;
  }, [scene.id, scene.width, scene.height]);
  useEffect(() => {
    if (!ready) {
      gesture.current = null;
      setPreview(null);
    }
  }, [ready]);
  function viewPoint(event: { clientX: number; clientY: number }) {
    const p = svg.current!.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    return p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  }
  function world(point: Point) {
    return {
      x: Math.max(
        0,
        Math.min(scene.width, (point.x - camera.x) / camera.scale),
      ),
      y: Math.max(
        0,
        Math.min(scene.height, (point.y - camera.y) / camera.scale),
      ),
    };
  }
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = element.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const p = point.matrixTransform(element.getScreenCTM()!.inverse());
      changeCamera((c) => {
        const scale = Math.max(
          0.05,
          Math.min(10, c.scale * Math.exp(-event.deltaY * 0.001)),
        );
        return {
          scale,
          x: p.x - ((p.x - c.x) * scale) / c.scale,
          y: p.y - ((p.y - c.y) * scale) / c.scale,
        };
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  function begin(event: PointerEvent<SVGElement>, token?: TokenView) {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    if (saving) return;
    const p = viewPoint(event);
    gesture.current = {
      start: p,
      last: p,
      moved: false,
      token:
        editing && ready && !event.shiftKey && event.button === 0
          ? token
          : undefined,
    };
    svg.current!.setPointerCapture(event.pointerId);
  }
  async function finish(event: PointerEvent<SVGSVGElement>) {
    const action = gesture.current;
    if (!action) return;
    gesture.current = null;
    if (svg.current?.hasPointerCapture(event.pointerId))
      svg.current.releasePointerCapture(event.pointerId);
    if (action.token && action.moved && ready) {
      setSaving(true);
      try {
        await move(action.token, world(viewPoint(event)));
      } finally {
        setSaving(false);
        setPreview(null);
      }
    } else {
      setPreview(null);
      if (!action.moved && !action.token && ready)
        ping(world(viewPoint(event)));
    }
  }
  return (
    <div className="interactive-table">
      {dm && (
        <WorkspaceArea name="table.context">
          <details open={!live} className="compact-tool">
            <summary>Туман війни</summary>
            <fieldset disabled={!ready || fogSaving}>
              <legend>Fog of War · DM</legend>
              <label>
                <input
                  type="checkbox"
                  checked={playerPreview}
                  onChange={(e) => {
                    setPlayerPreview(e.target.checked);
                    setTool("camera");
                  }}
                />{" "}
                Попередній перегляд Player
              </label>{" "}
              <label>
                Інструмент{" "}
                <select
                  aria-label="Інструмент туману"
                  value={tool}
                  disabled={playerPreview}
                  onChange={(e) => setTool(e.target.value)}
                >
                  <option value="camera">Камера / токени</option>
                  <option value="reveal-brush">Reveal Brush</option>
                  <option value="hide-brush">Hide Brush</option>
                  <option value="reveal-rectangle">Reveal Rectangle</option>
                  <option value="hide-rectangle">Hide Rectangle</option>
                </select>
              </label>{" "}
              <label>
                Радіус пензля (px карти){" "}
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={radius}
                  onChange={(e) =>
                    setRadius(
                      Math.max(1, Math.min(10000, Number(e.target.value) || 1)),
                    )
                  }
                />
              </label>{" "}
              <button
                disabled={playerPreview}
                onClick={() =>
                  void commitFog([{ kind: "all", mode: "reveal" }])
                }
              >
                Reveal All
              </button>{" "}
              <button
                disabled={playerPreview}
                onClick={() => void commitFog([{ kind: "all", mode: "hide" }])}
              >
                Hide All
              </button>
              <p>
                Shift або середня кнопка — камера під час малювання. Зміни
                зберігаються після відпускання кнопки.
              </p>
              {fogSaving && <p role="status">Зберігаємо туман…</p>}
            </fieldset>
          </details>
        </WorkspaceArea>
      )}
      {imageError && (
        <p role="alert">
          Не вдалося завантажити фон. Спробуйте перепідключитися до кімнати.
        </p>
      )}
      <p className="map-toolbar">
        <button
          title="Збільшити масштаб карти"
          onClick={() =>
            changeCamera((c) => ({ ...c, scale: Math.min(10, c.scale * 1.25) }))
          }
        >
          Збільшити
        </button>{" "}
        <button
          title="Зменшити масштаб карти"
          onClick={() =>
            changeCamera((c) => ({
              ...c,
              scale: Math.max(0.05, c.scale / 1.25),
            }))
          }
        >
          Зменшити
        </button>{" "}
        <button
          title="Вмістити локацію у вікно"
          onClick={() => {
            autoFit.current = true;
            setCamera(fit());
          }}
        >
          Вмістити карту
        </button>{" "}
        <button
          aria-label="Камера ліворуч"
          onClick={() => changeCamera((c) => ({ ...c, x: c.x + 50 }))}
        >
          ←
        </button>
        <button
          aria-label="Камера праворуч"
          onClick={() => changeCamera((c) => ({ ...c, x: c.x - 50 }))}
        >
          →
        </button>
        <button
          aria-label="Камера вгору"
          onClick={() => changeCamera((c) => ({ ...c, y: c.y + 50 }))}
        >
          ↑
        </button>
        <button
          aria-label="Камера вниз"
          onClick={() => changeCamera((c) => ({ ...c, y: c.y - 50 }))}
        >
          ↓
        </button>{" "}
        Масштаб {Math.round(camera.scale * 100)}%
      </p>
      <p className="map-help">
        Колесо — масштаб; перетягування фону — камера.{" "}
        {dm
          ? "Перетягніть токен для переміщення; Shift — камера."
          : "Натисніть на карту для пінгу. Токенами керує DM."}
      </p>
      <svg
        ref={svg}
        role="img"
        aria-label={`Інтерактивна локація: ${scene.name}`}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: "100%",
          height: "min(65vh,650px)",
          minHeight: 300,
          background: "#20242b",
          touchAction: "none",
          userSelect: "none",
        }}
        onPointerDown={(event) => begin(event)}
        onPointerMove={(event) => {
          const action = gesture.current;
          if (!action) return;
          const p = viewPoint(event);
          if (Math.hypot(p.x - action.start.x, p.y - action.start.y) > 3)
            action.moved = true;
          if (action.token) setPreview({ ...world(p), id: action.token.id });
          else if (action.moved) {
            const dx = p.x - action.last.x,
              dy = p.y - action.last.y;
            changeCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
          }
          action.last = p;
        }}
        onPointerUp={(event) => void finish(event)}
        onPointerCancel={() => {
          gesture.current = null;
          setPreview(null);
        }}
      >
        <defs>
          <pattern
            id={`grid-${scene.id}`}
            x={scene.grid.offsetX}
            y={scene.grid.offsetY}
            width={scene.grid.size}
            height={scene.grid.size}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${scene.grid.size} 0 L 0 0 0 ${scene.grid.size}`}
              fill="none"
              stroke="#fff"
              strokeWidth="1"
              opacity=".6"
            />
          </pattern>
          {visibleTokens.map((token) => (
            <clipPath key={token.id} id={`clip-${token.id}`}>
              <circle r={token.size / 2} />
            </clipPath>
          ))}
        </defs>
        <g
          transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}
        >
          <rect width={scene.width} height={scene.height} fill="#665849" />
          {scene.background && (
            <image
              href={scene.background.url}
              width={scene.width}
              height={scene.height}
              preserveAspectRatio="none"
              onError={() => setImageError(true)}
              onLoad={() => setImageError(false)}
            />
          )}
          {scene.grid.visible && (
            <rect
              width={scene.width}
              height={scene.height}
              fill={`url(#grid-${scene.id})`}
              pointerEvents="none"
            />
          )}
          {visibleTokens.map((token) => {
            const pos = preview?.id === token.id ? preview : token;
            return (
              <g
                key={token.id}
                data-token-id={token.id}
                transform={`translate(${pos.x} ${pos.y})`}
                opacity={token.hidden ? 0.45 : 1}
                onPointerDown={(event) => begin(event, token)}
                style={{ cursor: editing && ready ? "grab" : "crosshair" }}
              >
                <title>
                  {token.name}
                  {token.hidden ? " · прихований" : ""}
                </title>
                <circle
                  r={token.size / 2}
                  fill={
                    token.kind === "ENEMY"
                      ? "#a33333"
                      : token.kind === "PLAYER"
                        ? "#2862aa"
                        : "#806424"
                  }
                />
                {token.image && (
                  <image
                    href={token.image.url}
                    x={-token.size / 2}
                    y={-token.size / 2}
                    width={token.size}
                    height={token.size}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#clip-${token.id})`}
                  />
                )}
                <circle
                  r={token.size / 2}
                  fill="none"
                  stroke={token.hidden ? "#ffcf66" : "white"}
                  strokeWidth="2"
                  strokeDasharray={token.hidden ? "5 3" : undefined}
                />
                <text
                  textAnchor="middle"
                  y={-token.size / 2 - 7}
                  fill="white"
                  stroke="#111"
                  strokeWidth=".5"
                  fontSize="14"
                >
                  {token.name}
                </text>
              </g>
            );
          })}
          <FogLayer
            scene={scene}
            dm={editing}
            tool={ready && !fogSaving ? tool : "camera"}
            radius={radius}
            save={commitFog}
          />
          {pulse && pulse.sceneId === scene.id && (
            <g
              transform={`translate(${pulse.x} ${pulse.y})`}
              pointerEvents="none"
            >
              <circle r="15" stroke="#ffdb00" strokeWidth="4" fill="none" />
              <text y="-22" fill="#ffdb00" fontSize="18">
                {pulse.displayName}
              </text>
            </g>
          )}
        </g>
      </svg>
      {saving && <p role="status">Зберігаємо позицію…</p>}
    </div>
  );
}
