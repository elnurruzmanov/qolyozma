// @vitest-environment node
import type { PathCommand } from 'opentype.js'
import { describe, expect, it } from 'vitest'
import { FONTS } from '../../src/core/fonts'
import {
  JITTER,
  commandsToSvgPath,
  measureText,
  naturalnessScale,
  renderRun,
  shape,
} from '../../src/core/render/glyphs'
import { loadFontFile } from './fontLoader'
import { flatten, meanTurningAngle, perimeter } from './geometry'

const caveat = await loadFontFile('Caveat-Regular.woff2')
const badScript = await loadFontFile('BadScript-Regular.woff2')
const fonts = new Map(await Promise.all(FONTS.map(async (f) => [f.id, await loadFontFile(f.file)] as const)))
const opts = { x: 0, y: 50, fontSize: 40, seed: 42 }
const TEXT = 'Oʻzbekiston goʻzal ўғқҳ '.repeat(8)
const svg = (run: ReturnType<typeof renderRun>) => run.glyphs.map((g) => commandsToSvgPath(g.commands)).join('|')

describe('naturalnessScale', () => {
  it('is 0 at 0, 1 at the default and grows more slowly above it', () => {
    expect(naturalnessScale(0)).toBe(0)
    expect(naturalnessScale(5)).toBe(1)
    expect(naturalnessScale(10)).toBeCloseTo(1.6)
    expect(naturalnessScale(10) - naturalnessScale(5)).toBeLessThan(naturalnessScale(5) - naturalnessScale(0))
  })
})

describe('renderRun', () => {
  it('is deterministic for the same seed', () => {
    expect(svg(renderRun(caveat, 'Salom dunyo', opts))).toBe(svg(renderRun(caveat, 'Salom dunyo', opts)))
  })

  it('changes with a different seed (Redraw)', () => {
    expect(svg(renderRun(caveat, 'Salom dunyo', opts))).not.toBe(
      svg(renderRun(caveat, 'Salom dunyo', { ...opts, seed: 43 })),
    )
  })

  it('changes with a different runIndex so lines do not repeat', () => {
    expect(svg(renderRun(caveat, 'aaa', opts))).not.toBe(svg(renderRun(caveat, 'aaa', { ...opts, runIndex: 1 })))
  })

  it('naturalness 0 renders the plain font, identical for every seed', () => {
    const a = renderRun(caveat, 'Salom dunyo', { ...opts, naturalness: 0 })
    const b = renderRun(caveat, 'Salom dunyo', { ...opts, seed: 99, naturalness: 0 })
    expect(svg(a)).toBe(svg(b))
    expect(a.width).toBeCloseTo(measureText(caveat, 'Salom dunyo', opts.fontSize), 6)
    const [first] = shape(caveat, 'S')
    expect(commandsToSvgPath(a.glyphs[0]!.commands)).toBe(
      commandsToSvgPath(first!.getPath(0, 50, 40, undefined, caveat).commands),
    )
  })

  it('never draws the same letter twice identically', () => {
    const [a, b] = renderRun(caveat, 'aa', opts).glyphs
    const dx = b!.x - a!.x
    const back = b!.commands.map((c) => {
      if (c.type === 'Z') return c
      const moved = { ...c, x: c.x - dx }
      if ('x1' in moved) moved.x1 -= dx
      if ('x2' in moved) moved.x2 -= dx
      return moved
    })
    expect(commandsToSvgPath(back)).not.toBe(commandsToSvgPath(a!.commands))
  })

  it.each([0, 1, 5, 10])('keeps every distortion inside its range at naturalness %i', (n) => {
    const k = naturalnessScale(n)
    const eps = 1e-9
    const run = renderRun(caveat, TEXT, { ...opts, naturalness: n })
    expect(Math.abs(run.slopeDeg)).toBeLessThanOrEqual(JITTER.lineSlopeDeg * k + eps)
    for (const w of run.words) {
      expect(Math.abs(w.baselineShift)).toBeLessThanOrEqual(JITTER.wordBaselinePx * k + eps)
      expect(Math.abs(w.spacingScale - 1)).toBeLessThanOrEqual(JITTER.wordSpacing * k + eps)
    }
    for (const g of run.glyphs) {
      expect(Math.abs(g.rotationDeg)).toBeLessThanOrEqual(JITTER.glyphRotationDeg * k + eps)
      expect(Math.abs(g.sizeScale - 1)).toBeLessThanOrEqual(JITTER.size * k + eps)
      expect(Math.abs(g.widthScale - 1)).toBeLessThanOrEqual(JITTER.width * k + eps)
      expect(Math.abs(g.shearDeg)).toBeLessThanOrEqual(JITTER.shearDeg * k + eps)
      expect(g.fieldAmplitude).toBeLessThanOrEqual(JITTER.field * opts.fontSize * k + eps)
      expect(g.strokeWidth).toBeLessThanOrEqual(JITTER.stroke * opts.fontSize * k + eps)
    }
  })

  it('uses a meaningful share of each range at the default naturalness', () => {
    const run = renderRun(caveat, TEXT, opts)
    const maxAbs = (xs: number[]) => Math.max(...xs.map(Math.abs))
    expect(maxAbs(run.glyphs.map((g) => g.rotationDeg))).toBeGreaterThan(JITTER.glyphRotationDeg * 0.7)
    expect(maxAbs(run.glyphs.map((g) => g.widthScale - 1))).toBeGreaterThan(JITTER.width * 0.7)
    expect(maxAbs(run.glyphs.map((g) => g.shearDeg))).toBeGreaterThan(JITTER.shearDeg * 0.7)
    expect(maxAbs(run.words.map((w) => w.baselineShift))).toBeGreaterThan(JITTER.wordBaselinePx * 0.7)
  })

  it('connected fonts share one shape per word', () => {
    const run = renderRun(badScript, 'salom dunyo', { ...opts, connected: true })
    const first = run.glyphs.filter((g) => g.word === 0)
    const second = run.glyphs.filter((g) => g.word === 1)
    for (const prop of ['rotationDeg', 'sizeScale', 'widthScale', 'shearDeg', 'fieldAmplitude'] as const) {
      expect(new Set(first.map((g) => g[prop])).size).toBe(1)
    }
    expect(second[0]!.rotationDeg).not.toBe(first[0]!.rotationDeg)
  })

  // Regression for "Playpen Sans shows no jitter": outlines must move by a comparable amount in every font.
  it.each(FONTS)('$family: outlines visibly move at the default naturalness', (info) => {
    const font = fonts.get(info.id)!
    const plain = renderRun(font, 'oooo', { ...opts, naturalness: 0 })
    const moved = renderRun(font, 'oooo', opts)
    let sum = 0
    let count = 0
    plain.glyphs.forEach((g, i) =>
      g.commands.forEach((c, j) => {
        const d = moved.glyphs[i]!.commands[j]!
        if (c.type !== 'Z' && d.type !== 'Z') {
          sum += Math.hypot(c.x - d.x, c.y - d.y)
          count++
        }
      }),
    )
    expect(sum / count).toBeGreaterThan(0.01 * opts.fontSize)
  })
})

describe('contour smoothness', () => {
  // Deformation must keep pen strokes smooth: compare each deformed glyph's flattened contour with the original.
  // Scale changes the perimeter (size ±4%, width ±5%, ×1.6 at 10), roughness adds turning at every vertex.
  const MAX_PERIMETER_CHANGE = 0.15
  const MAX_TURNING_RATIO = 1.1
  const SAMPLE = 'aegsoʻОЎжқ'
  const FONT_SIZE = 100

  function roughness(original: PathCommand[], deformed: PathCommand[]) {
    const o = flatten(original)
    const d = flatten(deformed)
    return {
      perimeterChange: Math.abs(perimeter(d) / perimeter(o) - 1),
      turningRatio: meanTurningAngle(d) / meanTurningAngle(o),
    }
  }

  function withPointNoise(commands: PathCommand[], amplitude: number): PathCommand[] {
    let s = 7
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1
    const f = (x: number, y: number): [number, number] => [x + r() * amplitude, y + r() * amplitude]
    return commands.map((c) => {
      if (c.type === 'Z') return c
      const [x, y] = f(c.x, c.y)
      if (c.type === 'Q') {
        const [x1, y1] = f(c.x1, c.y1)
        return { ...c, x1, y1, x, y }
      }
      if (c.type === 'C') {
        const [x1, y1] = f(c.x1, c.y1)
        const [x2, y2] = f(c.x2, c.y2)
        return { ...c, x1, y1, x2, y2, x, y }
      }
      return { ...c, x, y }
    })
  }

  describe.each(FONTS)('$family', (info) => {
    const font = fonts.get(info.id)!
    const base = { x: 0, y: 0, fontSize: FONT_SIZE, connected: info.connected }
    const plain = renderRun(font, SAMPLE, { ...base, seed: 1, naturalness: 0 })

    it.each([5, 10])('stays smooth at naturalness %i', (n) => {
      for (const seed of [1, 2, 3]) {
        const run = renderRun(font, SAMPLE, { ...base, seed, naturalness: n })
        run.glyphs.forEach((g, i) => {
          const r = roughness(plain.glyphs[i]!.commands, g.commands)
          const label = `${info.family} "${[...SAMPLE][i]}" seed ${seed}: ${JSON.stringify(r)}`
          expect(r.perimeterChange, label).toBeLessThanOrEqual(MAX_PERIMETER_CHANGE)
          expect(r.turningRatio, label).toBeLessThanOrEqual(MAX_TURNING_RATIO)
        })
      }
    })

    it('the check catches independent point jitter (negative control)', () => {
      const rough = plain.glyphs.map((g) => roughness(g.commands, withPointNoise(g.commands, 0.01 * FONT_SIZE)))
      expect(Math.max(...rough.map((r) => r.turningRatio))).toBeGreaterThan(MAX_TURNING_RATIO)
    })
  })
})
