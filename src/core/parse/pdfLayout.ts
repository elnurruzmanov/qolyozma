/**
 * Page analysis for PDFs, independent of pdf.js: turns positioned text runs and vector paths into blocks.
 * Coordinates are PDF points with the origin at the top-left of the page and y growing downwards.
 *
 * 1. Tables: axis-aligned rules (stroked lines, rectangle edges, hairline filled rectangles) that intersect
 *    form a connected grid; a grid with at least 2×2 cells is a table. Text runs are assigned to cells by
 *    their centre.
 * 2. Diagrams: the remaining visible paths are clustered by proximity; each cluster (except lone rules and
 *    page-sized backgrounds) is a diagram, and the text runs inside it become its labels.
 * 3. Text: remaining runs are grouped into lines, lines into paragraphs and headings (by font size).
 * Blocks are returned in reading order (top to bottom).
 */
import type { Block, Diagram, DiagramShape, Point, Table } from '../model'
import { normalizeText } from './text'

export interface TextRun {
  text: string
  /** Baseline start. */
  x: number
  y: number
  width: number
  fontSize: number
}

export interface PathShape {
  /** One polyline per subpath; curves already flattened. */
  subpaths: { points: Point[]; closed: boolean }[]
  stroked: boolean
  filled: boolean
  /** True for fills that are white/near-white (backgrounds, masks): never drawn as ink. */
  whiteFill: boolean
}

export interface PageContent {
  width: number
  height: number
  runs: TextRun[]
  paths: PathShape[]
  /** Number of raster images painted on the page. */
  images: number
  /** 1-based page number. */
  page: number
}

/** Tolerances in pt. */
const TOL = {
  axis: 0.8, // max deviation for a segment to count as horizontal/vertical
  join: 2.5, // how close rules must be to count as touching
  cluster: 2, // grid line positions closer than this are the same line
  hairline: 3, // filled rectangles thinner than this are rules
  diagramGap: 14, // shapes closer than this belong to the same diagram
  label: 2, // text this close to a diagram's box belongs to it
}

export function analysePage(page: PageContent, stats: TextStats = textStats([page])): Block[] {
  const runs = page.runs.filter((r) => r.text.trim() && r.fontSize > 0)
  const visible = page.paths.filter((p) => (p.stroked || (p.filled && !p.whiteFill)) && !isPageBackground(p, page))

  if (runs.length === 0 && visible.length === 0 && page.images > 0) {
    return [{ kind: 'image', width: page.width, height: page.height, page: page.page }]
  }

  const placed: { top: number; block: Block; box?: Box }[] = []
  const usedRuns = new Set<TextRun>()
  const usedPaths = new Set<PathShape>()

  for (const grid of findTables(visible)) {
    for (const p of grid.paths) usedPaths.add(p)
    placed.push({ top: grid.box.top, box: grid.box, block: tableFromGrid(grid, runs, usedRuns) })
  }

  for (const cluster of clusterShapes(visible.filter((p) => !usedPaths.has(p)))) {
    if (isLoneRule(cluster)) continue
    placed.push({ top: cluster.box.top, box: cluster.box, block: diagramFromCluster(cluster, runs, usedRuns) })
  }

  const obstacles = placed.flatMap((p) => (p.box ? [p.box] : []))
  placed.push(...textBlocks(runs.filter((r) => !usedRuns.has(r)), stats, obstacles))

  return placed.sort((a, b) => a.top - b.top).map((p) => p.block)
}

// ---------------------------------------------------------------------------------------------- geometry

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

function boxOf(points: Point[]): Box {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
}

const shapeBox = (p: PathShape) => boxOf(p.subpaths.flatMap((s) => s.points))

function union(a: Box, b: Box): Box {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  }
}

function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, a.left - b.right, b.left - a.right)
  const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom)
  return Math.hypot(dx, dy)
}

const runCentre = (r: TextRun): Point => [r.x + r.width / 2, r.y - r.fontSize * 0.35]
const inside = ([x, y]: Point, b: Box, pad = 0) =>
  x >= b.left - pad && x <= b.right + pad && y >= b.top - pad && y <= b.bottom + pad

function isPageBackground(p: PathShape, page: PageContent): boolean {
  const b = shapeBox(p)
  return (b.right - b.left) * (b.bottom - b.top) > 0.8 * page.width * page.height
}

// -------------------------------------------------------------------------------------------------- tables

interface Rule {
  horizontal: boolean
  /** y for horizontal rules, x for vertical ones. */
  at: number
  from: number
  to: number
  path: PathShape
}

interface Grid {
  xs: number[]
  ys: number[]
  box: Box
  paths: Set<PathShape>
}

function rulesOf(path: PathShape): Rule[] {
  const rules: Rule[] = []
  for (const sub of path.subpaths) {
    const b = boxOf(sub.points)
    const w = b.right - b.left
    const h = b.bottom - b.top
    // Hairline rectangles (a common way to draw table borders) count as one rule along their long side.
    if (path.filled && sub.closed && Math.min(w, h) < TOL.hairline && Math.max(w, h) > TOL.hairline) {
      rules.push(
        w > h
          ? { horizontal: true, at: (b.top + b.bottom) / 2, from: b.left, to: b.right, path }
          : { horizontal: false, at: (b.left + b.right) / 2, from: b.top, to: b.bottom, path },
      )
      continue
    }
    if (!path.stroked) continue
    const pts = sub.closed ? [...sub.points, sub.points[0]!] : sub.points
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1]!
      const [x2, y2] = pts[i]!
      if (Math.abs(y1 - y2) <= TOL.axis && Math.abs(x1 - x2) > TOL.hairline) {
        rules.push({ horizontal: true, at: (y1 + y2) / 2, from: Math.min(x1, x2), to: Math.max(x1, x2), path })
      } else if (Math.abs(x1 - x2) <= TOL.axis && Math.abs(y1 - y2) > TOL.hairline) {
        rules.push({ horizontal: false, at: (x1 + x2) / 2, from: Math.min(y1, y2), to: Math.max(y1, y2), path })
      }
    }
  }
  return rules
}

function touches(h: Rule, v: Rule): boolean {
  return (
    v.at >= h.from - TOL.join &&
    v.at <= h.to + TOL.join &&
    h.at >= v.from - TOL.join &&
    h.at <= v.to + TOL.join
  )
}

/** Sorted distinct positions, merging values closer than `tol`. */
function clusterValues(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const out: number[][] = []
  for (const v of sorted) {
    const last = out[out.length - 1]
    if (last && v - last[last.length - 1]! <= tol) last.push(v)
    else out.push([v])
  }
  return out.map((c) => c.reduce((s, v) => s + v, 0) / c.length)
}

/** Do the rules, merged where they touch, cover [from, to]? */
function covers(rules: Rule[], from: number, to: number): boolean {
  let reach = from + TOL.join
  for (const r of [...rules].sort((a, b) => a.from - b.from)) {
    if (r.from > reach) return false
    reach = Math.max(reach, r.to + TOL.join)
    if (reach >= to) return true
  }
  return reach >= to
}

export function findTables(paths: PathShape[]): Grid[] {
  const rules = paths.flatMap(rulesOf)
  const hs = rules.filter((r) => r.horizontal)
  const vs = rules.filter((r) => !r.horizontal)

  // Union-find over rules: horizontal and vertical rules that touch are one component.
  const parent = rules.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const index = new Map(rules.map((r, i) => [r, i]))
  for (const h of hs) for (const v of vs) if (touches(h, v)) parent[find(index.get(h)!)] = find(index.get(v)!)

  const components = new Map<number, Rule[]>()
  rules.forEach((r, i) => components.set(find(i), [...(components.get(find(i)) ?? []), r]))

  const grids: Grid[] = []
  for (const comp of components.values()) {
    const ch = comp.filter((r) => r.horizontal)
    const cv = comp.filter((r) => !r.horizontal)
    const ys = clusterValues(ch.map((r) => r.at), TOL.cluster)
    const xs = clusterValues(cv.map((r) => r.at), TOL.cluster)
    if (xs.length < 3 || ys.length < 3) continue // a single box, or one row/column: not a table
    const box = { left: xs[0]!, top: ys[0]!, right: xs[xs.length - 1]!, bottom: ys[ys.length - 1]! }
    // The outer border must run the full width (as one rule or as touching cell edges): boxes that merely
    // touch at corners don't form a table.
    const spans = (at: number) =>
      covers(ch.filter((r) => Math.abs(r.at - at) <= TOL.cluster), box.left, box.right)
    if (!spans(box.top) || !spans(box.bottom)) continue
    grids.push({ xs, ys, box, paths: new Set(comp.map((r) => r.path)) })
  }
  return grids
}

function tableFromGrid(grid: Grid, runs: TextRun[], used: Set<TextRun>): Table {
  const cells: TextRun[][][] = grid.ys.slice(1).map(() => grid.xs.slice(1).map(() => []))
  for (const run of runs) {
    const [cx, cy] = runCentre(run)
    if (!inside([cx, cy], grid.box)) continue
    const col = grid.xs.findIndex((x, i) => i > 0 && cx <= x) - 1
    const row = grid.ys.findIndex((y, i) => i > 0 && cy <= y) - 1
    if (row < 0 || col < 0) continue
    cells[row]![col]!.push(run)
    used.add(run)
  }
  return {
    kind: 'table',
    rows: cells.map((row) => row.map((cellRuns) => groupLines(cellRuns).map((l) => l.text).join(' '))),
  }
}

// ------------------------------------------------------------------------------------------------ diagrams

interface Cluster {
  paths: PathShape[]
  box: Box
}

function clusterShapes(paths: PathShape[]): Cluster[] {
  const clusters: Cluster[] = paths.map((p) => ({ paths: [p], box: shapeBox(p) }))
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (boxGap(clusters[i]!.box, clusters[j]!.box) <= TOL.diagramGap) {
          clusters[i] = {
            paths: [...clusters[i]!.paths, ...clusters[j]!.paths],
            box: union(clusters[i]!.box, clusters[j]!.box),
          }
          clusters.splice(j, 1)
          merged = true
          break outer
        }
      }
    }
  }
  return clusters
}

/** A single straight line (horizontal rule, underline): decoration, not a diagram. */
function isLoneRule(c: Cluster): boolean {
  if (c.paths.length !== 1) return false
  const w = c.box.right - c.box.left
  const h = c.box.bottom - c.box.top
  return Math.min(w, h) < TOL.hairline
}

function diagramFromCluster(cluster: Cluster, runs: TextRun[], used: Set<TextRun>): Diagram {
  const { box } = cluster
  const rel = ([x, y]: Point): Point => [round(x - box.left), round(y - box.top)]
  const shapes: DiagramShape[] = cluster.paths.flatMap((p) =>
    p.subpaths.map((s) => ({
      points: s.points.map(rel),
      closed: s.closed,
      stroked: p.stroked,
      filled: p.filled && !p.whiteFill,
    })),
  )
  const labelRuns = runs.filter((r) => !used.has(r) && inside(runCentre(r), box, TOL.label))
  labelRuns.forEach((r) => used.add(r))
  const labels = groupLines(labelRuns, LABEL_SPLIT).map((l) => {
    const [x, y] = rel([l.x, l.y])
    return { text: l.text, x, y, width: round(l.width), fontSize: l.fontSize }
  })
  return { kind: 'diagram', width: round(box.right - box.left), height: round(box.bottom - box.top), shapes, labels }
}

/** Labels on one baseline further apart than this × font size are separate labels (one per box). */
const LABEL_SPLIT = 2

const round = (v: number) => Math.round(v * 100) / 100

// ---------------------------------------------------------------------------------------------------- text

interface Line {
  text: string
  x: number
  /** Baseline. */
  y: number
  width: number
  fontSize: number
}

/**
 * Group runs into lines (same baseline) and join each line's runs left to right. Runs on the same baseline
 * further apart than `splitGap` × font size become separate lines (diagram labels, columns).
 */
export function groupLines(runs: TextRun[], splitGap = Infinity): Line[] {
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: TextRun[][] = []
  for (const run of sorted) {
    const row = rows[rows.length - 1]
    const ref = row?.[0]
    if (ref && Math.abs(run.y - ref.y) <= 0.5 * Math.min(run.fontSize, ref.fontSize)) row!.push(run)
    else rows.push([run])
  }
  const lines: Line[] = []
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x)
    let current: TextRun[] = []
    const emit = () => {
      if (!current.length) return
      let text = ''
      let end = -Infinity
      for (const r of current) {
        if (text && r.x - end > 0.15 * r.fontSize && !/\s$/.test(text) && !/^\s/.test(r.text)) text += ' '
        text += r.text
        end = r.x + r.width
      }
      text = normalizeText(text).trim()
      const x = current[0]!.x
      const fontSize = Math.max(...current.map((r) => r.fontSize))
      if (text) lines.push({ text, x, y: current[0]!.y, width: end - x, fontSize })
      current = []
    }
    for (const r of row) {
      const last = current[current.length - 1]
      if (last && r.x - (last.x + last.width) > splitGap * r.fontSize) emit()
      current.push(r)
    }
    emit()
  }
  return lines
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)]! : 0
}

const sizeKey = (s: number) => Math.round(s * 2) / 2

/** Document-wide font statistics, so headings are classified the same way on every page. */
export interface TextStats {
  /** Most common font size, weighted by characters. */
  body: number
  /** Font sizes of heading lines (≥ 1.2 × body), largest first: index 0 = level 1. */
  headingSizes: number[]
}

export function textStats(pages: PageContent[]): TextStats {
  const chars = new Map<number, number>()
  for (const page of pages) {
    for (const r of page.runs) {
      const n = r.text.trim().length
      if (n && r.fontSize > 0) chars.set(sizeKey(r.fontSize), (chars.get(sizeKey(r.fontSize)) ?? 0) + n)
    }
  }
  const body = [...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  const headingSizes = [...chars.keys()].filter((s) => s >= body * 1.2).sort((a, b) => b - a)
  return { body, headingSizes }
}

/**
 * Lines -> paragraphs and headings. A paragraph breaks on a larger-than-usual line gap, a size change, a
 * first-line indent, or a table/diagram (`obstacles`, vertical ranges) between two lines.
 */
function textBlocks(runs: TextRun[], stats: TextStats, obstacles: Box[]): { top: number; block: Block }[] {
  const lines = groupLines(runs)
  if (!lines.length) return []
  const body = stats.body || median(lines.map((l) => l.fontSize))
  const isHeading = (l: Line) => stats.headingSizes.includes(sizeKey(l.fontSize))
  const level = (l: Line) => Math.min(3, stats.headingSizes.indexOf(sizeKey(l.fontSize)) + 1) as 1 | 2 | 3

  const bodyLines = lines.filter((l) => !isHeading(l))
  const deltas = bodyLines.slice(1).map((l, i) => l.y - bodyLines[i]!.y).filter((d) => d > 0)
  const leading = Math.min(Math.max(median(deltas) || body * 1.3, body), body * 1.8)
  const margin = Math.min(...bodyLines.map((l) => l.x), Infinity)
  const blocked = (a: Line, b: Line) => obstacles.some((o) => o.top >= a.y && o.bottom <= b.y - b.fontSize * 0.5)

  const out: { top: number; block: Block }[] = []
  let current: { lines: Line[]; heading: boolean } | undefined
  const flush = () => {
    if (!current) return
    const text = current.lines.map((l) => l.text).join(' ')
    const first = current.lines[0]!
    out.push({
      top: first.y - first.fontSize,
      block: current.heading ? { kind: 'heading', level: level(first), text } : { kind: 'paragraph', text },
    })
    current = undefined
  }

  for (const line of lines) {
    const heading = isHeading(line)
    const prev = current?.lines[current.lines.length - 1]
    const continues =
      current &&
      prev &&
      current.heading === heading &&
      sizeKey(prev.fontSize) === sizeKey(line.fontSize) &&
      line.y - prev.y <= (heading ? line.fontSize * 1.5 : leading * 1.4) &&
      !blocked(prev, line) &&
      // A first-line indent starts a new paragraph.
      !(!heading && line.x - margin > body * 1.5 && prev.x - margin <= body * 0.5)
    if (!continues) flush()
    current ??= { lines: [], heading }
    current.lines.push(line)
  }
  flush()
  return out
}
