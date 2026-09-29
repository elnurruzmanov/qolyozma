# Changelog

## Unreleased

- Fonts ship as WOFF2 subsets (Latin, Latin-ext, Cyrillic incl. Uzbek, punctuation): 3,681 KB of TTF -> 1,159 KB. opentype.js cannot read WOFF2, so `core/render/fontFile.ts` decompresses it with `woff2-encoder` (WASM, lazy-loaded chunk, 128 KB gzip).
- Visible, readable variation: line slope, per-word baseline and spacing, per-glyph rotation/size/width, control-point jitter up to 3% em and ink-pressure stroke. New "Tabiiylik" slider (0–10, default 5) scales all of it.
- Font build pipeline (`npm run build:fonts`, fontTools): adds U+02BB where missing, fixes wide side bearings on ʻ ʼ ‘ ’, rebuilds Bad Script Ў with its missing breve, unhooks Shantell Sans ccmp that opentype.js cannot run. Pristine sources in `fonts-src/`.
- Fonts are tagged with the modes they are allowed in; Pacifico is Card/Design only. Added Shantell Sans for Notebook.
- Playground: mode picker filters fonts, query params (`mode`, `font`, `seed`, `n`, `text`).
- Tests: strict glyph coverage, ʻ/ʼ spacing, jitter ranges per naturalness, E2E pixel-difference threshold per font, visual diacritic check for Ў Ғ Қ Ҳ in every font.
- `core/render/glyphs.ts`: opentype.js glyph outlines with seeded per-glyph jitter (control points 0.5–2% em, rotation ±1.5°, baseline ±1px, advance ±3%); cursive fonts jitter per word so joins stay closed. `render/canvas.ts` draws the result.
- Bundled OFL fonts: Caveat, Playpen Sans, Bad Script, Pacifico, with `LICENSES.md` and license texts.
- Unit test that fails if any bundled font cannot draw oʻ gʻ ʼ Ў ў Ғ ғ Қ қ Ҳ ҳ.
- `/playground` route: sample paragraph, font picker and Redraw button.
- Project scaffold: Vite + React 18 + TypeScript + Tailwind, Vitest, Playwright, ESLint, GitHub Actions CI, Vercel config.
- Merged with the existing GitHub repo; moved `prototype.html` to `legacy/prototype.html` (reference only).
