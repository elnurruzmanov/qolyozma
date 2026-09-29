import type { Block, Document } from '../model'

/**
 * Normalise extracted or typed text: NFC (so "у" + U+0306 becomes "ў"), line endings, BOM, no-break and
 * zero-width spaces, soft hyphens. Keeps line breaks; collapses runs of spaces/tabs within a line.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00AD|\u200B|\u200C|\u200D|\u2060/g, '')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000\t]/g, ' ')
    .replace(/ {2,}/g, ' ')
}

const HEADING = /^(#{1,3})\s+(.+?)\s*#*$/
const LIST_ITEM = /^(?:[-*•–]\s+|\d{1,3}[.)]\s+|[a-zа-я][.)]\s+)/iu

/**
 * Plain text -> Document. Blank lines separate paragraphs; lines inside a paragraph are soft-wrapped and
 * joined with a space. Markdown-style "#", "##", "###" lines become headings; list items ("- ", "1. ",
 * "a) ") start their own paragraph so they are not glued to the previous line.
 */
export function parseText(text: string): Document {
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', text: para.join(' ') })
    para = []
  }

  for (const raw of normalizeText(text).split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! })
      continue
    }
    if (LIST_ITEM.test(line)) flush()
    para.push(line)
  }
  flush()
  return { blocks }
}
