import { expect, test } from '@playwright/test'

test('playground renders a sample and Redraw changes it', async ({ page }) => {
  await page.goto('/playground')
  const canvas = page.getByTestId('playground-canvas')
  await expect(canvas).toHaveAttribute('data-ready', 'true')

  const snapshot = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())
  const blank = await canvas.evaluate((c: HTMLCanvasElement) => {
    const empty = document.createElement('canvas')
    empty.width = c.width
    empty.height = c.height
    return empty.toDataURL()
  })
  const before = await snapshot()
  expect(before).not.toBe(blank)

  await page.getByRole('button', { name: 'Qayta chizish' }).click()
  await expect(page.getByText('seed: 2')).toBeVisible()
  await expect(canvas).toHaveAttribute('data-ready', 'true')
  await expect.poll(snapshot).not.toBe(before)
})
