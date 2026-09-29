# qolyozma
Handwriting-style generator for notes, cards and design

Text, PDF, DOCX and images → handwriting-style output. Everything runs in the browser; files are never uploaded.

## Getting started

```bash
npm install
npm run dev      # local dev server
npm run lint     # ESLint
npm run test     # Vitest unit tests
npm run e2e      # Playwright E2E (run `npx playwright install` once)
```

## Stack

React 18 + TypeScript + Vite, Tailwind, Vitest, Playwright. CI on GitHub Actions, deployed to Vercel.
`legacy/prototype.html` is the original single-file prototype, kept for reference only.

See `CLAUDE.md` for product rules and architecture.
