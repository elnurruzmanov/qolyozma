/**
 * Handwriting-style deformation on top of opentype.js outlines.
 *
 * Real handwriting never repeats a letter exactly, but a pen stroke is still smooth. So nothing moves points
 * independently (that tears the edges and breaks stroke width). Instead, with seeded amplitudes from JITTER:
 *   line  — baseline slope
 *   word  — baseline offset, spacing to the next word
 *   glyph — affine: rotation, size, width, shear; plus one smooth, low-frequency displacement field sampled
 *           at each point's position, so neighbouring points (and both edges of a stroke) move together;
 *           stroke width ("ink pressure")
 * `naturalness` 0–10 scales every amplitude (see naturalnessScale): 0 = the plain font, 5 = JITTER as written.
 * The same seed always gives the same output; "Redraw" = new seed.
 *
 * Connected (cursive) fonts apply the affine and the displacement field per word, in word coordinates, so the
 * field is continuous across the joins between letters.
 */
import type { Font, Glyph, PathCommand } from 'opentype.js'
import {
  IDENTITY,
  apply,
  clamp,
  hash,
  mulberry32,
  multiply,
  randomField,
  rotateAbout,
  scaleXY,
  shearX,
  translate,
  type Field,
  type Matrix,
} from './deform'

/** Amplitudes at naturalness = NATURALNESS_DEFAULT. Angles in degrees, `*Px` in CSS px, the rest relative. */
export const JITTER = {
  lineSlopeDeg: 0.8,
  wordBaselinePx: 2,
  wordSpacing: 0.15,
  glyphRotationDeg: 3,
  size: 0.04,
  width: 0.05,
  shearDeg: 4,
  /** Peak displacement of the smooth field, fraction of the em size. */
  field: 0.025,
  /** Spatial frequency range of the field, in cycles per em: well below stroke-width detail. */
  fieldFrequency: [0.3, 0.7],
  /** Max extra stroke width (ink pressure), fraction of the em size. */
  stroke: 0.015,
} as const

/** Extra stroke width per unit of `weight` (pen thickness), fraction of the em size. */
export const WEIGHT_STEP = 0.012
export const WEIGHT_MAX = 5

export const NATURALNESS_DEFAULT = 5
export const NATURALNESS_MAX = 10

/**
 * Amplitude multiplier for a slider value: linear up to the default (5 -> 1), then flatter so that 10 (-> 1.6)
 * is clearly more lively but still easy to read.
 */
export function naturalnessScale(n: number): number {
  const v = clamp(n, 0, NATURALNESS_MAX)
  return v <= NATURALNESS_DEFAULT ? v / NATURALNESS_DEFAULT : 1 + (v - NATURALNESS_DEFAULT) * 0.12
}

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
  /** Writer's slant in degrees, added to every glyph's shear; positive leans right. Not scaled by naturalness. */
  slantDeg?: number
  /** Pen thickness 0–WEIGHT_MAX: a constant stroke added on top of the ink-pressure variation. Default 0. */
  weight?: number
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
  shearDeg: number
  /** Peak displacement of the smooth field applied to this glyph, px. */
  fieldAmplitude: number
  strokeWidth: number
}

export interface PlacedWord {
  baselineShift: number
  /** Scale applied to the space after this word. */
  spacingScale: number
}

export interface GlyphRun {
  /** The text this run draws. */
  text: string
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

interface Shape {
  rotationDeg: number
  sizeScale: number
  widthScale: number
  shearDeg: number
  field: Field
}

export function renderRun(font: Font, text: string, opts: RunOptions): GlyphRun {
  const { fontSize, connected = false, slantDeg = 0 } = opts
  const penWidth = clamp(opts.weight ?? 0, 0, WEIGHT_MAX) * WEIGHT_STEP * fontSize
  const k = naturalnessScale(opts.naturalness ?? NATURALNESS_DEFAULT)
  const scale = fontSize / font.unitsPerEm
  const rand = mulberry32(hash(opts.seed, opts.runIndex ?? 0))
  /** Uniform in [-amplitude·k, amplitude·k]. */
  const sym = (amplitude: number) => (rand() * 2 - 1) * amplitude * k
  const newShape = (): Shape => ({
    rotationDeg: sym(JITTER.glyphRotationDeg),
    sizeScale: 1 + sym(JITTER.size),
    widthScale: 1 + sym(JITTER.width),
    shearDeg: sym(JITTER.shearDeg) + slantDeg,
    field: randomField(rand, JITTER.field * fontSize * k * (0.5 + 0.5 * rand()), fontSize, JITTER.fieldFrequency),
  })

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
    const wordShape = connected ? newShape() : undefined
    const wordMatrix = multiply(
      line,
      translate(pen, opts.y + word.baselineShift),
      wordShape ? shapeMatrix(wordShape, 0, 0) : IDENTITY,
    )

    let local = 0
    let prev: Glyph | undefined
    for (const g of token.glyphs) {
      if (prev) local += kerning(font, prev, g) * scale
      prev = g
      const baseAdvance = (g.advanceWidth ?? 0) * scale
      const s = wordShape ?? newShape()
      const strokeWidth = JITTER.stroke * fontSize * k * rand() + penWidth
      const outline = g.getPath(0, 0, fontSize, undefined, font).commands

      let commands: PathCommand[]
      let advance: number
      if (wordShape) {
        // Field and affine live in word coordinates: continuous across the joins between letters.
        commands = mapPoints(outline, (x, y) => apply(wordMatrix, ...s.field(x + local, y)))
        advance = baseAdvance * s.widthScale * s.sizeScale
      } else {
        advance = baseAdvance * s.widthScale * s.sizeScale
        const m = multiply(wordMatrix, translate(local, 0), shapeMatrix(s, advance / 2, -0.35 * fontSize * s.sizeScale))
        commands = mapPoints(outline, (x, y) => apply(m, ...s.field(x, y)))
      }

      glyphs.push({
        commands,
        x: apply(wordMatrix, local, 0)[0],
        advance,
        word: wordIndex,
        rotationDeg: s.rotationDeg,
        sizeScale: s.sizeScale,
        widthScale: s.widthScale,
        shearDeg: s.shearDeg,
        fieldAmplitude: s.field.amplitude,
        strokeWidth,
      })
      local += wordShape ? baseAdvance : advance
    }
    pen += wordShape ? local * wordShape.widthScale * wordShape.sizeScale : local
  }

  return { text, glyphs, words, slopeDeg, width: pen - opts.x }
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

/** Scale from the origin, then rotate and shear around (px, py) given in scaled coordinates. */
function shapeMatrix(s: Shape, px: number, py: number): Matrix {
  return multiply(
    translate(px, py),
    rotateAbout(0, 0, s.rotationDeg),
    shearX(s.shearDeg),
    translate(-px, -py),
    scaleXY(s.widthScale * s.sizeScale, s.sizeScale),
  )
}

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
