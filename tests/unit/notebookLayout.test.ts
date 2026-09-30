// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Font } from 'opentype.js'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  A4,
  NOTEBOOK_EM,
  PAPER_KINDS,
  columnWidths,
  layoutNotebook,
  paperGeometry,
  wrap,
  type NotebookLayout,
  type NotebookOptions,
} from '../../src/core/layout/notebook'
import type { Block, Document } from '../../src/core/model'
import { parsePdf } from '../../src/core/parse/pdf'
import { measureText, type GlyphRun } from '../../src/core/render/glyphs'
import { loadFontFile } from './fontLoader'
import { flatten } from './geometry'

const fixture = (name: string) => parsePdf(readFileSync(resolve(__dirname, '../fixtures', name)))
const MM = 96 / 25.4

let font: Font
let cursive: Font
beforeAll(async () => {
  font = await loadFontFile('Caveat-Regular.woff2')
  cursive = await loadFontFile('BadScript-Regular.woff2')
})

const layout = (doc: Document, opts: Partial<NotebookOptions> = {}, f = font) =>
  layoutNotebook(doc, f, { paper: 'lined', seed: 1, ...opts })

const words = (s: string) => s.split(/\s+/).filter(Boolean)
const allRuns = (l: NotebookLayout) => l.pages.flatMap((p) => p.runs)

/** Bounding box of a run's deformed outlines. */
function runBox(run: GlyphRun) {
  const pts = run.glyphs.flatMap((g) => flatten(g.commands).flat())
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
}

const LOREM =
  'Bugun ertalab barvaqt turdim va maktabga bordim. Oʻzbekiston — goʻzal yurt, bogʻlarda gʻoʻza ochildi. ' +
  'Darslardan keyin kutubxonaga borib, kitob oʻqidim va uyga qaytdim.'
const longDoc = (paragraphs: number): Document => ({
  blocks: Array.from({ length: paragraphs }, (_, i): Block => ({ kind: 'paragraph', text: `${i + 1}. ${LOREM}` })),
})

describe('paperGeometry', () => {
  it('lined: 8 mm rules, text on the rules, left of the red margin', () => {
    const g = paperGeometry('lined')
    expect(g.pitch).toBeCloseTo(8 * MM)
    expect(g.baselines).toEqual(g.paper.rows)
    expect(g.left).toBeLessThan(g.right)
    expect(g.right).toBeLessThan(g.paper.marginX!)
    expect(g.baselines.at(-1)!).toBeLessThan(A4.height)
  })

  it('grid: 5 mm cells, one text line every two cells, on a grid line', () => {
    const g = paperGeometry('grid')
    const cell = g.paper.columns[1]! - g.paper.columns[0]!
    expect(cell).toBeCloseTo(5 * MM)
    expect(g.pitch).toBeCloseTo(2 * cell)
    for (const y of g.baselines) expect(g.paper.rows.some((r) => Math.abs(r - y) < 1e-6)).toBe(true)
    expect(g.paper.columns).toContain(g.paper.marginX)
    expect(g.paper.columns).toContain(g.left)
  })

  it('plain: nothing printed', () => {
    const g = paperGeometry('plain')
    expect([g.paper.rows, g.paper.columns, g.paper.marginX]).toEqual([[], [], undefined])
  })
})

describe('wrap / columnWidths', () => {
  it('fills lines greedily, indents the first line and splits a word longer than a line', () => {
    const w = measureText(font, 'Bugun ertalab barvaqt', NOTEBOOK_EM) + 1
    expect(wrap(font, 'Bugun ertalab barvaqt turdim', NOTEBOOK_EM, w)).toEqual(['Bugun ertalab barvaqt', 'turdim'])
    expect(wrap(font, 'Bugun ertalab barvaqt', NOTEBOOK_EM, w, NOTEBOOK_EM * 3)[0]).not.toBe('Bugun ertalab barvaqt')
    const long = 'Oʻzbekistonrespublikasi'
    const parts = wrap(font, long, NOTEBOOK_EM, measureText(font, long, NOTEBOOK_EM) / 2.5)
    expect(parts.length).toBeGreaterThanOrEqual(3)
    expect(parts.join('')).toBe(long)
  })

  it('keeps natural widths when a table fits and shares the width when it does not', () => {
    expect(columnWidths([50, 80], 400, 30)).toEqual([50, 80])
    const shared = columnWidths([300, 100, 10], 200, 30)
    expect(shared.reduce((a, b) => a + b)).toBeCloseTo(200)
    expect(Math.min(...shared)).toBeGreaterThanOrEqual(30 - 1e-9)
    expect(shared[0]).toBeGreaterThan(shared[1]!)
  })
})

describe('layoutNotebook', () => {
  it('writes every word, in order, on every paper', () => {
    const doc = longDoc(30)
    const expected = doc.blocks.flatMap((b) => words((b as { text: string }).text))
    for (const paper of PAPER_KINDS) {
      expect(allRuns(layout(doc, { paper })).flatMap((r) => words(r.text))).toEqual(expected)
    }
  })

  it('paginates: lines fill each page top to bottom, then continue on the next', () => {
    const l = layout(longDoc(30))
    expect(l.pages.length).toBeGreaterThan(1)
    const g = paperGeometry('lined')
    for (const page of l.pages) {
      expect(page.runs.length).toBeLessThanOrEqual(g.baselines.length)
      const ys = page.runs.map((r) => runBox(r).bottom)
      ys.forEach((y, i) => i > 0 && expect(y).toBeGreaterThan(ys[i - 1]! - NOTEBOOK_EM * 0.6))
    }
    // All pages but the last are full.
    for (const page of l.pages.slice(0, -1)) expect(page.runs.length).toBe(g.baselines.length)
  })

  it('never writes past the margin line or off the page, even at full naturalness and slant', () => {
    for (const paper of PAPER_KINDS) {
      for (const [f, connected] of [[font, false], [cursive, true]] as const) {
        const g = paperGeometry(paper)
        const l = layout(longDoc(12), { paper, naturalness: 10, slantDeg: 10, weight: 5, connected }, f)
        for (const run of allRuns(l)) {
          const box = runBox(run)
          expect(box.left).toBeGreaterThan(g.left - NOTEBOOK_EM * 0.5)
          expect(box.right).toBeLessThan(g.paper.marginX ?? A4.width - 5 * MM)
          expect(box.top).toBeGreaterThan(0)
          expect(box.bottom).toBeLessThan(A4.height)
        }
      }
    }
  })

  it('is stable for a seed, changes with Redraw, and at naturalness 0 is the same for every seed', () => {
    const doc = longDoc(2)
    expect(layout(doc, { seed: 5 })).toEqual(layout(doc, { seed: 5 }))
    expect(layout(doc, { seed: 6 })).not.toEqual(layout(doc, { seed: 5 }))
    // JSON: (rand·2−1)·0 is sometimes −0, which toEqual tells apart from 0.
    expect(JSON.stringify(layout(doc, { seed: 6, naturalness: 0 }))).toBe(JSON.stringify(layout(doc, { seed: 5, naturalness: 0 })))
  })

  it('centres headings and leaves an empty line before them', () => {
    const g = paperGeometry('lined')
    const l = layout({ blocks: [{ kind: 'paragraph', text: 'Salom.' }, { kind: 'heading', level: 1, text: 'Sarlavha' }] }, { naturalness: 0 })
    const [para, head] = l.pages[0]!.runs
    const box = runBox(head!)
    expect(Math.abs((box.left + box.right) / 2 - (g.left + g.right) / 2)).toBeLessThan(NOTEBOOK_EM * 0.5)
    expect(runBox(head!).bottom - runBox(para!).bottom).toBeGreaterThan(1.5 * g.pitch)
  })

  it('an empty document is one blank page; images are counted, not drawn', () => {
    expect(layout({ blocks: [] }).pages).toHaveLength(1)
    const l = layout({ blocks: [{ kind: 'image', width: 100, height: 100, page: 1 }] })
    expect([l.pages.length, l.pages[0]!.runs.length, l.skippedImages]).toEqual([1, 0, 1])
  })
})

describe('tables', () => {
  it('table.pdf: both tables redrawn by hand on one page, cells whole', async () => {
    const l = layout(await fixture('table.pdf'))
    expect(l.pages).toHaveLength(1)
    const page = l.pages[0]!
    expect(page.tables).toBe(2)
    // Table 1: 5 row borders + 4 column borders; table 2: 4 + 3.
    expect(page.strokes).toHaveLength(9 + 7)
    for (const s of page.strokes) expect(s.width).toBeGreaterThan(0)
    const texts = page.runs.map((r) => r.text)
    for (const cell of ['Matematika', 'Chorshanba', 'Gʻayrat', 'Ona tili']) expect(texts).toContain(cell)
  })

  it('cell text stays inside its cell', async () => {
    const l = layout(await fixture('table.pdf'), { naturalness: 10, slantDeg: 8 })
    const page = l.pages[0]!
    const cols = page.strokes.slice(5, 9) // vertical borders of table 1
    const xs = cols.map((s) => s.points[0]![0]).sort((a, b) => a - b)
    const cell = page.runs.find((r) => r.text === 'Matematika')!
    const box = runBox(cell)
    expect(box.left).toBeGreaterThan(xs[1]!)
    expect(box.right).toBeLessThan(xs[2]!)
  })

  it('a long table continues on the next page with its own borders; rows are never split', () => {
    const rows = Array.from({ length: 60 }, (_, i) => [`Qator ${i + 1}`, `Qiymat ${i + 1}`])
    const l = layout({ blocks: [{ kind: 'table', rows }] })
    expect(l.pages.length).toBeGreaterThanOrEqual(2)
    for (const page of l.pages) {
      expect(page.tables).toBe(1)
      expect(page.strokes.length).toBeGreaterThan(3)
      const texts = page.runs.map((r) => r.text)
      for (const t of texts.filter((t) => t.startsWith('Qator'))) expect(texts).toContain(t.replace('Qator', 'Qiymat'))
    }
    expect(allRuns(l).map((r) => r.text)).toEqual(rows.flat())
  })

  it('a table wider than the page is fitted to the text column and its cells wrap', () => {
    const g = paperGeometry('lined')
    const row = Array.from({ length: 6 }, (_, i) => `Juda uzun ustun sarlavhasi ${i + 1}`)
    const l = layout({ blocks: [{ kind: 'table', rows: [row, row] }] })
    const xs = l.pages[0]!.strokes.flatMap((s) => s.points.map((p) => p[0]))
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(g.right - g.left + NOTEBOOK_EM)
    expect(l.pages[0]!.runs.length).toBeGreaterThan(12) // wrapped
  })
})

describe('diagrams', () => {
  it('diagram.pdf: boxes, arrows and labels redrawn, each label inside its box', async () => {
    const l = layout(await fixture('diagram.pdf'))
    expect(l.pages).toHaveLength(1)
    const page = l.pages[0]!
    expect(page.diagrams).toBe(1)
    const boxes = page.strokes.filter((s) => s.closed && !s.filled)
    const heads = page.strokes.filter((s) => s.filled)
    const shafts = page.strokes.filter((s) => !s.closed)
    expect([boxes.length, shafts.length, heads.length]).toEqual([3, 2, 2])
    for (const label of ['Fayl', 'Tahlil', 'Natija']) {
      const run = page.runs.find((r) => r.text === label)!
      const b = runBox(run)
      const inside = boxes.some((s) => {
        const xs = s.points.map((p) => p[0])
        const ys = s.points.map((p) => p[1])
        return b.left > Math.min(...xs) && b.right < Math.max(...xs) && b.top > Math.min(...ys) && b.bottom < Math.max(...ys)
      })
      expect(inside, label).toBe(true)
    }
  })

  it('text after a diagram starts below it', async () => {
    const page = layout(await fixture('diagram.pdf')).pages[0]!
    const bottom = Math.max(...page.strokes.flatMap((s) => s.points.map((p) => p[1])))
    const after = page.runs.find((r) => r.text.startsWith('Diagrammadan'))!
    expect(runBox(after).top).toBeGreaterThan(bottom)
  })

  it('a diagram taller than a page is scaled to fit one page', () => {
    const tall: Block = {
      kind: 'diagram',
      width: 100,
      height: 3000,
      shapes: [{ points: [[0, 0], [100, 0], [100, 3000], [0, 3000]], closed: true, stroked: true, filled: false }],
      labels: [],
    }
    const l = layout({ blocks: [{ kind: 'paragraph', text: 'Salom.' }, tall] })
    expect(l.pages).toHaveLength(2)
    const ys = l.pages[1]!.strokes.flatMap((s) => s.points.map((p) => p[1]))
    expect(Math.min(...ys)).toBeGreaterThan(0)
    expect(Math.max(...ys)).toBeLessThan(A4.height)
  })
})

describe('fixture page counts', () => {
  it.each([
    ['text-only.pdf', 1],
    ['table.pdf', 1],
    ['diagram.pdf', 1],
  ])('%s -> %i page(s) on every paper', async (name, pages) => {
    const doc = await fixture(name)
    for (const paper of PAPER_KINDS) expect(layout(doc, { paper }).pages).toHaveLength(pages)
  })
})
