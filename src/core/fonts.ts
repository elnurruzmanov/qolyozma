/** Bundled handwriting fonts. Built into public/fonts by scripts/build-fonts.py; each must be listed in LICENSES.md. */

export type Mode = 'notebook' | 'card' | 'design'

export interface FontInfo {
  id: string
  family: string
  file: string
  /** Cursive font whose letters join inside a word: jitter per word so connections stay intact. */
  connected: boolean
  /** Modes the font is allowed in. Notebook needs fonts that stay legible at small sizes. */
  modes: readonly Mode[]
}

const ALL: readonly Mode[] = ['notebook', 'card', 'design']

export const FONTS: readonly FontInfo[] = [
  { id: 'caveat', family: 'Caveat', file: 'Caveat-Regular.woff2', connected: false, modes: ALL },
  { id: 'shantell', family: 'Shantell Sans', file: 'ShantellSans-Regular.woff2', connected: false, modes: ALL },
  { id: 'playpen', family: 'Playpen Sans', file: 'PlaypenSans-Regular.woff2', connected: false, modes: ALL },
  { id: 'badscript', family: 'Bad Script', file: 'BadScript-Regular.woff2', connected: true, modes: ALL },
  // Decorative: its "z" reads like "r" at small sizes.
  { id: 'pacifico', family: 'Pacifico', file: 'Pacifico-Regular.woff2', connected: true, modes: ['card', 'design'] },
]

export function fontsForMode(mode: Mode): FontInfo[] {
  return FONTS.filter((f) => f.modes.includes(mode))
}

/** Characters every bundled font must map natively (Uzbek Latin + Uzbek Cyrillic specifics). */
export const REQUIRED_CHARS = ['o', 'ʻ', 'g', 'ʼ', 'Ў', 'ў', 'Ғ', 'ғ', 'Қ', 'қ', 'Ҳ', 'ҳ'] as const

/** Letters with a diacritic and the base letter they must visibly differ from. */
export const DIACRITIC_PAIRS = [
  ['Ў', 'У'],
  ['Ғ', 'Г'],
  ['Қ', 'К'],
  ['Ҳ', 'Х'],
] as const
