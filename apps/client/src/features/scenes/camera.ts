export type Viewport = { width: number; height: number };
export type Camera = { x: number; y: number; scale: number };
export function fitCamera(width: number, height: number, v: Viewport): Camera {
  const scale = Math.min(v.width / width, v.height / height) * 0.95;
  return {
    scale,
    x: (v.width - width * scale) / 2,
    y: (v.height - height * scale) / 2,
  };
}
export function resizeCamera(c: Camera, from: Viewport, to: Viewport): Camera {
  return {
    ...c,
    x: to.width / 2 - (from.width / 2 - c.x),
    y: to.height / 2 - (from.height / 2 - c.y),
  };
}
