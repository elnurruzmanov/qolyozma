# Changelog

## Unreleased

- `core/render/glyphs.ts`: opentype.js glyph outlines with seeded per-glyph jitter (control points 0.5–2% em, rotation ±1.5°, baseline ±1px, advance ±3%); cursive fonts jitter per word so joins stay closed. `render/canvas.ts` draws the result.
- Bundled OFL fonts: Caveat, Playpen Sans, Bad Script, Pacifico, with `LICENSES.md` and license texts. U+02BB (ʻ) falls back to U+2018 in fonts that lack it.
- Unit test that fails if any bundled font cannot draw oʻ gʻ ʼ Ў ў Ғ ғ Қ қ Ҳ ҳ.
- `/playground` route: sample paragraph, font picker and Redraw button.
- Project scaffold: Vite + React 18 + TypeScript + Tailwind, Vitest, Playwright, ESLint, GitHub Actions CI, Vercel config.
- Merged with the existing GitHub repo; moved `prototype.html` to `legacy/prototype.html` (reference only).
