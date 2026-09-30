/**
 * Notebook layout: reflows Document blocks onto A4 notebook paper and paginates.
 *
 * Units are CSS px at 96 dpi (A4 = 793.7 × 1122.5). A page is a column of equally spaced text slots; every
 * text line takes one slot and sits on its baseline (on lined paper the baselines are the printed rules, on
 * grid paper every second grid line). Tables and diagrams take whole slots too, with one empty slot around
 * them, so nothing ever crosses the text above or below. Table rows are as many slots high as their tallest
 * cell, so on lined paper the row borders run along the printed rules.
 *
 * Text becomes glyph runs (render/glyphs.ts); table borders and diagram shapes become hand-drawn strokes
 * (render/strokes.ts), one drawing per table part / diagram so its lines stay joined.
 */
import type { Font } from 'opentype.js'
import type { Block, Diagram, Document, Table } from '../model'
import { NATURALNESS_DEFAULT, measureText, naturalnessScale, renderRun, type GlyphRun } from '../render/glyphs'
import { drawByHand, penWidth, type DrawShape, type InkStroke } from '../render/strokes'

export type PaperKind = 'lined' | 'grid' | 'plain'
export const PAPER_KINDS: readonly PaperKind[] = ['lined', 'grid', 'plain']

const MM = 96 / 25.4
export const A4 = { width: 210 * MM, height: 297 * MM } as const

/** Printed paper: everything that is on the sheet before the user writes. */
export interface Paper {
  kind: PaperKind
  width: number
  height: number
  /** Horizontal printed lines (lined paper rules, grid rows), y in px. */
  rows: number[]
  /** Vertical printed lines (grid columns), x in px. */
  columns: number[]
  /** The red margin line, x in px. */
  marginX?: number
}

export interface NotebookPage {
  paper: Paper
  /** Handwritten text, one run per line. */
  runs: GlyphRun[]
  /** Hand-drawn table borders and diagram shapes. */
  strokes: InkStroke[]
  /** Tables (or parts of a table continued from the previous page) and diagrams drawn on this page. */
  tables: number
  diagrams: number
}

export interface NotebookLayout {
  pages: NotebookPage[]
  /** Image blocks and scanned pages that notebook mode cannot write out yet. */
  skippedImages: number
}

export interface NotebookOptions {
  paper: PaperKind
  seed: number
  /** Cursive font: see RunOptions.connected. */
  connected?: boolean
  /** 0–10, default 5. */
  naturalness?: number
  slantDeg?: number
  /** Pen thickness 0–WEIGHT_MAX, for letters and lines alike. */
  weight?: number
}

/** Text size in px: a 2.7 mm x-height in the bundled fonts, like school handwriting on 8 mm ruling. */
export const NOTEBOOK_EM = 22

/** Page geometry: where the text goes. */
export interface Geometry {
  paper: Paper
  /** Left edge of the text column. */
  left: number
  /** Right edge of the text column. */
  right: number
  /** Text baselines, top to bottom. */
  baselines: number[]
  pitch: number
}

export function paperGeometry(kind: PaperKind): Geometry {
  const { width, height } = A4
  const top = 22 * MM
  const bottom = height - 12 * MM
  if (kind === 'grid') {
    const cell = 5 * MM
    const offset = (n: number) => (n % cell) / 2
    const columns = steps(offset(width), width, cell)
    const rows = steps(offset(height), height, cell)
    const marginX = nearest(columns, width - 20 * MM)
    const left = columns.find((x) => x >= 10 * MM)!
    const first = rows.findIndex((y) => y >= top)
    const baselines = rows.filter((y, i) => i >= first && (i - first) % 2 === 0 && y <= bottom)
    return { paper: { kind, width, height, rows, columns, marginX }, left, right: marginX - cell / 2, baselines, pitch: 2 * cell }
  }
  const pitch = 8 * MM
  const baselines = steps(top, bottom, pitch)
  if (kind === 'lined') {
    const marginX = width - 22 * MM
    return { paper: { kind, width, height, rows: baselines, columns: [], marginX }, left: 12 * MM, right: marginX - 3 * MM, baselines, pitch }
  }
  return { paper: { kind, width, height, rows: [], columns: [] }, left: 15 * MM, right: width - 15 * MM, baselines, pitch }
}

export function layoutNotebook(doc: Document, font: Font, options: NotebookOptions): NotebookLayout {
  const steps = layoutNotebookSteps(doc, font, options)
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
  }
}

/**
 * The same layout, one block per step, so the UI can yield to the browser between steps and a long
 * document never freezes the page. Returns the finished layout.
 */
export function layoutNotebookSteps(doc: Document, font: Font, options: NotebookOptions): Generator<void, NotebookLayout> {
  return new NotebookWriter(font, options).write(doc.blocks)
}

/** Text around tables, diagrams and headings: one empty slot. */
const GAP = 1

class NotebookWriter {
  private readonly geo: Geometry
  private readonly em = NOTEBOOK_EM
  private readonly k: number
  private readonly pages: NotebookPage[] = []
  private page!: NotebookPage
  /** Next free slot on the current page. */
  private slot = 0
  private line = 0
  private drawing = 0
  private skippedImages = 0

  constructor(
    private readonly font: Font,
    private readonly opts: NotebookOptions,
  ) {
    this.geo = paperGeometry(opts.paper)
    this.k = naturalnessScale(opts.naturalness ?? NATURALNESS_DEFAULT)
    this.newPage()
  }

  *write(blocks: Block[]): Generator<void, NotebookLayout> {
    for (const [i, block] of blocks.entries()) {
      switch (block.kind) {
        case 'heading':
          if (i > 0) this.skip(GAP)
          this.heading(block.text, block.level)
          break
        case 'paragraph':
          this.paragraph(block.text)
          break
        case 'table':
          this.table(block)
          break
        case 'diagram':
          this.diagram(block)
          break
        case 'image':
          this.skippedImages++
          break
      }
      yield
    }
    return { pages: this.pages, skippedImages: this.skippedImages }
  }

  private get width() {
    return this.geo.right - this.geo.left
  }

  private get slots() {
    return this.geo.baselines.length
  }

  /** Wrap width with room for the per-word spacing and size variation, which widens a line at runtime. */
  private wrapWidth(width: number) {
    return width / (1 + 0.12 * this.k)
  }

  private newPage() {
    this.page = { paper: this.geo.paper, runs: [], strokes: [], tables: 0, diagrams: 0 }
    this.pages.push(this.page)
    this.slot = 0
  }

  /** True if `n` more slots don't fit on the current page (a block taller than a page still starts at its top). */
  private full(n: number): boolean {
    return this.slot > 0 && this.slot + n > this.slots
  }

  /** Make sure `n` slots are free on the current page, starting a new page if not. */
  private reserve(n: number) {
    if (this.full(n)) this.newPage()
  }

  /** Empty slots, dropped at the top of a page. */
  private skip(n: number) {
    if (this.slot === 0) return
    this.slot = Math.min(this.slot + n, this.slots)
  }

  private baseline(slot = this.slot) {
    return this.geo.baselines[Math.min(slot, this.slots - 1)]!
  }

  private run(text: string, x: number, y: number, fontSize: number) {
    this.page.runs.push(
      renderRun(this.font, text, {
        x,
        y,
        fontSize,
        seed: this.opts.seed,
        runIndex: this.line++,
        connected: this.opts.connected,
        naturalness: this.opts.naturalness,
        slantDeg: this.opts.slantDeg,
        weight: this.opts.weight,
      }),
    )
  }

  private heading(text: string, level: 1 | 2 | 3) {
    const size = this.em * (level === 1 ? 1.25 : 1.1)
    for (const line of wrap(this.font, text, size, this.wrapWidth(this.width))) {
      this.reserve(1)
      const w = measureText(this.font, line, size)
      this.run(line, this.geo.left + Math.max(0, (this.width - w) / 2), this.baseline(), size)
      this.slot++
    }
  }

  private paragraph(text: string) {
    const indent = 1.5 * this.em
    wrap(this.font, text, this.em, this.wrapWidth(this.width), indent).forEach((line, i) => {
      this.reserve(1)
      this.run(line, this.geo.left + (i === 0 ? indent : 0), this.baseline(), this.em)
      this.slot++
    })
  }

  private table(table: Table) {
    const size = this.em * 0.9
    const pad = 0.35 * this.em
    const cols = Math.max(1, ...table.rows.map((r) => r.length))
    const widths = columnWidths(
      Array.from({ length: cols }, (_, c) =>
        // Room for the runtime spacing variation plus a margin, so a cell that fits is never wrapped by rounding.
        Math.max(0, ...table.rows.map((r) => measureText(this.font, r[c] ?? '', size))) * (1 + 0.12 * this.k) + 2 * pad + 0.3 * this.em,
      ),
      this.width,
      2.5 * this.em,
    )
    const xs = widths.reduce((acc, w) => [...acc, acc[acc.length - 1]! + w], [this.geo.left])
    const cells = table.rows.map((row) => widths.map((w, c) => wrap(this.font, row[c] ?? '', size, this.wrapWidth(w - 2 * pad))))

    this.skip(GAP)
    /** Row borders of the part of the table on the current page. */
    let borders: number[] = []
    const finishPart = () => {
      if (borders.length < 2) return
      const top = borders[0]!
      const bottom = borders[borders.length - 1]!
      const shapes: DrawShape[] = [
        ...borders.map((y) => line([xs[0]!, y], [xs[xs.length - 1]!, y])),
        ...xs.map((x) => line([x, top], [x, bottom])),
      ]
      this.page.strokes.push(...this.draw(shapes))
      this.page.tables++
      borders = []
    }

    for (const row of cells) {
      const height = Math.min(this.slots, Math.max(1, ...row.map((lines) => lines.length)))
      if (this.full(height)) {
        finishPart() // on the page it belongs to
        this.newPage()
      }
      const top = this.baseline() - this.geo.pitch
      if (borders.length === 0) borders.push(top)
      row.forEach((lines, c) =>
        lines.slice(0, height).forEach((text, j) =>
          this.run(text, xs[c]! + pad, this.baseline(this.slot + j) - 0.28 * this.geo.pitch, size),
        ),
      )
      this.slot += height
      borders.push(this.baseline(this.slot - 1))
    }
    finishPart()
    this.skip(GAP)
  }

  private diagram(d: Diagram) {
    if (d.width <= 0 || d.height <= 0) return
    const pitch = this.geo.pitch
    const maxHeight = (this.slots - 1) * pitch
    const s = Math.min(96 / 72, this.width / d.width, maxHeight / d.height)
    const height = Math.ceil((d.height * s + 0.5 * pitch) / pitch)

    this.skip(GAP)
    this.reserve(height)
    const top = this.baseline() - pitch + 0.25 * pitch
    const left = this.geo.left + (this.width - d.width * s) / 2
    const at = ([x, y]: [number, number]): [number, number] => [left + x * s, top + y * s]
    this.page.strokes.push(...this.draw(d.shapes.map((shape) => ({ ...shape, points: shape.points.map(at) }))))

    for (const label of d.labels) {
      // Centred on the original text; a handwritten label may be a bit wider, never much.
      let size = Math.min(label.fontSize * s * 1.15, this.em)
      const natural = measureText(this.font, label.text, size)
      const room = Math.max(label.width * s * 1.2, this.em)
      if (natural > room) size *= room / natural
      const w = measureText(this.font, label.text, size)
      const [cx, y] = at([label.x + label.width / 2, label.y])
      this.run(label.text, cx - w / 2, y, size)
    }
    this.page.diagrams++
    this.slot += height
    this.skip(GAP)
  }

  private draw(shapes: DrawShape[]): InkStroke[] {
    return drawByHand(shapes, {
      em: this.em,
      width: penWidth(this.em, this.opts.weight ?? 0),
      seed: this.opts.seed,
      groupIndex: this.drawing++,
      naturalness: this.opts.naturalness,
    })
  }
}

const line = (a: [number, number], b: [number, number]): DrawShape => ({ points: [a, b], closed: false, stroked: true, filled: false })

/** Values from `start` to `end` inclusive, `step` apart. */
function steps(start: number, end: number, step: number): number[] {
  const out: number[] = []
  for (let v = start; v <= end + 1e-6; v += step) out.push(v)
  return out
}

const nearest = (xs: number[], v: number) => xs.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a))

/**
 * Column widths: natural widths when the table fits, otherwise the available width shared in proportion to
 * the natural widths, with every column at least `min` wide (cells then wrap).
 */
export function columnWidths(natural: number[], available: number, min: number): number[] {
  const total = natural.reduce((a, b) => a + b, 0)
  const floor = Math.min(min, available / natural.length)
  if (total <= available) return natural.map((w) => Math.max(w, floor))
  // Water-fill: columns whose share would fall below the floor get the floor; the rest share what is left.
  const fixed = new Set<number>()
  for (;;) {
    const left = available - fixed.size * floor
    const flexTotal = natural.reduce((sum, w, i) => (fixed.has(i) ? sum : sum + w), 0)
    const widths = natural.map((w, i) => (fixed.has(i) ? floor : (w / flexTotal) * left))
    const below = widths.findIndex((w, i) => !fixed.has(i) && w < floor)
    if (below < 0) return widths
    fixed.add(below)
  }
}

/**
 * Greedy word wrap. The first line is `indent` shorter. A word longer than a whole line is split between
 * letters so nothing runs off the page. Each word is measured once (a line is its words plus spaces; kerning
 * across a space is negligible), so wrapping stays linear in the paragraph length.
 */
export function wrap(font: Font, text: string, fontSize: number, width: number, indent = 0): string[] {
  const widths = new Map<string, number>()
  const measure = (s: string) => {
    let w = widths.get(s)
    if (w === undefined) widths.set(s, (w = measureText(font, s, fontSize)))
    return w
  }
  const space = measure(' ')
  const lines: string[] = []
  let current = ''
  let currentWidth = 0
  const room = () => width - (lines.length === 0 ? indent : 0)
  for (let word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? currentWidth + space + measure(word) : measure(word)
    if (candidate <= room()) {
      current = current ? `${current} ${word}` : word
      currentWidth = candidate
      continue
    }
    if (current) lines.push(current)
    while (measure(word) > room()) {
      const chars = Array.from(word)
      let cut = 1
      while (cut < chars.length && measureText(font, chars.slice(0, cut + 1).join(''), fontSize) <= room()) cut++
      lines.push(chars.slice(0, cut).join(''))
      word = chars.slice(cut).join('')
    }
    current = word
    currentWidth = measure(word)
  }
  if (current) lines.push(current)
  return lines
}
