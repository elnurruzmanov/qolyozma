// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

it('CI runs E2E in the Playwright image that matches the pinned @playwright/test', () => {
  const pinned = JSON.parse(read('package.json')).devDependencies['@playwright/test']
  const locked = JSON.parse(read('package-lock.json')).packages['node_modules/@playwright/test'].version
  const image = /mcr\.microsoft\.com\/playwright:v([\d.]+)-noble/.exec(read('.github/workflows/ci.yml'))?.[1]
  // Exact pin: a caret range could install a newer Playwright whose browsers differ from the image's.
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)
  expect([locked, image]).toEqual([pinned, pinned])
})
