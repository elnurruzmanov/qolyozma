import { describe, expect, it } from 'vitest'
import type { Point } from '../../src/core/render/deform'
import { naturalnessScale } from '../../src/core/render/glyphs'
import {
  STROKE_JITTER,
  drawByHand,
  extendEnds,
  penWidth,
  resample,
  type DrawShape,
  type InkStroke,
} from '../../src/core/render/strokes'

const EM = 22
const line = (a: Point, b: Point): DrawShape => ({ points: [a, b], closed: false, stroked: true, filled: false })
const box = (x: number, y: number, w: number, h: number): DrawShape => ({
  points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
  closed: true,
  stroked: true,
  filled: false,
})
const draw = (shapes: DrawShape[], seed = 1, naturalness = 5, groupIndex = 0) =>
  drawByHand(shapes, { em: EM, width: 1.5, seed, groupIndex, naturalness })

/** Largest change of direction between consecutive segments, degrees. */
function maxTurnDeg(points: Point[]): number {
  let max = 0
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[i - 1]!, points[i]!, points[i + 1]!]
    let turn = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])
    while (turn > Math.PI) turn -= 2 * Math.PI
    while (turn < -Math.PI) turn += 2 * Math.PI
    max = Math.max(max, Math.abs(turn))
  }
  return (max * 180) / Math.PI
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (o: Point, p: Point, q: Point) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0
}

/** Shortest distance between two polylines (0 if they cross). */
function polylineDistance(p: Point[], q: Point[]): number {
  let min = Infinity
  for (let i = 0; i < p.length - 1; i++) {
    for (let j = 0; j < q.length - 1; j++) {
      if (intersects(p[i]!, p[i + 1]!, q[j]!, q[j + 1]!)) return 0
      min = Math.min(
        min,
        segmentDistance(p[i]!, q[j]!, q[j + 1]!),
        segmentDistance(q[j]!, p[i]!, p[i + 1]!),
      )
    }
  }
  return min
}

const perimeter = (s: InkStroke) =>
  s.points.reduce((sum, p, i) => {
    const q = s.points[(i + 1) % s.points.length]!
    return i === s.points.length - 1 && !s.closed ? sum : sum + Math.hypot(q[0] - p[0], q[1] - p[1])
  }, 0)

describe('resample / extendEnds', () => {
  it('keeps every vertex and never leaves a segment longer than the step', () => {
    const pts: Point[] = [[0, 0], [100, 0], [100, 37]]
    const out = resample(pts, false, 10)
    for (const v of pts) expect(out).toContainEqual(v)
    for (let i = 1; i < out.length; i++) {
      expect(Math.hypot(out[i]![0] - out[i - 1]![0], out[i]![1] - out[i - 1]![1])).toBeLessThanOrEqual(10 + 1e-9)
    }
  })

  it('closes closed shapes back to the start', () => {
    const out = resample(box(0, 0, 40, 20).points, true, 10)
    expect(out[0]).toEqual([0, 0])
    expect(Math.hypot(...([out.at(-1)![0], out.at(-1)![1]] as const))).toBeLessThanOrEqual(10 + 1e-9)
  })

  it('extends an open line along its own direction', () => {
    expect(extendEnds([[0, 0], [10, 0]], 2, 3)).toEqual([[-2, 0], [13, 0]])
  })
})

describe('drawByHand', () => {
  it('is deterministic for the same seed and changes with the seed and the drawing index (Redraw)', () => {
    const shapes = [box(0, 0, 200, 60), line([0, 100], [300, 100])]
    expect(draw(shapes, 3)).toEqual(draw(shapes, 3))
    expect(draw(shapes, 4)).not.toEqual(draw(shapes, 3))
    expect(draw(shapes, 3, 5, 1)).not.toEqual(draw(shapes, 3, 5, 0))
  })

  it('naturalness 0 draws the exact geometry, for every seed', () => {
    const shapes = [box(10, 10, 200, 60), line([0, 100], [300, 140])]
    for (const seed of [1, 2, 3]) {
      const out = draw(shapes, seed, 0)
      out.forEach((stroke, i) => {
        const src = resample(shapes[i]!.points, shapes[i]!.closed, 1e9)
        for (const p of stroke.points) {
          const d = Math.min(...src.map((a, j) => segmentDistance(p, a, src[(j + 1) % src.length]!)))
          expect(d).toBeLessThan(1e-9)
        }
        expect(stroke.width).toBe(1.5)
      })
    }
  })

  it('bends a long line smoothly: tiny direction changes, visible but bounded displacement', () => {
    const length = 600
    for (const naturalness of [5, 10]) {
      const k = naturalnessScale(naturalness)
      const bound =
        (STROKE_JITTER.groupField + STROKE_JITTER.strokeField) * EM * k * Math.SQRT2 +
        Math.tan((STROKE_JITTER.groupRotationDeg * k * Math.PI) / 180) * (length / 2 + EM)
      let visible = 0
      for (let seed = 1; seed <= 20; seed++) {
        const [s] = draw([line([0, 0], [length, 0])], seed, naturalness)
        expect(maxTurnDeg(s!.points)).toBeLessThan(2)
        const dev = Math.max(...s!.points.map((p) => Math.abs(p[1])))
        expect(dev).toBeLessThanOrEqual(bound)
        if (dev > 0.5) visible++
      }
      expect(visible).toBeGreaterThanOrEqual(18) // almost never ruler-straight
    }
  })

  it('the smoothness check catches independent point jitter (negative control)', () => {
    const [s] = draw([line([0, 0], [600, 0])], 1, 5)
    let r = 1
    const noise = () => ((r = (r * 16807) % 2147483647) / 2147483647) * 2 - 1
    const amplitude = (STROKE_JITTER.groupField + STROKE_JITTER.strokeField) * EM
    const jittered = s!.points.map(([x, y]): Point => [x, y + noise() * amplitude])
    expect(maxTurnDeg(jittered)).toBeGreaterThan(10)
  })

  it('keeps a box closed with its perimeter within 3%', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const [s] = draw([box(0, 0, 160, 60)], seed, 10)
      expect(s!.closed).toBe(true)
      expect(perimeter(s!) / 440).toBeGreaterThan(0.97)
      expect(perimeter(s!) / 440).toBeLessThan(1.03)
    }
  })

  it('lines of one drawing still meet where they met on paper (shared field + overshoot)', () => {
    // A 3×3 table grid.
    const xs = [0, 120, 260, 400]
    const ys = [0, 30, 60, 90]
    const shapes = [...ys.map((y) => line([0, y], [400, y])), ...xs.map((x) => line([x, 0], [x, 90]))]
    for (let seed = 1; seed <= 10; seed++) {
      const out = draw(shapes, seed, 10)
      const rows = out.slice(0, ys.length)
      const cols = out.slice(ys.length)
      let crossed = 0
      for (const r of rows) {
        for (const c of cols) {
          const d = polylineDistance(r.points, c.points)
          expect(d).toBeLessThan(Math.min(r.width, c.width) / 2) // the ink overlaps: no visible gap
          if (d === 0) crossed++
        }
      }
      expect(crossed).toBeGreaterThanOrEqual(rows.length * cols.length - 2) // corners too, almost always
    }
  })

  it('overshoots the free ends of open lines by 30–100% of the amplitude', () => {
    const k = naturalnessScale(5)
    for (let seed = 1; seed <= 10; seed++) {
      const [s] = draw([line([0, 0], [300, 0])], seed, 5)
      const first = s!.points[0]!
      const last = s!.points.at(-1)!
      // Along the line, ignoring the smooth field's own along-axis shift.
      const slack = (STROKE_JITTER.groupField + STROKE_JITTER.strokeField) * EM * k + 1
      const min = 0.3 * STROKE_JITTER.overshoot * EM * k
      expect(first[0]).toBeLessThanOrEqual(-min + slack)
      expect(first[0]).toBeGreaterThanOrEqual(-STROKE_JITTER.overshoot * EM * k - slack)
      expect(last[0]).toBeGreaterThanOrEqual(300 + min - slack)
      expect(last[0]).toBeLessThanOrEqual(300 + STROKE_JITTER.overshoot * EM * k + slack)
    }
  })

  it('fills filled shapes (arrowheads) and outlines only stroked ones', () => {
    const head: DrawShape = { points: [[0, 0], [10, 4], [0, 8]], closed: true, stroked: false, filled: true }
    const [s] = draw([head])
    expect(s!.filled).toBe(true)
    expect(s!.width).toBe(0)
    expect(draw([{ ...head, filled: false }])).toEqual([])
  })

  it('pen width grows with weight', () => {
    expect(penWidth(EM, 3)).toBeGreaterThan(penWidth(EM, 0))
    expect(penWidth(EM, 99)).toBe(penWidth(EM, 5))
  })
})
