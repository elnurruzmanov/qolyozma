import { useState } from 'react'
import NotebookMode from './modes/NotebookMode'
import CardMode from './modes/CardMode'
import DesignMode from './modes/DesignMode'

const MODES = [
  { id: 'notebook', label: 'Daftar', Component: NotebookMode },
  { id: 'card', label: 'Otkritka', Component: CardMode },
  { id: 'design', label: 'Dizayn', Component: DesignMode },
] as const

type ModeId = (typeof MODES)[number]['id']

export default function App() {
  const [mode, setMode] = useState<ModeId>('notebook')
  const Active = MODES.find((m) => m.id === mode)!.Component

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-6">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">Qolyozma</h1>
        <p className="mt-1 text-slate-600">
          Matningizni chiroyli qoʻlyozma uslubida yozing.
        </p>
      </header>

      <nav className="mb-6 flex gap-2" aria-label="Rejimlar">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            aria-pressed={mode === m.id}
            className={`rounded-md px-3 py-1.5 text-sm ${
              mode === m.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            {m.label}
          </button>
        ))}
      </nav>

      <main className="flex-1">
        <Active />
      </main>

      <footer className="mt-10 border-t pt-4 text-xs text-slate-500">
        Fayllaringiz brauzeringizda qayta ishlanadi va hech qayerga yuklanmaydi. ·{' '}
        <a className="underline" href="/fonts/LICENSES.md">
          Shrift litsenziyalari
        </a>
      </footer>
    </div>
  )
}
