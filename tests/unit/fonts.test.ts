// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FONTS, REQUIRED_CHARS } from '../../src/core/fonts'
import { resolveChar } from '../../src/core/render/glyphs'
import { FONTS_DIR, loadFontFile } from './fontLoader'

const codepoint = (c: string) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`

describe.each(FONTS)('$family', (info) => {
  const font = loadFontFile(info.file)

  it.each(REQUIRED_CHARS.map((c) => [c, codepoint(c)]))('draws %s (%s)', (ch) => {
    expect(resolveChar(font, ch), `${info.file} has no glyph for ${ch}`).not.toBe(0)
  })
})

describe('font folder', () => {
  const files = readdirSync(FONTS_DIR).filter((f) => /\.(ttf|otf|woff2?)$/.test(f))
  const licenses = readFileSync(resolve(FONTS_DIR, 'LICENSES.md'), 'utf8')

  it('every font file is registered in FONTS', () => {
    expect(files.sort()).toEqual(FONTS.map((f) => f.file).sort())
  })

  it.each(files)('%s is listed in LICENSES.md with a license file', (file) => {
    expect(licenses).toContain(`\`${file}\``)
    const row = licenses.split('\n').find((l) => l.includes(`\`${file}\``))!
    const licenseFile = /\]\((licenses\/[^)]+)\)/.exec(row)?.[1]
    expect(licenseFile).toBeDefined()
    expect(readFileSync(resolve(FONTS_DIR, licenseFile!), 'utf8')).toMatch(/SIL Open Font License|Apache License/)
  })
})
