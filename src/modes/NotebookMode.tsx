import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { fontsForMode } from '../core/fonts'
import { A4, layoutNotebookSteps, type NotebookPage, type PaperKind } from '../core/layout/notebook'
import { plainText, type Document } from '../core/model'
import { parseText } from '../core/parse/text'
import { drawNotebookPage } from '../core/render/canvas'
import { hashString } from '../core/render/deform'
import { NATURALNESS_DEFAULT, NATURALNESS_MAX, WEIGHT_MAX } from '../core/render/glyphs'
import { ACCEPT, UnsupportedFileError, loadDocument } from '../ui/loadDocument'
import { loadFont } from '../ui/loadFont'

const SAMPLE = `# Mening kunim

Bugun ertalab barvaqt turdim. Oʻzbekiston — goʻzal yurt: bogʻlarda gʻoʻza ochildi, maʼno toʻla kun boshlandi.

Maktabga borib, ona tili va matematika darslarida qatnashdim. Ўзбекистон — гўзал юрт, Қишлоқда ҳаво тоза.`

const PAPERS: { id: PaperKind; label: string }[] = [
  { id: 'lined', label: 'Chiziqli' },
  { id: 'grid', label: 'Katakli' },
  { id: 'plain', label: 'Oddiy' },
]

const INKS = [
  { color: '#1e3a8a', label: 'Koʻk' },
  { color: '#1f2937', label: 'Qora' },
  { color: '#5b21b6', label: 'Binafsha' },
]

const WEIGHT_DEFAULT = 1

interface Source {
  /** File name, or undefined for typed text. */
  name?: string
  /** Distinguishes two files opened with the same name. */
  id: number
  doc: Document
}

interface Rendered {
  key: string
  pages: NotebookPage[]
  skippedImages: number
}

export default function NotebookMode() {
  const fonts = fontsForMode('notebook')
  const [text, setText] = useState(SAMPLE)
  const [file, setFile] = useState<Source>()
  const [busy, setBusy] = useState(false)
  const [fileError, setFileError] = useState<string>()
  const [renderError, setRenderError] = useState<string>()
  const opened = useRef(0)
  const [paper, setPaper] = useState<PaperKind>('lined')
  const [ink, setInk] = useState(INKS[0]!.color)
  const [fontId, setFontId] = useState(fonts[0]!.id)
  const [slant, setSlant] = useState(0)
  const [naturalness, setNaturalness] = useState(NATURALNESS_DEFAULT)
  const [weight, setWeight] = useState(WEIGHT_DEFAULT)
  const [redraw, setRedraw] = useState(0)
  const [layout, setLayout] = useState<Rendered>()
  const [dragging, setDragging] = useState(false)

  const typed = useMemo<Source>(() => ({ id: 0, doc: parseText(text) }), [text])
  const source = file ?? typed
  const font = fonts.find((f) => f.id === fontId) ?? fonts[0]!
  // Seed per document, so re-rendering is stable; "Redraw" moves to the next one.
  const seed = useMemo(() => hashString(plainText(source.doc)) + redraw, [source, redraw])
  const key = `${source.name ?? 'text'}#${source.id}:${seed}:${font.id}:${paper}:${slant}:${naturalness}:${weight}`

  useEffect(() => {
    let cancelled = false
    loadFont(font.file)
      .then(async (f) => {
        const steps = layoutNotebookSteps(source.doc, f, { paper, seed, connected: font.connected, naturalness, slantDeg: slant, weight })
        // Time-sliced: give the browser the main thread every ~12 ms, and drop the work if the input changed.
        let slice = performance.now()
        for (let step = steps.next(); !cancelled; step = steps.next()) {
          if (step.done) {
            setLayout({ key, ...step.value })
            setRenderError(undefined)
            return
          }
          if (performance.now() - slice > 12) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            slice = performance.now()
          }
        }
      })
      .catch((e: unknown) => !cancelled && setRenderError(String(e)))
    return () => {
      cancelled = true
    }
  }, [source, font, paper, seed, naturalness, slant, weight, key])

  const laidOut = !busy && layout?.key === key
  const drawKey = `${layout?.key}:${ink}`
  const [drawn, setDrawn] = useState({ key: '', pages: new Set<number>() })
  const ready = laidOut && drawn.key === drawKey && drawn.pages.size === (layout?.pages.length ?? 0)
  // Pages draw one per task (see PageCanvas); each reports back here.
  const onDrawn = (forKey: string, page: number) =>
    setDrawn((d) => (d.key === forKey ? { key: forKey, pages: new Set(d.pages).add(page) } : { key: forKey, pages: new Set([page]) }))

  async function open(f: File | undefined) {
    if (!f) return
    setBusy(true)
    setFileError(undefined)
    try {
      setFile({ name: f.name, id: ++opened.current, doc: await loadDocument(f) })
    } catch (e) {
      setFileError(
        e instanceof UnsupportedFileError
          ? `${f.name}: hozircha faqat PDF va matn (.txt) fayllari qoʻllab-quvvatlanadi.`
          : `${f.name} faylini oʻqib boʻlmadi.`,
      )
    } finally {
      setBusy(false)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void open(e.dataTransfer.files[0])
  }

  const pages = layout?.pages ?? []
  const count = (k: 'tables' | 'diagrams') => pages.reduce((n, p) => n + p[k], 0)

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed p-4 text-sm ${dragging ? 'border-blue-600 bg-blue-50' : 'border-slate-300'}`}
      >
        <label className="block">
          <span className="font-medium">PDF yoki matn fayli</span>
          <span className="block text-slate-500">Faylni shu yerga tashlang yoki tanlang. Fayl hech qayerga yuklanmaydi.</span>
          <input
            type="file"
            accept={ACCEPT}
            className="mt-2 block w-full text-sm"
            onChange={(e) => {
              void open(e.target.files?.[0])
              e.target.value = '' // the same file can be chosen again
            }}
          />
        </label>
        {file && (
          <p className="mt-2 flex items-center gap-2">
            <span className="truncate">{file.name}</span>
            <button type="button" className="text-blue-700 underline" onClick={() => setFile(undefined)}>
              Matnga qaytish
            </button>
          </p>
        )}
        {busy && <p className="mt-2 text-slate-500">Fayl oʻqilmoqda…</p>}
        {fileError && <p className="mt-2 text-red-600">{fileError}</p>}
      </div>

      {!file && (
        <label className="flex flex-col gap-1 text-sm">
          Matn
          <textarea className="min-h-28 rounded border p-2" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          Qogʻoz
          <select className="rounded border px-2 py-1" value={paper} onChange={(e) => setPaper(e.target.value as PaperKind)}>
            {PAPERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Shrift
          <select className="rounded border px-2 py-1" value={font.id} onChange={(e) => setFontId(e.target.value)}>
            {fonts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.family}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1">Siyoh</legend>
          <div className="flex items-center gap-2">
            {INKS.map((i) => (
              <button
                key={i.color}
                type="button"
                title={i.label}
                aria-label={`Siyoh: ${i.label}`}
                aria-pressed={ink === i.color}
                onClick={() => setInk(i.color)}
                className={`h-7 w-7 rounded-full border-2 ${ink === i.color ? 'border-slate-900' : 'border-white'}`}
                style={{ background: i.color }}
              />
            ))}
            <input type="color" aria-label="Siyoh rangi" className="h-7 w-9" value={ink} onChange={(e) => setInk(e.target.value)} />
          </div>
        </fieldset>
        <Slider label="Qiyalik" min={-10} max={10} value={slant} onChange={setSlant} unit="°" />
        <Slider label="Tabiiylik" min={0} max={NATURALNESS_MAX} value={naturalness} onChange={setNaturalness} />
        <Slider label="Qalinlik" min={0} max={WEIGHT_MAX} value={weight} onChange={setWeight} />
      </div>

      <div className="flex items-center gap-3 text-sm">
        <button type="button" className="rounded-md bg-slate-900 px-3 py-1.5 text-white" onClick={() => setRedraw((r) => r + 1)}>
          Qayta chizish
        </button>
        <span data-testid="notebook-page-count">{pages.length} bet</span>
        {!!layout?.skippedImages && (
          <span className="text-slate-500">{layout.skippedImages} ta rasm yoki skaner sahifa hozircha tushirib qoldirildi.</span>
        )}
      </div>

      {renderError && <p className="text-sm text-red-600">{renderError}</p>}

      <section
        aria-label="Daftar koʻrinishi"
        data-testid="notebook-preview"
        data-ready={ready}
        aria-busy={!ready}
        data-source={source.name ?? ''}
        data-pages={pages.length}
        data-tables={count('tables')}
        data-diagrams={count('diagrams')}
        className="flex flex-col items-center gap-4"
      >
        {pages.map((page, i) => (
          <PageCanvas key={i} page={page} ink={ink} number={i + 1} onDrawn={() => onDrawn(drawKey, i)} />
        ))}
      </section>
    </div>
  )
}

function Slider(props: { label: string; min: number; max: number; value: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span>
        {props.label}: <span className="tabular-nums">{props.value}{props.unit}</span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

/** One page, drawn at the width it is shown at (capped at A4 size) times the device pixel ratio. */
interface PageProps {
  page: NotebookPage
  ink: string
  number: number
  onDrawn: () => void
}

function PageCanvas({ page, ink, number, onDrawn }: PageProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [cssWidth, setCssWidth] = useState(0)

  useEffect(() => {
    const canvas = ref.current!
    const observer = new ResizeObserver(() => setCssWidth(canvas.clientWidth))
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  const reportDrawn = useRef(onDrawn)
  useEffect(() => {
    reportDrawn.current = onDrawn
  })

  useEffect(() => {
    // Each page in its own task, so a long document never blocks the main thread for all pages at once.
    const timer = setTimeout(() => {
      const canvas = ref.current!
      const width = cssWidth || Math.min(canvas.clientWidth, A4.width) || A4.width
      const scale = (width / A4.width) * Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(A4.width * scale)
      canvas.height = Math.round(A4.height * scale)
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      drawNotebookPage(ctx, page, ink)
      reportDrawn.current()
    })
    return () => clearTimeout(timer)
  }, [page, ink, cssWidth])

  return (
    <canvas
      ref={ref}
      data-testid="notebook-page"
      aria-label={`${number}-bet`}
      className="block w-full max-w-[794px] shadow-md"
      style={{ aspectRatio: `${A4.width} / ${A4.height}` }}
    />
  )
}
