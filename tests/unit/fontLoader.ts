import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Font } from 'opentype.js'
import { parseFontFile } from '../../src/core/render/fontFile'

export const FONTS_DIR = resolve(__dirname, '../../public/fonts')

export function loadFontFile(file: string): Promise<Font> {
  return parseFontFile(readFileSync(resolve(FONTS_DIR, file)))
}
