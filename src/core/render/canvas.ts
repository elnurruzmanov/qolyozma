import type { GlyphRun } from './glyphs'

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
