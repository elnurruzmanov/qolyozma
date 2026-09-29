// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  JITTER,
  commandsToSvgPath,
  measureText,
  renderRun,
  substituteMissing,
} from '../../src/core/render/glyphs'
import { loadFontFile } from './fontLoader'

const caveat = loadFontFile('Caveat-Variable.ttf')
const badScript = loadFontFile('BadScript-Regular.ttf')
const opts = { x: 0, y: 50, fontSize: 40, seed: 42 }
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

  it('never draws the same letter twice identically', () => {
    const [a, b] = renderRun(caveat, 'aa', opts).glyphs
    // Move the second "a" back onto the first; an untouched copy would then produce the same outline.
    const back = b!.commands.map((c) =>
      'x' in c ? { ...c, x: c.x - (b!.x - a!.x), ...('x1' in c ? { x1: c.x1 - (b!.x - a!.x) } : {}), ...('x2' in c ? { x2: c.x2 - (b!.x - a!.x) } : {}) } : c,
    )
    expect(back).toHaveLength(a!.commands.length)
    expect(commandsToSvgPath(back)).not.toBe(commandsToSvgPath(a!.commands))
  })

  it('keeps every distortion inside the ranges from CLAUDE.md', () => {
    const run = renderRun(caveat, 'Oʻzbekiston goʻzal ўғқҳ '.repeat(10), opts)
    for (const g of run.glyphs) {
      expect(Math.abs(g.rotationDeg)).toBeLessThanOrEqual(JITTER.rotationDeg)
      expect(Math.abs(g.baselineShift)).toBeLessThanOrEqual(JITTER.baselinePx)
      expect(Math.abs(g.advanceScale - 1)).toBeLessThanOrEqual(JITTER.advance)
      expect(g.pointAmplitude).toBeGreaterThanOrEqual(JITTER.pointMin * opts.fontSize)
      expect(g.pointAmplitude).toBeLessThanOrEqual(JITTER.pointMax * opts.fontSize)
    }
  })

  it('stays within ±3% of the unjittered width', () => {
    const text = 'Qoʻlyozma matn namunasi'
    const plain = measureText(caveat, text, opts.fontSize)
    expect(Math.abs(renderRun(caveat, text, opts).width - plain)).toBeLessThanOrEqual(plain * JITTER.advance)
  })

  it('connected fonts share rotation and baseline within a word', () => {
    const run = renderRun(badScript, 'salom dunyo', { ...opts, connected: true })
    const first = run.glyphs.slice(0, 5)
    const second = run.glyphs.slice(5)
    expect(new Set(first.map((g) => g.rotationDeg)).size).toBe(1)
    expect(new Set(first.map((g) => g.baselineShift)).size).toBe(1)
    expect(first.every((g) => g.advanceScale === 1)).toBe(true)
    expect(second[0]!.rotationDeg).not.toBe(first[0]!.rotationDeg)
  })
})

describe('substituteMissing', () => {
  it('falls back to U+2018 only when the font lacks U+02BB', () => {
    expect(substituteMissing(caveat, 'oʻ')).toBe('o‘')
    const playpen = loadFontFile('PlaypenSans-Variable.ttf')
    expect(substituteMissing(playpen, 'oʻ')).toBe('oʻ')
  })
})
