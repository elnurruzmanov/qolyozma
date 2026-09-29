import { expect, test } from '@playwright/test'

test('home page opens', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Qolyozma')
  await expect(page.getByRole('heading', { name: 'Qolyozma' })).toBeVisible()
})
