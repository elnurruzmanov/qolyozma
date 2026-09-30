import type { NotebookPage, Paper } from '../layout/notebook'
import type { GlyphRun } from './glyphs'
import type { InkStroke } from './strokes'

export function drawRuns(ctx: CanvasRenderingContext2D, runs: GlyphRun[], color: string): void {
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineJoin = 'round'
  for (const run of runs) {
    for (const glyph of run.glyphs) {
      ctx.beginPath()
      for (const c of glyph.commands) {
        switch (c.type) {
          case 'M':
            ctx.moveTo(c.x, c.y)
            break
          case 'L':
            ctx.lineTo(c.x, c.y)
            break
          case 'Q':
            ctx.quadraticCurveTo(c.x1, c.y1, c.x, c.y)
            break
          case 'C':
            ctx.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y)
            break
          case 'Z':
            ctx.closePath()
            break
        }
      }
      ctx.fill()
      // Ink pressure: a thin stroke in the same color thickens the letter slightly.
      if (glyph.strokeWidth > 0) {
        ctx.lineWidth = glyph.strokeWidth
        ctx.stroke()
      }
    }
  }
}

/** Printed paper colours: pale blue rules and grid, red margin line, warm white sheet. */
export const PAPER_COLORS = { sheet: '#fdfcf8', rule: '#b9cbe4', grid: '#d3deec', margin: '#e59a9a' } as const

export function drawPaper(ctx: CanvasRenderingContext2D, paper: Paper): void {
  ctx.fillStyle = PAPER_COLORS.sheet
  ctx.fillRect(0, 0, paper.width, paper.height)
  ctx.lineWidth = 1
  ctx.strokeStyle = paper.kind === 'grid' ? PAPER_COLORS.grid : PAPER_COLORS.rule
  ctx.beginPath()
  for (const y of paper.rows) {
    ctx.moveTo(0, y)
    ctx.lineTo(paper.width, y)
  }
  for (const x of paper.columns) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, paper.height)
  }
  ctx.stroke()
  if (paper.marginX !== undefined) {
    ctx.strokeStyle = PAPER_COLORS.margin
    ctx.beginPath()
    ctx.moveTo(paper.marginX, 0)
    ctx.lineTo(paper.marginX, paper.height)
    ctx.stroke()
  }
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: InkStroke[], color: string): void {
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const s of strokes) {
    ctx.beginPath()
    s.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    if (s.closed) ctx.closePath()
    if (s.filled) ctx.fill()
    if (s.width > 0) {
      ctx.lineWidth = s.width
      ctx.stroke()
    }
  }
}

/** One notebook page at 1 unit = 1 CSS px; scale the context first for other sizes. */
export function drawNotebookPage(ctx: CanvasRenderingContext2D, page: NotebookPage, ink: string): void {
  drawPaper(ctx, page.paper)
  drawStrokes(ctx, page.strokes, ink)
  drawRuns(ctx, page.runs, ink)
}
