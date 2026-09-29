import { describe, expect, it } from 'vitest'
import type { Point } from '../../src/core/model'
import {
  analysePage,
  findTables,
  groupLines,
  textStats,
  type PageContent,
  type PathShape,
  type TextRun,
} from '../../src/core/parse/pdfLayout'

const page = (over: Partial<PageContent>): PageContent => ({
  width: 595,
  height: 842,
  runs: [],
  paths: [],
  images: 0,
  page: 1,
  ...over,
})
const run = (text: string, x: number, y: number, fontSize = 11): TextRun => ({
  text,
  x,
  y,
  fontSize,
  width: text.length * fontSize * 0.5,
})
const stroke = (points: Point[], closed = false): PathShape => ({
  subpaths: [{ points, closed }],
  stroked: true,
  filled: false,
  whiteFill: false,
})
const rect = (x: number, y: number, w: number, h: number) =>
  stroke(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    true,
  )
/** Grid drawn as separate stroked lines. */
function gridLines(xs: number[], ys: number[]): PathShape[] {
  const l = xs[0]!
  const r = xs[xs.length - 1]!
  const t = ys[0]!
  const b = ys[ys.length - 1]!
  return [
    ...ys.map((y) => stroke([[l, y], [r, y]])),
    ...xs.map((x) => stroke([[x, t], [x, b]])),
  ]
}

describe('findTables', () => {
  it('finds a 2×2 grid', () => {
    const [grid] = findTables(gridLines([50, 150, 250], [100, 120, 140]))
    expect(grid?.xs).toEqual([50, 150, 250])
    expect(grid?.ys).toEqual([100, 120, 140])
  })

  it('finds a grid made of cell rectangles', () => {
    const cells = [0, 1].flatMap((r) => [0, 1, 2].map((c) => rect(50 + c * 100, 100 + r * 20, 100, 20)))
    expect(findTables(cells)).toHaveLength(1)
  })

  it('does not call a single box, or boxes in a row, a table', () => {
    expect(findTables([rect(50, 100, 100, 40)])).toHaveLength(0)
    expect(findTables([rect(50, 100, 100, 40), rect(200, 100, 100, 40), rect(350, 100, 100, 40)])).toHaveLength(0)
  })

  it('does not call a box with one divider (1 column) a table', () => {
    expect(findTables(gridLines([50, 250], [100, 120, 140]))).toHaveLength(0)
  })
})

describe('analysePage', () => {
  it('assigns text to table cells by centre and leaves the rest as paragraphs', () => {
    const blocks = analysePage(
      page({
        paths: gridLines([50, 150, 250], [100, 120, 140]),
        runs: [run('Intro', 50, 80), run('A', 55, 115), run('B', 155, 115), run('C', 55, 135), run('D', 155, 135)],
      }),
    )
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Intro' },
      { kind: 'table', rows: [['A', 'B'], ['C', 'D']] },
    ])
  })

  it('ignores a lone horizontal rule and a white page background', () => {
    const background: PathShape = { ...rect(0, 0, 595, 842), stroked: false, filled: true, whiteFill: true }
    const blocks = analysePage(page({ paths: [stroke([[50, 90], [500, 90]]), background], runs: [run('Text', 50, 80)] }))
    expect(blocks).toEqual([{ kind: 'paragraph', text: 'Text' }])
  })

  it('reports a page with only a raster image as a scan that needs OCR', () => {
    expect(analysePage(page({ images: 1, page: 3 }))).toEqual([{ kind: 'image', width: 595, height: 842, page: 3 }])
  })

  it('breaks paragraphs on a first-line indent and on a large gap', () => {
    const blocks = analysePage(
      page({
        runs: [
          run('One a', 50, 100),
          run('one b', 50, 114),
          run('Two a', 80, 128), // indent
          run('two b', 50, 142),
          run('Three', 50, 190), // gap
        ],
      }),
    )
    expect(blocks.map((b) => (b as { text: string }).text)).toEqual(['One a one b', 'Two a two b', 'Three'])
  })

  it('classifies headings with document-wide statistics', () => {
    const p1 = page({ runs: [run('Big', 50, 60, 20), run('Mid', 50, 100, 15), ...Array.from({ length: 5 }, (_, i) => run('body text', 50, 130 + i * 14))] })
    const p2 = page({ runs: [run('Only mid', 50, 60, 15)], page: 2 })
    const stats = textStats([p1, p2])
    expect(analysePage(p2, stats)).toEqual([{ kind: 'heading', level: 2, text: 'Only mid' }])
  })
})

describe('groupLines', () => {
  it('joins runs on one baseline with spaces only where there is a gap', () => {
    const lines = groupLines([
      { text: 'Oʻzbek', x: 50, y: 100, width: 40, fontSize: 10 },
      { text: 'iston', x: 90, y: 100.5, width: 25, fontSize: 10 },
      { text: 'goʻzal', x: 125, y: 100, width: 30, fontSize: 10 },
    ])
    expect(lines.map((l) => l.text)).toEqual(['Oʻzbekiston goʻzal'])
  })

  it('splits far-apart runs when asked (diagram labels)', () => {
    const runs = [run('Fayl', 50, 100), run('Tahlil', 250, 100)]
    expect(groupLines(runs).map((l) => l.text)).toEqual(['Fayl Tahlil'])
    expect(groupLines(runs, 2).map((l) => l.text)).toEqual(['Fayl', 'Tahlil'])
  })
})
