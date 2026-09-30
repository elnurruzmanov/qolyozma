# qolyozma
Handwriting-style generator for notes, cards and design

Text, PDF, DOCX and images → handwriting-style output. Everything runs in the browser; files are never uploaded.

## Getting started

```bash
npm install
npm run dev      # local dev server
npm run lint     # ESLint
npm run test     # Vitest unit tests
npm run e2e      # Playwright E2E (run `npx playwright install` once); visual snapshots are skipped here
npm run e2e:docker            # E2E incl. visual snapshots in the official Playwright image, as in CI (needs Docker)
npm run e2e:update-snapshots  # re-create the visual baselines in that image after an intended visual change
npm run build:fonts  # rebuild public/fonts/*.woff2 from fonts-src/*.ttf (needs uv)
```

## Stack

React 18 + TypeScript + Vite, Tailwind, Vitest, Playwright. CI on GitHub Actions, deployed to Vercel.
Visual baselines (`tests/e2e/*-snapshots`) are only made and checked in `mcr.microsoft.com/playwright`
at the pinned `@playwright/test` version, so they are pixel-identical in CI and on any developer machine.
Open `/playground` to try the renderer. Fonts: `public/fonts/LICENSES.md`.
`legacy/prototype.html` is the original single-file prototype, kept for reference only.

See `CLAUDE.md` for product rules and architecture.
