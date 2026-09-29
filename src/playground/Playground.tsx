import { useEffect, useRef, useState } from 'react'
import { parse, type Font } from 'opentype.js'
import { FONTS } from '../core/fonts'
import { measureText, renderRun, type GlyphRun } from '../core/render/glyphs'
import { drawRuns } from '../core/render/canvas'

const SAMPLE =
  'Oʻzbekiston — goʻzal yurt. Bogʻlarda gʻoʻza ochildi, maʼno toʻla kun. ' +
  'Ўзбекистон — гўзал юрт. Қишлоқда ҳаво тоза, ғалла пишди. ' +
  'The quick brown fox jumps over the lazy dog.'

const FONT_SIZE = 32
const LINE_HEIGHT = 44
const PADDING = 16

const fontCache = new Map<string, Promise<Font>>()
function loadFont(file: string): Promise<Font> {
  let p = fontCache.get(file)
  if (!p) {
    p = fetch(`/fonts/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Font ${file}: HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => parse(buf))
    fontCache.set(file, p)
  }
  return p
}

function wrap(font: Font, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (line && measureText(font, next, FONT_SIZE) > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

export default function Playground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [fontId, setFontId] = useState(FONTS[0]!.id)
  const [seed, setSeed] = useState(1)
  const [error, setError] = useState<string>()
  const [renderedKey, setRenderedKey] = useState<string>()
  const [cssWidth, setCssWidth] = useState(0)
  const key = `${fontId}:${seed}:${cssWidth}`

  useEffect(() => {
    const box = canvasRef.current!.parentElement!
    const observer = new ResizeObserver(() => setCssWidth(box.clientWidth))
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (cssWidth === 0) return
    const info = FONTS.find((f) => f.id === fontId)!
    let cancelled = false
    loadFont(info.file)
      .then((font) => {
        const canvas = canvasRef.current
        if (cancelled || !canvas) return
        const lines = wrap(font, SAMPLE, cssWidth - PADDING * 2)
        const cssHeight = lines.length * LINE_HEIGHT + PADDING * 2
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.round(cssWidth * dpr)
        canvas.height = Math.round(cssHeight * dpr)
        canvas.style.height = `${cssHeight}px`

        const runs: GlyphRun[] = lines.map((text, i) =>
          renderRun(font, text, {
            x: PADDING,
            y: PADDING + FONT_SIZE + i * LINE_HEIGHT,
            fontSize: FONT_SIZE,
            seed,
            runIndex: i,
            connected: info.connected,
          }),
        )
        const ctx = canvas.getContext('2d')!
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, cssWidth, cssHeight)
        drawRuns(ctx, runs, '#1e3a8a')
        setError(undefined)
        setRenderedKey(`${info.id}:${seed}:${cssWidth}`)
      })
      .catch((e: unknown) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [fontId, seed, cssWidth])

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-semibold">Playground</h1>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-sm">
          Shrift{' '}
          <select
            className="rounded border px-2 py-1"
            value={fontId}
            onChange={(e) => setFontId(e.target.value)}
          >
            {FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.family}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white"
          onClick={() => setSeed((s) => s + 1)}
        >
          Qayta chizish
        </button>
        <span className="text-xs text-slate-500">seed: {seed}</span>
      </div>
      {error && <p className="text-red-600">{error}</p>}
      <div className="rounded border bg-white">
        <canvas
          ref={canvasRef}
          data-testid="playground-canvas"
          data-ready={renderedKey === key}
          aria-label="Qoʻlyozma namunasi"
          className="block w-full"
        />
      </div>
    </div>
  )
}
