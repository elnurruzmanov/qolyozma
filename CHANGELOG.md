# Changelog

## Unreleased

- Fixtures: `make-fixtures.mjs` now writes the PDF creation date as a fixed string, so regenerated PDFs are byte-identical in every timezone (a `Date` was formatted in local time).
- Parsing (session 3): `core/parse/pdf.ts` (pdf.js legacy build: text runs, vector paths, images per page) + `core/parse/pdfLayout.ts` (pure analysis: tables from ruled grids incl. hairline-rectangle borders, diagrams from clustered shapes with labels, paragraphs/headings with document-wide font statistics, scanned pages flagged for OCR) + `core/parse/text.ts` (plain text, NFC and whitespace normalisation). Document model extended for diagrams (shapes, labels) and scanned pages. Deterministic PDF fixtures from `scripts/make-fixtures.mjs` (`npm run fixtures`).
- Caveat ships as a static instance too (164 -> 97 KB). Bad Script: ʻ ’ moved left so the mark sits between letters, not over the next ascender; test checks marks never hang over a following l/b/h/k.
- Smooth deformation instead of per-point jitter: per-glyph affine (rotation, size, width, new shear) plus one low-frequency displacement field, so edges and stroke width stay clean. "Tabiiylik" rescaled: 10 = 1.6× the default instead of 2×. Unit test compares perimeter and mean turning angle of every deformed glyph with the original, with a negative control.
- Font build: ʻ ʼ ‘ ’ fitted at the mark’s own height (fixes "Bogʻ larda", "toʻ la" in Bad Script and Caveat; slanted O/G no longer cover the mark). Test measures the gap to following and preceding letters in every font.
- Playpen Sans and Shantell Sans ship as static instances at their axis defaults (outlines unchanged): Playpen 484 -> 194 KB, Shantell 396 -> 95 KB WOFF2; all fonts 1,159 -> 568 KB. Weight is varied by the renderer via stroke width, not font axes.
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
