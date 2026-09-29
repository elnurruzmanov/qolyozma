import type { PathCommand } from 'opentype.js'

export type Point = [number, number]

/** Flatten an outline into closed polylines, sampling each curve segment `steps` times. */
export function flatten(commands: PathCommand[], steps = 8): Point[][] {
  const contours: Point[][] = []
  let current: Point[] = []
  let p: Point = [0, 0]
  for (const c of commands) {
    switch (c.type) {
      case 'M':
        if (current.length > 1) contours.push(current)
        current = [[c.x, c.y]]
        p = [c.x, c.y]
        break
      case 'L':
        current.push([c.x, c.y])
        p = [c.x, c.y]
        break
      case 'Q':
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          const u = 1 - t
          current.push([u * u * p[0] + 2 * u * t * c.x1 + t * t * c.x, u * u * p[1] + 2 * u * t * c.y1 + t * t * c.y])
        }
        p = [c.x, c.y]
        break
      case 'C':
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          const u = 1 - t
          current.push([
            u ** 3 * p[0] + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t ** 3 * c.x,
            u ** 3 * p[1] + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t ** 3 * c.y,
          ])
        }
        p = [c.x, c.y]
        break
      case 'Z':
        break
    }
  }
  if (current.length > 1) contours.push(current)
  // Drop repeated points (e.g. "M p L p" pairs) so every edge has a direction.
  return contours.map((pts) => pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1]![0], q[1] - pts[i - 1]![1]) > 1e-6))
}

export function perimeter(contours: Point[][]): number {
  let sum = 0
  for (const pts of contours) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!
      const b = pts[(i + 1) % pts.length]!
      sum += Math.hypot(b[0] - a[0], b[1] - a[1])
    }
  }
  return sum
}

/** Mean absolute turning angle (radians) per vertex of the closed polylines. Scale and rotation invariant. */
export function meanTurningAngle(contours: Point[][]): number {
  let sum = 0
  let count = 0
  for (const pts of contours) {
    const n = pts.length
    if (n < 3) continue
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n]!
      const b = pts[i]!
      const c = pts[(i + 1) % n]!
      const d1 = Math.atan2(b[1] - a[1], b[0] - a[0])
      const d2 = Math.atan2(c[1] - b[1], c[0] - b[0])
      let turn = d2 - d1
      while (turn > Math.PI) turn -= 2 * Math.PI
      while (turn < -Math.PI) turn += 2 * Math.PI
      sum += Math.abs(turn)
      count++
    }
  }
  return count ? sum / count : 0
}
