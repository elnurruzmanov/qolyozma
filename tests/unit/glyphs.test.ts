// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { FONTS } from '../../src/core/fonts'
import { JITTER, commandsToSvgPath, measureText, renderRun, shape } from '../../src/core/render/glyphs'
import { loadFontFile } from './fontLoader'

const caveat = loadFontFile('Caveat-Variable.ttf')
const badScript = loadFontFile('BadScript-Regular.ttf')
const opts = { x: 0, y: 50, fontSize: 40, seed: 42 }
const TEXT = 'Oʻzbekiston goʻzal ўғқҳ '.repeat(8)
const svg = (run: ReturnType<typeof renderRun>) => run.glyphs.map((g) => commandsToSvgPath(g.commands)).join('|')

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
    const k = n / 5
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
      expect(g.pointAmplitude).toBeLessThanOrEqual(JITTER.point * opts.fontSize * k + eps)
      expect(g.strokeWidth).toBeLessThanOrEqual(JITTER.stroke * opts.fontSize * k + eps)
    }
  })

  it('uses a meaningful share of each range at the default naturalness', () => {
    const run = renderRun(caveat, TEXT, opts)
    const maxAbs = (xs: number[]) => Math.max(...xs.map(Math.abs))
    expect(maxAbs(run.glyphs.map((g) => g.rotationDeg))).toBeGreaterThan(JITTER.glyphRotationDeg * 0.7)
    expect(maxAbs(run.glyphs.map((g) => g.widthScale - 1))).toBeGreaterThan(JITTER.width * 0.7)
    expect(maxAbs(run.words.map((w) => w.baselineShift))).toBeGreaterThan(JITTER.wordBaselinePx * 0.7)
  })

  it('connected fonts share rotation, size and width within a word', () => {
    const run = renderRun(badScript, 'salom dunyo', { ...opts, connected: true })
    const first = run.glyphs.filter((g) => g.word === 0)
    const second = run.glyphs.filter((g) => g.word === 1)
    for (const prop of ['rotationDeg', 'sizeScale', 'widthScale'] as const) {
      expect(new Set(first.map((g) => g[prop])).size).toBe(1)
    }
    expect(second[0]!.rotationDeg).not.toBe(first[0]!.rotationDeg)
  })

  // Regression for "Playpen Sans shows no jitter": outlines must move by a comparable amount in every font.
  it.each(FONTS)('$family: outlines visibly move at the default naturalness', (info) => {
    const font = loadFontFile(info.file)
    const plain = renderRun(font, 'oooo', { ...opts, naturalness: 0 })
    const jittered = renderRun(font, 'oooo', opts)
    let sum = 0
    let count = 0
    plain.glyphs.forEach((g, i) =>
      g.commands.forEach((c, j) => {
        const d = jittered.glyphs[i]!.commands[j]!
        if (c.type !== 'Z' && d.type !== 'Z') {
          sum += Math.hypot(c.x - d.x, c.y - d.y)
          count++
        }
      }),
    )
    expect(sum / count).toBeGreaterThan(0.01 * opts.fontSize)
  })
})
