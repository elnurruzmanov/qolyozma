import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const FIXTURES = resolve(import.meta.dirname, '../fixtures')

async function upload(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByLabel('PDF yoki matn fayli').setInputFiles(typeof file === 'string' ? resolve(FIXTURES, file) : file)
  const name = typeof file === 'string' ? file : file.name
  const preview = page.getByTestId('notebook-preview')
  await expect(preview).toHaveAttribute('data-source', name)
  await expect(preview).toHaveAttribute('data-ready', 'true')
  return preview
}

/** Share of the page canvas covered by ink (dark pixels), ignoring the pale paper and its rules. */
function inkShare(page: Page, index = 0): Promise<number> {
  return page
    .getByTestId('notebook-page')
    .nth(index)
    .evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let ink = 0
      for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! < 400) ink++
      return ink / (d.length / 4)
    })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('notebook-preview')).toHaveAttribute('data-ready', 'true')
})

const CASES = [
  { file: 'text-only.pdf', pages: 1, tables: 0, diagrams: 0 },
  { file: 'table.pdf', pages: 1, tables: 2, diagrams: 0 },
  { file: 'diagram.pdf', pages: 1, diagrams: 1, tables: 0 },
]

for (const c of CASES) {
  test(`${c.file}: ${c.pages} page(s), ${c.tables} table(s), ${c.diagrams} diagram(s)`, async ({ page }) => {
    const preview = await upload(page, c.file)
    await expect(preview).toHaveAttribute('data-pages', String(c.pages))
    await expect(page.getByTestId('notebook-page')).toHaveCount(c.pages)
    await expect(page.getByTestId('notebook-page-count')).toHaveText(`${c.pages} bet`)
    await expect(preview).toHaveAttribute('data-tables', String(c.tables))
    await expect(preview).toHaveAttribute('data-diagrams', String(c.diagrams))
    expect(await inkShare(page)).toBeGreaterThan(0.002)
  })
}

test('a table is drawn on the page: more ink than the same text without borders', async ({ page }) => {
  await upload(page, 'table.pdf')
  const withTable = await inkShare(page)
  // The same cell texts as plain paragraphs.
  const text = ['Dars jadvali', 'Kun Fan Xona', 'Dushanba Ona tili 12', 'Seshanba Matematika 7', 'Chorshanba Tarix 3',
    'Jadvaldan keyingi matn.', 'Ikkinchi jadval', 'Ism Baho', 'Aziza 5', 'Gʻayrat 4'].join('\n\n')
  await upload(page, { name: 'cells.txt', mimeType: 'text/plain', buffer: Buffer.from(text) })
  expect(withTable).toBeGreaterThan((await inkShare(page)) * 1.1)
})

test('long text flows onto several pages', async ({ page }) => {
  const paragraph = 'Bugun ertalab barvaqt turdim va maktabga bordim. Oʻzbekiston — goʻzal yurt, bogʻlarda gʻoʻza ochildi. '
  const text = Array.from({ length: 40 }, () => paragraph.repeat(2)).join('\n\n')
  const preview = await upload(page, { name: 'uzun.txt', mimeType: 'text/plain', buffer: Buffer.from(text) })
  const pages = Number(await preview.getAttribute('data-pages'))
  expect(pages).toBeGreaterThan(2)
  await expect(page.getByTestId('notebook-page')).toHaveCount(pages)
  expect(await inkShare(page, pages - 1)).toBeGreaterThan(0)
})

test('controls re-render the preview; only notebook fonts are offered', async ({ page }) => {
  const preview = await upload(page, 'table.pdf')
  await expect(page.getByLabel('Shrift').locator('option', { hasText: 'Pacifico' })).toHaveCount(0)
  const before = await inkShare(page)
  for (const [label, value] of [['Qogʻoz', 'grid'], ['Shrift', 'badscript']] as const) {
    await page.getByLabel(label).selectOption(value)
    await expect(preview).toHaveAttribute('data-ready', 'true')
    await expect(preview).toHaveAttribute('data-tables', '2')
  }
  await page.getByLabel('Qalinlik').fill('5')
  await expect(preview).toHaveAttribute('data-ready', 'true')
  expect(await inkShare(page)).toBeGreaterThan(before)
  await page.getByRole('button', { name: 'Siyoh: Qora' }).click()
  await page.getByRole('button', { name: 'Qayta chizish' }).click()
  await expect(preview).toHaveAttribute('data-ready', 'true')
})

test('unsupported files get a clear message and keep the current document', async ({ page }) => {
  await upload(page, 'table.pdf')
  await page.getByLabel('PDF yoki matn fayli').setInputFiles({ name: 'rasm.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50]) })
  await expect(page.getByText('hozircha faqat PDF va matn')).toBeVisible()
  await expect(page.getByTestId('notebook-preview')).toHaveAttribute('data-source', 'table.pdf')
})
