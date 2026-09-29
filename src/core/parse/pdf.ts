/**
 * PDF -> Document, with pdf.js. Extraction only: text runs, vector paths and raster images per page, in page
 * coordinates (pt, origin top-left); the analysis into paragraphs, tables and diagrams is in pdfLayout.ts.
 *
 * Ported from legacy/prototype.html (text rows from getTextContent, vector paths from getOperatorList with a
 * tracked transform matrix), updated for the pdf.js 6 operator list format.
 *
 * Uses the pdf.js *legacy* build: the modern build needs very recent engines (e.g. Uint8Array.prototype.toHex,
 * missing in Node 24 and in browsers older than 2025), and our users are often on older phones.
 * In the browser, set `GlobalWorkerOptions.workerSrc` to the legacy worker once before parsing (the UI owns
 * that); in Node (tests) pdf.js runs its worker in-process.
 */
import type { PDFPageProxy } from 'pdfjs-dist'
import type { Block, Document, Point } from '../model'
import { analysePage, textStats, type PageContent, type PathShape, type TextRun } from './pdfLayout'

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type Matrix = number[]

/** Path opcodes inside constructPath data (pdf.js DrawOPS). */
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const
const CURVE_STEPS = 8

export interface ParsePdfOptions {
  /** pdf.js module; defaults to a dynamic import of the legacy build. */
  pdfjs?: PdfJs
  /** Called after each page, for progress UI. */
  onPage?: (page: number, total: number) => void
}

export async function parsePdf(data: ArrayBuffer | Uint8Array, options: ParsePdfOptions = {}): Promise<Document> {
  const pdfjs = options.pdfjs ?? (await import('pdfjs-dist/legacy/build/pdf.mjs'))
  // pdf.js takes ownership of the buffer; copy so the caller's data stays usable.
  const bytes = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data)).slice()
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true })
  const pdf = await task.promise
  try {
    // Two passes: font statistics must be document-wide so a heading is a heading on every page.
    const pages: PageContent[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      pages.push(await extractPage(pdfjs, page, n))
      page.cleanup()
      options.onPage?.(n, pdf.numPages)
    }
    const stats = textStats(pages)
    const blocks: Block[] = pages.flatMap((page) => analysePage(page, stats))
    return { blocks }
  } finally {
    await task.destroy()
  }
}

export async function extractPage(pdfjs: PdfJs, page: PDFPageProxy, pageNumber: number): Promise<PageContent> {
  const viewport = page.getViewport({ scale: 1 })
  const base = viewport.transform
  const { Util, OPS } = pdfjs

  const runs: TextRun[] = []
  const text = await page.getTextContent()
  for (const item of text.items) {
    if (!('str' in item) || !item.str) continue
    const m = Util.transform(base, item.transform)
    runs.push({ text: item.str, x: m[4], y: m[5], width: item.width, fontSize: Math.hypot(m[2], m[3]) })
  }

  const paths: PathShape[] = []
  let images = 0
  const ops = await page.getOperatorList()
  let ctm: Matrix = base.slice()
  let fill = [0, 0, 0]
  const stack: { ctm: Matrix; fill: number[] }[] = []
  const paint = new Map<number, { stroked: boolean; filled: boolean }>([
    [OPS.stroke, { stroked: true, filled: false }],
    [OPS.closeStroke, { stroked: true, filled: false }],
    [OPS.fill, { stroked: false, filled: true }],
    [OPS.eoFill, { stroked: false, filled: true }],
    [OPS.fillStroke, { stroked: true, filled: true }],
    [OPS.eoFillStroke, { stroked: true, filled: true }],
    [OPS.closeFillStroke, { stroked: true, filled: true }],
    [OPS.closeEOFillStroke, { stroked: true, filled: true }],
  ])
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject])

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]!
    const args = ops.argsArray[i] as unknown[]
    if (fn === OPS.save) stack.push({ ctm: ctm.slice(), fill: fill.slice() })
    else if (fn === OPS.restore) ({ ctm, fill } = stack.pop() ?? { ctm: base.slice(), fill: [0, 0, 0] })
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args as Matrix)
    else if (fn === OPS.setFillRGBColor) fill = parseColor(args)
    else if (fn === OPS.setFillGray) fill = [Number(args[0]) * 255, Number(args[0]) * 255, Number(args[0]) * 255]
    else if (imageOps.has(fn)) images++
    else if (fn === OPS.constructPath) {
      const [op, [data]] = args as [number, [ArrayLike<number> | null]]
      const mode = paint.get(op) // endPath (clipping) and anything else is not painted
      if (!mode || !data) continue
      const subpaths = decodePath(data, ctm)
      if (subpaths.length) {
        paths.push({ subpaths, ...mode, whiteFill: mode.filled && fill.every((c) => c >= 245) })
      }
    }
  }

  return { width: viewport.width, height: viewport.height, runs, paths, images, page: pageNumber }
}

function parseColor(args: unknown[]): number[] {
  const [first] = args
  if (typeof first === 'string' && /^#[0-9a-f]{6}$/i.test(first)) {
    return [1, 3, 5].map((i) => parseInt(first.slice(i, i + 2), 16))
  }
  return args.slice(0, 3).map(Number)
}

function decodePath(data: ArrayLike<number>, m: Matrix): { points: Point[]; closed: boolean }[] {
  const out: { points: Point[]; closed: boolean }[] = []
  const t = (x: number, y: number): Point => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!]
  let current: Point[] = []
  let raw: Point = [0, 0] // current point in user space
  let start: Point = [0, 0] // start of the current subpath, user space
  const finish = (closed: boolean) => {
    if (current.length > 1) out.push({ points: current, closed })
    current = []
  }
  for (let i = 0; i < data.length; ) {
    switch (data[i++]) {
      case DRAW.moveTo:
        finish(false)
        raw = [data[i++]!, data[i++]!]
        start = raw
        current = [t(...raw)]
        break
      case DRAW.lineTo:
        raw = [data[i++]!, data[i++]!]
        current.push(t(...raw))
        break
      case DRAW.curveTo: {
        const [x1, y1, x2, y2, x3, y3] = [data[i++]!, data[i++]!, data[i++]!, data[i++]!, data[i++]!, data[i++]!]
        const [x0, y0] = raw
        for (let s = 1; s <= CURVE_STEPS; s++) {
          const k = s / CURVE_STEPS
          const u = 1 - k
          current.push(
            t(
              u ** 3 * x0 + 3 * u * u * k * x1 + 3 * u * k * k * x2 + k ** 3 * x3,
              u ** 3 * y0 + 3 * u * u * k * y1 + 3 * u * k * k * y2 + k ** 3 * y3,
            ),
          )
        }
        raw = [x3, y3]
        break
      }
      case DRAW.quadraticCurveTo: {
        const [x1, y1, x2, y2] = [data[i++]!, data[i++]!, data[i++]!, data[i++]!]
        const [x0, y0] = raw
        for (let s = 1; s <= CURVE_STEPS; s++) {
          const k = s / CURVE_STEPS
          const u = 1 - k
          current.push(t(u * u * x0 + 2 * u * k * x1 + k * k * x2, u * u * y0 + 2 * u * k * y1 + k * k * y2))
        }
        raw = [x2, y2]
        break
      }
      case DRAW.closePath: {
        // Drop the duplicated end point that closePath implies.
        const [a, b] = [current[0], current[current.length - 1]]
        if (a && b && current.length > 2 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01) current.pop()
        finish(true)
        raw = start
        break
      }
      default:
        return out // unknown opcode: stop rather than misread coordinates
    }
  }
  finish(false)
  return out
}
