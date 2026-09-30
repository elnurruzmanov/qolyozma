/** Shared Document model. Every parser in core/parse returns this; modes never touch raw PDF/DOCX. */

export type Point = [number, number]

export interface Paragraph {
  kind: 'paragraph'
  text: string
}

export interface Heading {
  kind: 'heading'
  level: 1 | 2 | 3
  text: string
}

export interface Table {
  kind: 'table'
  /** Rows of cell texts, top to bottom, left to right. Merged cells appear once, in their first grid cell. */
  rows: string[][]
}

export interface DiagramShape {
  /** Polyline in diagram coordinates (pt, origin top-left, y down); curves are flattened. */
  points: Point[]
  closed: boolean
  stroked: boolean
  /** Filled shapes are e.g. arrowheads or solid markers. */
  filled: boolean
}

export interface DiagramLabel {
  text: string
  /** Baseline start, diagram coordinates. */
  x: number
  y: number
  /** Width of the original text, pt: a redrawn label is centred on the original. */
  width: number
  fontSize: number
}

export interface Diagram {
  kind: 'diagram'
  /** Size of the diagram's bounding box in pt. */
  width: number
  height: number
  shapes: DiagramShape[]
  labels: DiagramLabel[]
}

export interface Image {
  kind: 'image'
  width: number
  height: number
  /** Image data URL or object URL, when the parser has the pixels. */
  src?: string
  /** 1-based PDF page with no text layer (a scan): needs rasterising + OCR. */
  page?: number
}

export type Block = Paragraph | Heading | Table | Diagram | Image

export interface Document {
  blocks: Block[]
}

export function plainText(doc: Document): string {
  return doc.blocks
    .map((b) => {
      switch (b.kind) {
        case 'paragraph':
        case 'heading':
          return b.text
        case 'table':
          return b.rows.map((r) => r.join('\t')).join('\n')
        case 'diagram':
          return b.labels.map((l) => l.text).join('\n')
        case 'image':
          return ''
      }
    })
    .filter(Boolean)
    .join('\n')
}
