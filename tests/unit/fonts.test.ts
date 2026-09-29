// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FONTS, REQUIRED_CHARS, fontsForMode, type Mode } from '../../src/core/fonts'
import { renderRun } from '../../src/core/render/glyphs'
import { FONTS_DIR, loadFontFile } from './fontLoader'
import { flatten, type Point } from './geometry'

const fonts = new Map(await Promise.all(FONTS.map(async (f) => [f.id, await loadFontFile(f.file)] as const)))

/** Must survive subsetting: Latin-1/Latin-ext, Cyrillic, punctuation used in Uzbek, Russian and English text. */
const SUBSET_SAMPLE = [
  ...'AZaz09ÀÉÖÜßàéöüçğışŞİ',
  ...'АЯаяЁёЙйЩщЪъЫыЭэ',
  ...`.,:;!?()[]"'-–—…«»“”„‘’№%&@#€`,
]

const codepoint = (c: string) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`

describe.each(FONTS)('$family', (info) => {
  const font = fonts.get(info.id)!

  it.each(REQUIRED_CHARS.map((c) => [c, codepoint(c)]))('has a glyph for %s (%s)', (ch) => {
    expect(font.charToGlyphIndex(ch), `${info.file} has no glyph for ${ch}`).not.toBe(0)
  })

  it('is a WOFF2 file', () => {
    expect(info.file).toMatch(/\.woff2$/)
    expect(readFileSync(resolve(FONTS_DIR, info.file)).subarray(0, 4).toString('latin1')).toBe('wOF2')
  })

  it('keeps Latin-ext, Cyrillic and punctuation after subsetting', () => {
    const missing = SUBSET_SAMPLE.filter((ch) => font.charToGlyphIndex(ch) === 0)
    expect(missing, `${info.file} lost: ${missing.join(' ')}`).toEqual([])
  })

  it('shapes mixed Uzbek text with opentype.js without errors', () => {
    expect(() => font.stringToGlyphs('Oʻzbekiston goʻzal maʼno. Ўзбекистон Қ Ҳ Ғ fi')).not.toThrow()
  })

  describe.each(['ʻ', 'ʼ'])('spacing around %s, measured at the mark’s own height', (mark) => {
    // Gap between the mark's ink and a neighbour's ink inside the mark's vertical band, in em. In slanted fonts
    // the bounding boxes look fine while the ascender of "l" leans away ("Bogʻ larda") — hence the band.
    const EM = 100
    const layout = (text: string) =>
      renderRun(font, text, { x: 0, y: 0, fontSize: EM, seed: 1, naturalness: 0 }).glyphs.map((g) =>
        flatten(g.commands).flat(),
      )
    const bandGap = (left: Point[], right: Point[], band: Point[]) => {
      const lo = Math.min(...band.map((p) => p[1]))
      const hi = Math.max(...band.map((p) => p[1]))
      const inBand = (pts: Point[]) => pts.filter((p) => p[1] >= lo && p[1] <= hi).map((p) => p[0])
      const l = inBand(left)
      const r = inBand(right)
      return l.length && r.length ? (Math.min(...r) - Math.max(...l)) / EM : undefined
    }

    it('the next ascender ("l") is not pushed away', () => {
      const [m, l] = layout(`${mark}l`)
      expect(bandGap(m!, l!, m!)).toBeLessThanOrEqual(0.13)
    })

    it.each([...'lazonrmbdhkt'])('does not collide with a following "%s"', (next) => {
      const [m, n] = layout(`${mark}${next}`)
      const gap = bandGap(m!, n!, m!)
      if (gap !== undefined) expect(gap).toBeGreaterThanOrEqual(0.03)
    })

    it.each([...'ogOG'])('does not collide with a preceding "%s"', (prev) => {
      const [p, m] = layout(`${prev}${mark}`)
      const gap = bandGap(p!, m!, m!)
      if (gap !== undefined) expect(gap).toBeGreaterThanOrEqual(0.03)
    })
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
    // Static instances of variable sources are renamed *-Variable -> *-Regular by the build.
    const family = (f: string) => f.replace(/-(Variable|Regular)\.(ttf|woff2)$/, '')
    expect(sources.map(family).sort()).toEqual(files.map(family).sort())
  })

  it.each(files)('%s is listed in LICENSES.md with a license file', (file) => {
    const row = licenses.split('\n').find((l) => l.includes(`\`${file}\``))
    expect(row, `${file} missing from LICENSES.md`).toBeDefined()
    const licenseFile = /\]\((licenses\/[^)]+)\)/.exec(row!)?.[1]
    expect(licenseFile).toBeDefined()
    expect(readFileSync(resolve(FONTS_DIR, licenseFile!), 'utf8')).toMatch(/SIL Open Font License|Apache License/)
  })
})
