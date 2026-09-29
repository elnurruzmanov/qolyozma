/** Bundled handwriting fonts. Files live in public/fonts; every entry must be listed in LICENSES.md. */

export interface FontInfo {
  id: string
  family: string
  file: string
  /** Cursive font whose letters join inside a word: jitter per word so connections stay intact. */
  connected: boolean
}

export const FONTS: readonly FontInfo[] = [
  { id: 'caveat', family: 'Caveat', file: 'Caveat-Variable.ttf', connected: false },
  { id: 'playpen', family: 'Playpen Sans', file: 'PlaypenSans-Variable.ttf', connected: false },
  { id: 'badscript', family: 'Bad Script', file: 'BadScript-Regular.ttf', connected: true },
  { id: 'pacifico', family: 'Pacifico', file: 'Pacifico-Regular.ttf', connected: true },
]

/** Characters every bundled font must be able to draw (Uzbek Latin + Uzbek Cyrillic specifics). */
export const REQUIRED_CHARS = ['o', 'ʻ', 'g', 'ʼ', 'Ў', 'ў', 'Ғ', 'ғ', 'Қ', 'қ', 'Ҳ', 'ҳ'] as const
