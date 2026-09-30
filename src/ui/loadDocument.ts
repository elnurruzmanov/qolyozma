import type { Document } from '../core/model'
import { parseText } from '../core/parse/text'

export class UnsupportedFileError extends Error {}

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
const isText = (file: File) => file.type.startsWith('text/') || /\.(txt|md)$/i.test(file.name)

/** Accepted by the file picker; must match what loadDocument can read. */
export const ACCEPT = '.pdf,.txt,.md,application/pdf,text/plain,text/markdown'

/**
 * Read a user's file into the Document model, entirely in the browser (nothing is uploaded). pdf.js and its
 * worker are loaded only when the first PDF is opened.
 */
export async function loadDocument(file: File): Promise<Document> {
  if (isPdf(file)) {
    const [pdfjs, { parsePdf }, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('../core/parse/pdf'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return parsePdf(await file.arrayBuffer(), { pdfjs })
  }
  if (isText(file)) return parseText(await file.text())
  throw new UnsupportedFileError(file.name)
}
