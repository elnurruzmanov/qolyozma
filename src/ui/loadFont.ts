import type { Font } from 'opentype.js'
import { parseFontFile } from '../core/render/fontFile'

const cache = new Map<string, Promise<Font>>()

/** Fetch and parse a bundled font from /fonts, once per file. */
export function loadFont(file: string): Promise<Font> {
  let p = cache.get(file)
  if (!p) {
    p = fetch(`/fonts/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Font ${file}: HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then(parseFontFile)
    p.catch(() => cache.delete(file)) // let a later render retry after a network error
    cache.set(file, p)
  }
  return p
}
