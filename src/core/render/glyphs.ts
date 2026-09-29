/**
 * Handwriting-style jitter on top of opentype.js outlines.
 *
 * Real handwriting never repeats a letter exactly. Every line, word and glyph gets a small seeded
 * distortion (amplitudes in JITTER, at naturalness 5):
 *   line  — baseline slope
 *   word  — baseline offset, spacing to the next word
 *   glyph — rotation, size, width, control-point jitter, stroke width ("ink pressure")
 * `naturalness` 0–10 scales every amplitude linearly (0 = the plain font, 10 = double).
 * The same seed always gives the same output; "Redraw" = new seed.
 *
 * Connected (cursive) fonts apply rotation/size/width to the whole word instead of single letters, and
 * point jitter fades out near the glyph's side bearings, so the joins between letters stay closed.
 */
import type { Font, Glyph, PathCommand } from 'opentype.js'

/** Amplitudes at naturalness = NATURALNESS_DEFAULT. Angles in degrees, `*Px` in CSS px, the rest relative. */
export const JITTER = {
  lineSlopeDeg: 0.8,
  wordBaselinePx: 2,
  wordSpacing: 0.15,
  glyphRotationDeg: 3,
  size: 0.04,
  width: 0.05,
  /** Max control-point offset, fraction of the em size. */
  point: 0.03,
  /** Max extra stroke width (ink pressure), fraction of the em size. */
  stroke: 0.025,
} as const

export const NATURALNESS_DEFAULT = 5
export const NATURALNESS_MAX = 10

export interface RunOptions {
  x: number
  y: number
  fontSize: number
  seed: number
  /** Distinguishes runs rendered with the same seed (e.g. line index), so lines don't repeat. */
  runIndex?: number
  connected?: boolean
  /** 0–10, default 5. */
  naturalness?: number
}

export interface PlacedGlyph {
  commands: PathCommand[]
  x: number
  advance: number
  /** Word index inside the run. */
  word: number
  rotationDeg: number
  sizeScale: number
  widthScale: number
  pointAmplitude: number
  strokeWidth: number
}

export interface PlacedWord {
  baselineShift: number
  /** Scale applied to the space after this word. */
  spacingScale: number
}

export interface GlyphRun {
  glyphs: PlacedGlyph[]
  words: PlacedWord[]
  slopeDeg: number
  width: number
}

/**
 * Shape text into glyphs. opentype.js throws on some GSUB lookups it can't run; fonts are cleaned by
 * scripts/build-fonts.py, and this falls back to plain cmap lookup for anything that slips through.
 */
export function shape(font: Font, text: string): Glyph[] {
  try {
    return font.stringToGlyphs(text)
  } catch {
    return Array.from(text, (ch) => font.glyphs.get(font.charToGlyphIndex(ch)))
  }
}

/** Unjittered width of `text`, for line wrapping. */
export function measureText(font: Font, text: string, fontSize: number): number {
  const scale = fontSize / font.unitsPerEm
  let width = 0
  let prev: Glyph | undefined
  for (const g of shape(font, text)) {
    if (prev) width += kerning(font, prev, g) * scale
    width += (g.advanceWidth ?? 0) * scale
    prev = g
  }
  return width
}

export function renderRun(font: Font, text: string, opts: RunOptions): GlyphRun {
  const { fontSize, connected = false } = opts
  const k = clamp(opts.naturalness ?? NATURALNESS_DEFAULT, 0, NATURALNESS_MAX) / NATURALNESS_DEFAULT
  const scale = fontSize / font.unitsPerEm
  const rand = mulberry32(hash(opts.seed, opts.runIndex ?? 0))
  /** Uniform in [-amplitude·k, amplitude·k]. */
  const sym = (amplitude: number) => (rand() * 2 - 1) * amplitude * k

  const slopeDeg = sym(JITTER.lineSlopeDeg)
  const line = rotateAbout(opts.x, opts.y, slopeDeg)

  const glyphs: PlacedGlyph[] = []
  const words: PlacedWord[] = []
  let pen = opts.x

  for (const token of splitWords(shape(font, text))) {
    if (token.space) {
      for (const g of token.glyphs) {
        const last = words[words.length - 1]
        pen += (g.advanceWidth ?? 0) * scale * (last?.spacingScale ?? 1)
      }
      continue
    }

    const wordIndex = words.length
    const word: PlacedWord = { baselineShift: sym(JITTER.wordBaselinePx), spacingScale: 1 + sym(JITTER.wordSpacing) }
    words.push(word)
    const wordRot = connected ? sym(JITTER.glyphRotationDeg) : 0
    const wordSize = connected ? 1 + sym(JITTER.size) : 1
    const wordWidth = connected ? 1 + sym(JITTER.width) : 1
    // Connected words rotate/scale as a unit around their start on the baseline.
    const wordMatrix = multiply(
      line,
      translate(pen, opts.y + word.baselineShift),
      rotateAbout(0, 0, wordRot),
      scaleXY(wordWidth * wordSize, wordSize),
    )

    let local = 0
    let prev: Glyph | undefined
    for (const g of token.glyphs) {
      if (prev) local += kerning(font, prev, g) * scale
      prev = g
      const baseAdvance = (g.advanceWidth ?? 0) * scale

      const rotationDeg = connected ? wordRot : sym(JITTER.glyphRotationDeg)
      const sizeScale = connected ? wordSize : 1 + sym(JITTER.size)
      const widthScale = connected ? wordWidth : 1 + sym(JITTER.width)
      const pointAmplitude = JITTER.point * fontSize * k * (0.3 + 0.7 * rand())
      const strokeWidth = JITTER.stroke * fontSize * k * rand()

      const outline = jitterPoints(g.getPath(0, 0, fontSize, undefined, font).commands, {
        amplitude: pointAmplitude,
        rand,
        // Keep joins closed: no point jitter within ~8% em of the side bearings.
        taper: connected ? { width: baseAdvance, fade: 0.08 * fontSize } : undefined,
      })

      const glyphAdvance = connected ? baseAdvance : baseAdvance * widthScale * sizeScale
      const glyphMatrix = connected
        ? translate(local, 0)
        : multiply(
            translate(local, 0),
            rotateAbout(glyphAdvance / 2, -0.35 * fontSize * sizeScale, rotationDeg),
            scaleXY(widthScale * sizeScale, sizeScale),
          )
      const m = multiply(wordMatrix, glyphMatrix)

      glyphs.push({
        commands: transform(outline, m),
        x: apply(m, 0, 0)[0],
        advance: connected ? baseAdvance * wordWidth * wordSize : glyphAdvance,
        word: wordIndex,
        rotationDeg,
        sizeScale,
        widthScale,
        pointAmplitude,
        strokeWidth,
      })
      local += glyphAdvance
    }
    pen += connected ? local * wordWidth * wordSize : local
  }

  return { glyphs, words, slopeDeg, width: pen - opts.x }
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

function kerning(font: Font, left: Glyph, right: Glyph): number {
  const v = font.getKerningValue(left, right)
  return Number.isFinite(v) ? v : 0
}

function splitWords(glyphs: Glyph[]): { space: boolean; glyphs: Glyph[] }[] {
  const tokens: { space: boolean; glyphs: Glyph[] }[] = []
  for (const g of glyphs) {
    const space = g.unicode === 32 || g.unicode === 0xa0
    const last = tokens[tokens.length - 1]
    if (last && last.space === space) last.glyphs.push(g)
    else tokens.push({ space, glyphs: [g] })
  }
  return tokens
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
        a *= clamp(edge / cfg.taper.fade, 0, 1)
      }
      p = [x + (cfg.rand() * 2 - 1) * a, y + (cfg.rand() * 2 - 1) * a]
      moved.set(key, p)
    }
    return p
  }
  return mapPoints(commands, move)
}

// 2D affine matrices in canvas order: [a, b, c, d, e, f] -> x' = a·x + c·y + e, y' = b·x + d·y + f
type Matrix = readonly [number, number, number, number, number, number]

const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]
const scaleXY = (sx: number, sy: number): Matrix => [sx, 0, 0, sy, 0, 0]

function rotateAbout(cx: number, cy: number, deg: number): Matrix {
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return [cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos]
}

function multiply(...ms: Matrix[]): Matrix {
  return ms.reduce((p, q) => [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
  ])
}

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]

const transform = (commands: PathCommand[], m: Matrix) => mapPoints(commands, (x, y) => apply(m, x, y))

function mapPoints(commands: PathCommand[], f: (x: number, y: number) => [number, number]): PathCommand[] {
  return commands.map((c) => {
    switch (c.type) {
      case 'M':
      case 'L': {
        const [x, y] = f(c.x, c.y)
        return { ...c, x, y }
      }
      case 'Q': {
        const [x1, y1] = f(c.x1, c.y1)
        const [x, y] = f(c.x, c.y)
        return { ...c, x1, y1, x, y }
      }
      case 'C': {
        const [x1, y1] = f(c.x1, c.y1)
        const [x2, y2] = f(c.x2, c.y2)
        const [x, y] = f(c.x, c.y)
        return { ...c, x1, y1, x2, y2, x, y }
      }
      case 'Z':
        return c
    }
  })
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

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
