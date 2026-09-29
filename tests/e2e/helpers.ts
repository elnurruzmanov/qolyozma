import { expect, type Page } from '@playwright/test'

export async function openPlayground(page: Page, params: Record<string, string | number>) {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  await page.goto(`/playground?${q}`)
  await expect(page.getByTestId('playground-canvas')).toHaveAttribute('data-ready', 'true')
}

/** Alpha channel of the playground canvas. */
export function canvasAlpha(page: Page): Promise<number[]> {
  return page.getByTestId('playground-canvas').evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    const alpha: number[] = []
    for (let i = 3; i < data.length; i += 4) alpha.push(data[i]!)
    return alpha
  })
}

/** Share of inked pixels (in either image) whose coverage differs strongly between the two renders. */
export function inkDifference(a: number[], b: number[]): number {
  let ink = 0
  let changed = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i]! > 64 || b[i]! > 64) {
      ink++
      if (Math.abs(a[i]! - b[i]!) > 128) changed++
    }
  }
  return ink ? changed / ink : 0
}

export interface InkBox {
  top: number
  bottom: number
  left: number
  right: number
  pixels: number
}

export async function inkBox(page: Page): Promise<InkBox> {
  return page.getByTestId('playground-canvas').evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    const box = { top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity, pixels: 0 }
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3]! > 96) {
          box.pixels++
          box.top = Math.min(box.top, y)
          box.bottom = Math.max(box.bottom, y)
          box.left = Math.min(box.left, x)
          box.right = Math.max(box.right, x)
        }
      }
    }
    return box
  })
}
