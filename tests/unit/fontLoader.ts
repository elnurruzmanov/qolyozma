import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse, type Font } from 'opentype.js'

export const FONTS_DIR = resolve(__dirname, '../../public/fonts')

export function loadFontFile(file: string): Font {
  const buf = readFileSync(resolve(FONTS_DIR, file))
  return parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}
