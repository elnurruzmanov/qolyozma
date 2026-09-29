import { expect, test } from '@playwright/test'
import { DIACRITIC_PAIRS, FONTS } from '../../src/core/fonts'
import { canvasAlpha, inkBox, inkDifference, openPlayground } from './helpers'

/** Share of inked pixels that must change between two seeds at the default naturalness. */
const MIN_VISIBLE_CHANGE = 0.45

test('Redraw re-renders the sample with a clearly different hand', async ({ page }) => {
  await openPlayground(page, { seed: 10 })
  const before = await canvasAlpha(page)
  expect(before.some((a) => a > 0)).toBe(true)

  await page.getByRole('button', { name: 'Qayta chizish' }).click()
  await expect(page.getByText('seed: 11')).toBeVisible()
  await expect(page.getByTestId('playground-canvas')).toHaveAttribute('data-ready', 'true')
  expect(inkDifference(before, await canvasAlpha(page))).toBeGreaterThan(MIN_VISIBLE_CHANGE)
})

test('Tabiiylik slider at 0 draws the plain font, independent of the seed', async ({ page }) => {
  await openPlayground(page, { seed: 10, n: 0 })
  const a = await canvasAlpha(page)
  await page.getByRole('button', { name: 'Qayta chizish' }).click()
  await expect(page.getByText('seed: 11')).toBeVisible()
  await expect(page.getByTestId('playground-canvas')).toHaveAttribute('data-ready', 'true')
  expect(inkDifference(a, await canvasAlpha(page))).toBe(0)

  await page.getByRole('slider').fill('5')
  await expect(page.getByTestId('playground-canvas')).toHaveAttribute('data-ready', 'true')
  expect(inkDifference(a, await canvasAlpha(page))).toBeGreaterThan(MIN_VISIBLE_CHANGE)
})

test('font picker only offers the fonts allowed in the selected mode', async ({ page }) => {
  await openPlayground(page, {})
  const fontSelect = page.getByLabel('Shrift')
  await expect(fontSelect.locator('option', { hasText: 'Pacifico' })).toHaveCount(0)
  await page.getByLabel('Rejim').selectOption('card')
  await expect(fontSelect.locator('option', { hasText: 'Pacifico' })).toHaveCount(1)
  await fontSelect.selectOption('pacifico')
  await expect(page.getByTestId('playground-canvas')).toHaveAttribute('data-ready', 'true')
  await page.getByLabel('Rejim').selectOption('notebook')
  await expect(fontSelect).not.toHaveValue('pacifico')
})

test.describe('every font visibly varies between seeds', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop only: pixel measurements')

  for (const font of FONTS) {
    test(font.family, async ({ page }) => {
      const params = { mode: font.modes[0]!, font: font.id }
      await openPlayground(page, { ...params, seed: 10 })
      const a = await canvasAlpha(page)
      await openPlayground(page, { ...params, seed: 11 })
      expect(inkDifference(a, await canvasAlpha(page))).toBeGreaterThan(MIN_VISIBLE_CHANGE)
    })
  }
})

test.describe('Uzbek Cyrillic letters keep their diacritic', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop only: pixel measurements')

  for (const font of FONTS) {
    test(font.family, async ({ page }) => {
      const render = async (text: string) => {
        await openPlayground(page, { mode: font.modes[0]!, font: font.id, n: 0, text })
        return inkBox(page)
      }
      const em = 32 // playground font size in CSS px; desktop project has devicePixelRatio 1
      for (const [letter, base] of DIACRITIC_PAIRS) {
        const withMark = await render(letter)
        const plain = await render(base)
        const taller = plain.top - withMark.top
        const deeper = withMark.bottom - plain.bottom
        const message = `${font.family}: ${letter} vs ${base} ${JSON.stringify({ withMark, plain })}`
        if (letter === 'Ў') expect(taller, message).toBeGreaterThan(0.08 * em)
        else if (letter === 'Қ' || letter === 'Ҳ') expect(deeper, message).toBeGreaterThan(0.05 * em)
        else expect(withMark.pixels, message).toBeGreaterThan(plain.pixels * 1.05) // Ғ: crossbar adds ink
      }
    })
  }
})
