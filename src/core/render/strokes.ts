/**
 * Hand-drawn lines, boxes and arrows (table borders, diagram shapes), on the same principle as glyphs.ts:
 * a pen line is never ruler-straight, but it is always smooth. So a drawing is never jittered point by point;
 * each point of a densely resampled polyline is moved by
 *   group — one small rotation and one low-frequency displacement field shared by every stroke of a drawing
 *           (a table, a diagram), so lines that meet on paper still meet: the field is continuous across joins,
 *           like cursive words in glyphs.ts
 *   stroke — a weaker field of its own, plus a small overshoot at the free ends of open lines and a pen width
 *           variation, so no two lines of the same table look alike
 * Amplitudes are relative to `em` (the text size the drawing sits next to) and scale with naturalness like
 * JITTER; at naturalness 0 the geometry is exact.
 */
import { clamp, hash, mulberry32, randomField, rotateAbout, apply, type Field, type Point } from './deform'
import { NATURALNESS_DEFAULT, WEIGHT_MAX, WEIGHT_STEP, naturalnessScale } from './glyphs'

/** Amplitudes at naturalness = NATURALNESS_DEFAULT. Lengths are fractions of `em`, angles in degrees. */
export const STROKE_JITTER = {
  /** Rotation of the whole drawing about its centre. */
  groupRotationDeg: 0.4,
  /** Peak displacement of the shared field. */
  groupField: 0.1,
  /** Cycles per em: wavelengths of 7–20 em, a gentle bow over a table row or box side. */
  groupFrequency: [0.05, 0.14],
  /** Peak displacement of each stroke's own field. */
  strokeField: 0.035,
  strokeFrequency: [0.08, 0.2],
  /**
   * Overshoot past the free ends of an open line: 30–100% of this. Never short, so the corners of a table
   * cross like pen lines do instead of leaving gaps.
   */
  overshoot: 0.18,
  /** Pen width variation per stroke, relative. */
  width: 0.2,
} as const

/** Resampling step, fraction of em: short enough that the drawn polyline follows the field smoothly. */
const STEP = 0.2

export interface DrawShape {
  points: Point[]
  closed: boolean
  stroked: boolean
  filled: boolean
}

export interface InkStroke {
  points: Point[]
  closed: boolean
  /** Outline pen width in px; 0 for a fill without outline. */
  width: number
  filled: boolean
}

export interface StrokeOptions {
  /** Size of the surrounding text in px; all amplitudes scale with it. */
  em: number
  /** Base pen width in px. */
  width: number
  seed: number
  /** Distinguishes drawings rendered with the same seed. */
  groupIndex: number
  /** 0–10, default 5. */
  naturalness?: number
}

/** Redraw the shapes of one drawing (a table, a diagram) by hand. */
export function drawByHand(shapes: DrawShape[], opts: StrokeOptions): InkStroke[] {
  const { em } = opts
  const k = naturalnessScale(opts.naturalness ?? NATURALNESS_DEFAULT)
  const rand = mulberry32(hash(opts.seed, 0x51_0000 + opts.groupIndex))
  const sym = (amplitude: number) => (rand() * 2 - 1) * amplitude * k

  const all = shapes.flatMap((s) => s.points)
  if (all.length === 0) return []
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const rotation = rotateAbout(cx, cy, sym(STROKE_JITTER.groupRotationDeg))
  const group = randomField(rand, STROKE_JITTER.groupField * em * k * (0.6 + 0.4 * rand()), em, STROKE_JITTER.groupFrequency)

  const out: InkStroke[] = []
  for (const shape of shapes) {
    if (shape.points.length < 2 || (!shape.stroked && !shape.filled)) continue
    const own = randomField(rand, STROKE_JITTER.strokeField * em * k * rand(), em, STROKE_JITTER.strokeFrequency)
    let points = shape.points
    if (!shape.closed && !shape.filled) {
      const overshoot = () => STROKE_JITTER.overshoot * em * k * (0.3 + 0.7 * rand())
      points = extendEnds(points, overshoot(), overshoot())
    }
    const dense = resample(points, shape.closed, STEP * em)
    out.push({
      points: dense.map(([x, y]) => deform(x, y, own, group, rotation)),
      closed: shape.closed,
      width: shape.stroked ? opts.width * (1 + sym(STROKE_JITTER.width)) : 0,
      filled: shape.filled,
    })
  }
  return out
}

/** Stroke field first (small, local), then the shared field and rotation, all sampled at original positions. */
function deform(x: number, y: number, own: Field, group: Field, rotation: ReturnType<typeof rotateAbout>): Point {
  const [ox, oy] = own(x, y)
  const [gx, gy] = group(x, y)
  return apply(rotation, gx + ox - x, gy + oy - y)
}

/** Lengthen an open polyline at both ends along its end directions. */
export function extendEnds(points: Point[], before: number, after: number): Point[] {
  const out = points.map((p) => [...p] as Point)
  const push = (end: Point, from: Point, by: number) => {
    const len = Math.hypot(end[0] - from[0], end[1] - from[1])
    if (len === 0 || by === 0) return
    end[0] += ((end[0] - from[0]) / len) * by
    end[1] += ((end[1] - from[1]) / len) * by
  }
  push(out[0]!, out[1]!, before)
  push(out[out.length - 1]!, out[out.length - 2]!, after)
  return out
}

/** Insert points so that no segment is longer than `step`; original vertices (corners) are kept. */
export function resample(points: Point[], closed: boolean, step: number): Point[] {
  const out: Point[] = []
  const n = points.length
  const segments = closed ? n : n - 1
  for (let i = 0; i < segments; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    const parts = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(step, 1e-6)))
    for (let j = 0; j < parts; j++) out.push([a[0] + ((b[0] - a[0]) * j) / parts, a[1] + ((b[1] - a[1]) * j) / parts])
  }
  if (!closed) out.push([...points[n - 1]!])
  return out
}

/** Pen width for tables and diagrams next to text of size `em`: thickens with the same weight as the letters. */
export function penWidth(em: number, weight: number): number {
  return em * (0.055 + WEIGHT_STEP * clamp(weight, 0, WEIGHT_MAX))
}
