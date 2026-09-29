// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FONTS, REQUIRED_CHARS, fontsForMode, type Mode } from '../../src/core/fonts'
import { measureText } from '../../src/core/render/glyphs'
import { FONTS_DIR, loadFontFile } from './fontLoader'

const codepoint = (c: string) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`

describe.each(FONTS)('$family', (info) => {
  const font = loadFontFile(info.file)

  it.each(REQUIRED_CHARS.map((c) => [c, codepoint(c)]))('has a glyph for %s (%s)', (ch) => {
    expect(font.charToGlyphIndex(ch), `${info.file} has no glyph for ${ch}`).not.toBe(0)
  })

  it('shapes mixed Uzbek text with opentype.js without errors', () => {
    expect(() => font.stringToGlyphs('Oʻzbekiston goʻzal maʼno. Ўзбекистон Қ Ҳ Ғ fi')).not.toThrow()
  })

  it.each(['ʻ', 'ʼ'])('keeps %s tight: no wide gap around the modifier letter', (mark) => {
    const size = 100
    const [glyph] = font.stringToGlyphs(mark)
    glyph!.getPath(0, 0, size, undefined, font) // resolves lazy metrics
    const box = glyph!.getBoundingBox()
    const lsb = (box.x1 / font.unitsPerEm) * size
    const rsb = ((glyph!.advanceWidth! - box.x2) / font.unitsPerEm) * size
    expect(lsb, 'left bearing').toBeLessThanOrEqual(8)
    expect(rsb, 'right bearing').toBeGreaterThanOrEqual(-1)
    expect(measureText(font, `o${mark}`, size) - measureText(font, 'o', size)).toBeLessThan(0.35 * size)
  })
})

describe('font modes', () => {
  const ids = (mode: Mode) => fontsForMode(mode).map((f) => f.id)

  it('every font is allowed in at least one mode', () => {
    for (const f of FONTS) expect(f.modes.length).toBeGreaterThan(0)
  })

  it('Pacifico is decorative: Card and Design only', () => {
    expect(ids('notebook')).not.toContain('pacifico')
    expect(ids('card')).toContain('pacifico')
    expect(ids('design')).toContain('pacifico')
  })

  it('Notebook has at least three fonts', () => {
    expect(ids('notebook').length).toBeGreaterThanOrEqual(3)
  })
})

describe('font folder', () => {
  const files = readdirSync(FONTS_DIR).filter((f) => /\.(ttf|otf|woff2?)$/.test(f))
  const sources = readdirSync(resolve(FONTS_DIR, '../../fonts-src')).filter((f) => f.endsWith('.ttf'))
  const licenses = readFileSync(resolve(FONTS_DIR, 'LICENSES.md'), 'utf8')

  it('every font file is registered in FONTS', () => {
    expect([...files].sort()).toEqual(FONTS.map((f) => f.file).sort())
  })

  it('every built font has a pristine source in fonts-src', () => {
    expect([...sources].sort()).toEqual([...files].sort())
  })

  it.each(files)('%s is listed in LICENSES.md with a license file', (file) => {
    const row = licenses.split('\n').find((l) => l.includes(`\`${file}\``))
    expect(row, `${file} missing from LICENSES.md`).toBeDefined()
    const licenseFile = /\]\((licenses\/[^)]+)\)/.exec(row!)?.[1]
    expect(licenseFile).toBeDefined()
    expect(readFileSync(resolve(FONTS_DIR, licenseFile!), 'utf8')).toMatch(/SIL Open Font License|Apache License/)
  })
})
