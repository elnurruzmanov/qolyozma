import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { FONTS } from '../../src/core/fonts'
import { openPlayground } from './helpers'

// Pixel-exact baselines only mean something from one rasteriser: they are made and checked in the official
// Playwright Docker image (CI, `npm run e2e:docker`), which sets VISUAL=1. Update: `npm run e2e:update-snapshots`.
test.skip(!process.env.VISUAL, 'visual baselines come from the Playwright Docker image: run npm run e2e:docker')

for (const font of FONTS) {
  test(`playground: ${font.family}`, async ({ page }) => {
    await openPlayground(page, { mode: font.modes[0]!, font: font.id, seed: 3 })
    await expect(page.getByTestId('playground-canvas')).toHaveScreenshot(`playground-${font.id}.png`)
  })
}

for (const [file, paper] of [['text-only.pdf', 'plain'], ['table.pdf', 'lined'], ['diagram.pdf', 'grid']] as const) {
  test(`notebook: ${file} on ${paper} paper`, async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Qogʻoz').selectOption(paper)
    await page.getByLabel('PDF yoki matn fayli').setInputFiles(resolve(import.meta.dirname, '../fixtures', file))
    const preview = page.getByTestId('notebook-preview')
    await expect(preview).toHaveAttribute('data-source', file)
    await expect(preview).toHaveAttribute('data-ready', 'true')
    await expect(page.getByTestId('notebook-page').first()).toHaveScreenshot(`notebook-${file.replace('.pdf', '')}-${paper}.png`)
  })
}
