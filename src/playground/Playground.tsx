import { useEffect, useRef, useState } from 'react'
import type { Font } from 'opentype.js'
import { FONTS, fontsForMode, type Mode } from '../core/fonts'
import {
  NATURALNESS_DEFAULT,
  NATURALNESS_MAX,
  measureText,
  renderRun,
  type GlyphRun,
} from '../core/render/glyphs'
import { drawRuns } from '../core/render/canvas'
import { loadFont } from '../ui/loadFont'

const SAMPLE =
  'Oʻzbekiston — goʻzal yurt. Bogʻlarda gʻoʻza ochildi, maʼno toʻla kun. ' +
  'Ўзбекистон — гўзал юрт. Қишлоқда ҳаво тоза, ғалла пишди. ' +
  'The quick brown fox jumps over the lazy dog.'

const MODES: { id: Mode; label: string }[] = [
  { id: 'notebook', label: 'Daftar' },
  { id: 'card', label: 'Otkritka' },
  { id: 'design', label: 'Dizayn' },
]

const FONT_SIZE = 32
const LINE_HEIGHT = 44
const PADDING = 16

function wrap(font: Font, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
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

/** Initial state from the query string, e.g. /playground?mode=card&font=pacifico&seed=3&n=7&text=Salom */
function readParams() {
  const q = new URLSearchParams(window.location.search)
  const mode = (MODES.find((m) => m.id === q.get('mode'))?.id ?? 'notebook') as Mode
  const n = Number(q.get('n'))
  return {
    mode,
    fontId: q.get('font') ?? fontsForMode(mode)[0]!.id,
    seed: Number(q.get('seed')) || 1,
    naturalness: q.has('n') && Number.isFinite(n) ? n : NATURALNESS_DEFAULT,
    text: q.get('text') ?? SAMPLE,
  }
}

export default function Playground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [initial] = useState(readParams)
  const [mode, setMode] = useState<Mode>(initial.mode)
  const [fontChoice, setFontChoice] = useState(initial.fontId)
  const [seed, setSeed] = useState(initial.seed)
  const [naturalness, setNaturalness] = useState(initial.naturalness)
  const [error, setError] = useState<string>()
  const [renderedKey, setRenderedKey] = useState<string>()
  const [cssWidth, setCssWidth] = useState(0)
  const text = initial.text

  const allowed = fontsForMode(mode)
  const info = allowed.find((f) => f.id === fontChoice) ?? allowed[0]!
  const key = `${info.id}:${seed}:${naturalness}:${cssWidth}`

  useEffect(() => {
    const box = canvasRef.current!.parentElement!
    const observer = new ResizeObserver(() => setCssWidth(box.clientWidth))
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (cssWidth === 0) return
    let cancelled = false
    loadFont(info.file)
      .then((font) => {
        const canvas = canvasRef.current
        if (cancelled || !canvas) return
        const lines = wrap(font, text, cssWidth - PADDING * 2)
        const cssHeight = lines.length * LINE_HEIGHT + PADDING * 2
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.round(cssWidth * dpr)
        canvas.height = Math.round(cssHeight * dpr)
        canvas.style.height = `${cssHeight}px`

        const runs: GlyphRun[] = lines.map((line, i) =>
          renderRun(font, line, {
            x: PADDING,
            y: PADDING + FONT_SIZE + i * LINE_HEIGHT,
            fontSize: FONT_SIZE,
            seed,
            runIndex: i,
            connected: info.connected,
            naturalness,
          }),
        )
        const ctx = canvas.getContext('2d')!
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, cssWidth, cssHeight)
        drawRuns(ctx, runs, '#1e3a8a')
        setError(undefined)
        setRenderedKey(`${info.id}:${seed}:${naturalness}:${cssWidth}`)
      })
      .catch((e: unknown) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [info, seed, naturalness, cssWidth, text])

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-semibold">Playground</h1>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="text-sm">
          Rejim{' '}
          <select className="rounded border px-2 py-1" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Shrift{' '}
          <select className="rounded border px-2 py-1" value={info.id} onChange={(e) => setFontChoice(e.target.value)}>
            {allowed.map((f) => (
              <option key={f.id} value={f.id}>
                {f.family}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Tabiiylik
          <input
            type="range"
            min={0}
            max={NATURALNESS_MAX}
            step={1}
            value={naturalness}
            onChange={(e) => setNaturalness(Number(e.target.value))}
          />
          <span className="w-5 tabular-nums">{naturalness}</span>
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
      <p className="mt-2 text-xs text-slate-500">
        {FONTS.length} ta shrift; bu rejimda {allowed.length} tasi mavjud.
      </p>
    </div>
  )
}
