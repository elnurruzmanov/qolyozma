# Qolyozma — handwriting-style generator

Web app that turns text, PDF, DOCX and images into handwriting-style output.
Owner: Elnur (QA engineer, Uzbekistan). Goal: real users, real revenue, portfolio-grade code.

## Product

Three modes sharing one rendering core:

1. **Notebook** — PDF/DOCX/plain text → reflowed onto notebook paper (lined, grid, plain), tables and simple diagrams redrawn by hand.
2. **Card** — greeting cards and invitations from templates (wedding, birthday, new year, thank-you). User edits text, picks background and frame.
3. **Design** — text → transparent PNG / SVG for use in Canva, Photoshop, social posts.

Primary languages: Uzbek Latin (must render `oʻ gʻ ʼ sh ch ng` correctly), Uzbek/Russian Cyrillic, English.

## Hard rules (legal and positioning)

- **Never** build a feature that imitates a specific person's handwriting from an uploaded sample. Generating a font from the user's *own* filled-in template is allowed.
- **Never** write copy like "teacher won't notice", "undetectable", "we write your assignment". Allowed framing: "write your text in a beautiful handwritten style".
- Only OFL / Apache-2.0 fonts. Keep `/public/fonts/LICENSES.md` up to date and link it from the footer.
- All file processing happens in the browser. Files are never uploaded. Say so in the UI and privacy policy.

## Stack

- React 18 + TypeScript + Vite, deployed as static site (Vercel).
- `pdfjs-dist` (PDF text + vector paths), `mammoth` (DOCX → text/HTML), `tesseract.js` (OCR, **lazy-loaded** only when an image-only page is detected), `opentype.js` (glyph paths), `jspdf` (PDF export).
- Tailwind for UI. No UI kit unless needed.
- Tests: Vitest (unit), Playwright (E2E + visual snapshots). CI: GitHub Actions.
- No backend in v1. Payments come later behind a small serverless function.

## Architecture

```
src/
  core/
    parse/        pdf.ts, docx.ts, image.ts, text.ts  -> Document model
    model.ts      Block = Paragraph | Heading | Table | Diagram | Image
    layout/       notebook.ts, card.ts, design.ts     -> positioned glyph runs
    render/
      glyphs.ts   opentype.js glyph paths + per-glyph jitter (the key feature)
      strokes.ts  wobbly lines, boxes, arrows
      canvas.ts   draw to Canvas2D
    export/       pdf.ts, png.ts, svg.ts
  modes/          NotebookMode.tsx, CardMode.tsx, DesignMode.tsx
  ui/             shared components
  templates/      card templates as JSON + SVG assets
public/fonts/     built .woff2 subsets + LICENSES.md (never edit; run npm run build:fonts)
fonts-src/        pristine source .ttf files
legacy/prototype.html   working single-file prototype — reference only, do not import
tests/
  unit/  e2e/  fixtures/  (sample PDFs: text-only, tables, scanned, mixed)
```

## Rendering principle (why it looks handwritten)

Real handwriting never repeats a letter exactly. Load each outline with opentype.js, then apply seeded random distortion at three levels (amplitudes at the default "Tabiiylik" = 5; the 0–10 slider scales them all linearly, 0 = plain font):
- line: baseline slope ±0.8°
- word: baseline offset ±2px, spacing to the next word ±15%
- glyph: rotation ±3°, size ±4%, width ±5%, control points moved up to 3% of em, slight stroke-width (ink pressure) variation

Cursive fonts apply rotation/size/width per word so the font's connections stay intact. Seed is per document so re-rendering is stable, "Redraw" changes the seed. Values live in `JITTER` in `src/core/render/glyphs.ts`.

Fonts are built from `fonts-src/` into `public/fonts/` by `npm run build:fonts` (fontTools via uv); fixes to font files go there, never by hand.

## Conventions

- TypeScript strict. Pure functions in `core/`, no DOM access there except `render/canvas.ts`.
- Every parser returns the shared Document model — modes never touch raw PDF/DOCX.
- Performance budget: 10-page PDF renders in < 5 s on a mid-range laptop; UI never freezes (use `requestIdleCallback` / chunking, OCR in a worker).
- Mobile first layout; must work on a 380 px screen.
- UI language: Uzbek Latin by default, Russian and English switchable.

## Definition of done for any task

1. Code compiles with no TS errors, `npm run lint` clean.
2. Unit tests for new `core/` logic, E2E test for new user flow.
3. `npm run test` and `npm run e2e` green locally and in CI.
4. Short entry in `CHANGELOG.md`.
