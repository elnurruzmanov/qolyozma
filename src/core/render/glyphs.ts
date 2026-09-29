/**
 * Per-glyph "handwriting" jitter on top of opentype.js outlines.
 *
 * Real handwriting never repeats a letter exactly, so every glyph gets a small, seeded distortion:
 * control points move by 0.5–2% of the em size, the glyph rotates ±1.5°, the baseline shifts ±1px
 * and the advance width varies ±3%. The same seed always gives the same output; "Redraw" = new seed.
 *
 * Connected (cursive) fonts rotate and shift whole words instead of single letters, and point jitter
 * fades out near the glyph's left/right edges, so the joins between letters stay closed.
 */
import type { Font, Glyph, PathCommand } from 'opentype.js'

export const JITTER = {
  pointMin: 0.005,
  pointMax: 0.02,
  rotationDeg: 1.5,
  baselinePx: 1,
  advance: 0.03,
} as const

/**
 * Typographic fallbacks for characters some fonts don't map. U+02BB (oʻ, gʻ) is often missing even in
 * fonts with full Cyrillic; U+2018 is the look-alike every Uzbek Latin text falls back to.
 */
export const SUBSTITUTES: Readonly<Record<string, string>> = {
  'ʻ': '‘', // U+02BB -> U+2018
  'ʼ': '’', // U+02BC -> U+2019
}

export interface RunOptions {
  x: number
  y: number
  fontSize: number
  seed: number
  /** Distinguishes runs rendered with the same seed (e.g. line index), so lines don't repeat. */
  runIndex?: number
  connected?: boolean
}

export interface PlacedGlyph {
  commands: PathCommand[]
  x: number
  advance: number
  rotationDeg: number
  baselineShift: number
  advanceScale: number
  pointAmplitude: number
}

export interface GlyphRun {
  glyphs: PlacedGlyph[]
  width: number
}

/** Glyph index the renderer will draw for `ch` (after fallback substitution); 0 means .notdef. */
export function resolveChar(font: Font, ch: string): number {
  const direct = font.charToGlyphIndex(ch)
  if (direct !== 0) return direct
  const sub = SUBSTITUTES[ch]
  return sub ? font.charToGlyphIndex(sub) : 0
}

export function substituteMissing(font: Font, text: string): string {
  let out = ''
  for (const ch of text) {
    const sub = SUBSTITUTES[ch]
    out += sub && font.charToGlyphIndex(ch) === 0 ? sub : ch
  }
  return out
}

/** Unjittered width of `text`, for line wrapping. */
export function measureText(font: Font, text: string, fontSize: number): number {
  const scale = fontSize / font.unitsPerEm
  let width = 0
  let prev: Glyph | undefined
  for (const g of font.stringToGlyphs(substituteMissing(font, text))) {
    if (prev) width += font.getKerningValue(prev, g) * scale
    width += (g.advanceWidth ?? 0) * scale
    prev = g
  }
  return width
}

export function renderRun(font: Font, text: string, opts: RunOptions): GlyphRun {
  const { fontSize, connected = false } = opts
  const scale = fontSize / font.unitsPerEm
  const rand = mulberry32(hash(opts.seed, opts.runIndex ?? 0))
  const between = (min: number, max: number) => min + (max - min) * rand()

  const glyphs: PlacedGlyph[] = []
  let pen = opts.x
  let prev: Glyph | undefined
  let word = { startX: pen, rotationDeg: 0, baselineShift: 0 }
  let atWordStart = true

  for (const g of font.stringToGlyphs(substituteMissing(font, text))) {
    const isSpace = g.unicode === 32
    if (prev) pen += font.getKerningValue(prev, g) * scale
    prev = g

    const baseAdvance = (g.advanceWidth ?? 0) * scale
    if (isSpace) {
      const advanceScale = 1 + between(-JITTER.advance, JITTER.advance)
      pen += baseAdvance * advanceScale
      atWordStart = true
      continue
    }

    if (connected && atWordStart) {
      word = {
        startX: pen,
        rotationDeg: between(-JITTER.rotationDeg, JITTER.rotationDeg),
        baselineShift: between(-JITTER.baselinePx, JITTER.baselinePx),
      }
    }
    atWordStart = false

    const rotationDeg = connected ? word.rotationDeg : between(-JITTER.rotationDeg, JITTER.rotationDeg)
    const baselineShift = connected ? word.baselineShift : between(-JITTER.baselinePx, JITTER.baselinePx)
    // Stretching one letter of a joined word would open a gap at the join; connected fonts vary word spacing only.
    const advanceScale = connected ? 1 : 1 + between(-JITTER.advance, JITTER.advance)
    const pointAmplitude = between(JITTER.pointMin, JITTER.pointMax) * fontSize

    const local = jitterPoints(g.getPath(0, 0, fontSize, undefined, font).commands, {
      amplitude: pointAmplitude,
      rand,
      // Keep joins closed: no point jitter within ~8% em of the glyph's side bearings.
      taper: connected ? { width: baseAdvance, fade: 0.08 * fontSize } : undefined,
    })

    const pivot = connected
      ? { x: word.startX, y: opts.y }
      : { x: pen + baseAdvance / 2, y: opts.y - fontSize * 0.35 }
    const commands = transformCommands(local, pen, opts.y + baselineShift, pivot, rotationDeg)

    const advance = baseAdvance * advanceScale
    glyphs.push({ commands, x: pen, advance, rotationDeg, baselineShift, advanceScale, pointAmplitude })
    pen += advance
  }

  return { glyphs, width: pen - opts.x }
}

export function commandsToSvgPath(commands: PathCommand[], decimals = 2): string {
  const n = (v: number) => +v.toFixed(decimals)
  return commands
    .map((c) => {
      switch (c.type) {
        case 'M':
        case 'L':
          return `${c.type}${n(c.x)} ${n(c.y)}`
        case 'Q':
          return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`
        case 'C':
          return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`
        case 'Z':
          return 'Z'
      }
    })
    .join('')
}

interface JitterConfig {
  amplitude: number
  rand: () => number
  taper?: { width: number; fade: number }
}

function jitterPoints(commands: PathCommand[], cfg: JitterConfig): PathCommand[] {
  // Points that coincide (contour start/end, shared on-curve points) must move together or the outline cracks.
  const moved = new Map<string, [number, number]>()
  const move = (x: number, y: number): [number, number] => {
    const key = `${x.toFixed(3)},${y.toFixed(3)}`
    let p = moved.get(key)
    if (!p) {
      let a = cfg.amplitude
      if (cfg.taper) {
        const edge = Math.min(x, cfg.taper.width - x)
        a *= Math.max(0, Math.min(1, edge / cfg.taper.fade))
      }
      p = [x + (cfg.rand() * 2 - 1) * a, y + (cfg.rand() * 2 - 1) * a]
      moved.set(key, p)
    }
    return p
  }

  return commands.map((c) => {
    switch (c.type) {
      case 'M':
      case 'L': {
        const [x, y] = move(c.x, c.y)
        return { ...c, x, y }
      }
      case 'Q': {
        const [x1, y1] = move(c.x1, c.y1)
        const [x, y] = move(c.x, c.y)
        return { ...c, x1, y1, x, y }
      }
      case 'C': {
        const [x1, y1] = move(c.x1, c.y1)
        const [x2, y2] = move(c.x2, c.y2)
        const [x, y] = move(c.x, c.y)
        return { ...c, x1, y1, x2, y2, x, y }
      }
      case 'Z':
        return c
    }
  })
}

function transformCommands(
  commands: PathCommand[],
  dx: number,
  dy: number,
  pivot: { x: number; y: number },
  rotationDeg: number,
): PathCommand[] {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const t = (x: number, y: number): [number, number] => {
    const px = x + dx - pivot.x
    const py = y + dy - pivot.y
    return [pivot.x + px * cos - py * sin, pivot.y + px * sin + py * cos]
  }

  return commands.map((c) => {
    switch (c.type) {
      case 'M':
      case 'L': {
        const [x, y] = t(c.x, c.y)
        return { ...c, x, y }
      }
      case 'Q': {
        const [x1, y1] = t(c.x1, c.y1)
        const [x, y] = t(c.x, c.y)
        return { ...c, x1, y1, x, y }
      }
      case 'C': {
        const [x1, y1] = t(c.x1, c.y1)
        const [x2, y2] = t(c.x2, c.y2)
        const [x, y] = t(c.x, c.y)
        return { ...c, x1, y1, x2, y2, x, y }
      }
      case 'Z':
        return c
    }
  })
}

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x6a09e667, 0xc2b2ae35)
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
