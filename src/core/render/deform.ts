/**
 * Shared building blocks of the handwriting deformation, used by glyphs.ts (letters) and strokes.ts (lines,
 * boxes, arrows): a seeded PRNG, 2D affine matrices, and the smooth low-frequency displacement field.
 * Nothing here moves points independently; see glyphs.ts for why.
 */

export type Point = [number, number]

/** A smooth displacement field: (x, y) -> (x + dx, y + dy), built from two low-frequency plane waves per axis. */
export interface Field {
  (x: number, y: number): [number, number]
  /** Peak displacement per axis. */
  amplitude: number
}

/**
 * Random smooth field with |dx|, |dy| <= amplitude. `frequency` is the range of spatial frequencies in cycles
 * per `unit` length (the em size for glyphs): keep it well below stroke-width detail so edges stay parallel.
 */
export function randomField(
  rand: () => number,
  amplitude: number,
  unit: number,
  frequency: readonly [number, number],
): Field {
  const [fMin, fMax] = frequency
  const wave = (weight: number) => {
    const freq = (fMin + (fMax - fMin) * rand()) * 2 * Math.PI / unit
    const angle = rand() * 2 * Math.PI
    return { kx: Math.cos(angle) * freq, ky: Math.sin(angle) * freq, phase: rand() * 2 * Math.PI, weight }
  }
  // Weights sum to 1 per axis, so |dx|, |dy| <= amplitude.
  const xs = [wave(0.6), wave(0.4)]
  const ys = [wave(0.6), wave(0.4)]
  const sum = (ws: typeof xs, x: number, y: number) =>
    ws.reduce((acc, w) => acc + w.weight * Math.sin(w.kx * x + w.ky * y + w.phase), 0)
  const field = ((x: number, y: number) => [
    x + amplitude * sum(xs, x, y),
    y + amplitude * sum(ys, x, y),
  ]) as Field
  field.amplitude = amplitude
  return field
}

// 2D affine matrices in canvas order: [a, b, c, d, e, f] -> x' = a·x + c·y + e, y' = b·x + d·y + f
export type Matrix = readonly [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]
export const scaleXY = (sx: number, sy: number): Matrix => [sx, 0, 0, sy, 0, 0]
/** Positive shear leans tops to the right (y grows downwards). */
export const shearX = (deg: number): Matrix => [1, 0, -Math.tan((deg * Math.PI) / 180), 1, 0, 0]

export function rotateAbout(cx: number, cy: number, deg: number): Matrix {
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return [cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos]
}

export function multiply(...ms: Matrix[]): Matrix {
  return ms.reduce((p, q) => [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
  ])
}

export const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x6a09e667, 0xc2b2ae35)
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable 32-bit hash of a string (FNV-1a), e.g. to derive a per-document seed from its text. */
export function hashString(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}
