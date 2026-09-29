/** Shared Document model. Every parser in core/parse returns this; modes never touch raw PDF/DOCX. */

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
  rows: string[][]
}

export interface Diagram {
  kind: 'diagram'
  /** SVG path data in document units. */
  paths: string[]
}

export interface Image {
  kind: 'image'
  src: string
  width: number
  height: number
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
        case 'image':
          return ''
      }
    })
    .filter(Boolean)
    .join('\n')
}
