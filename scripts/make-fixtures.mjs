// Generates the PDF fixtures in tests/fixtures with jsPDF. Run: npm run fixtures
// Output is deterministic (fixed creation date and file id), so re-running only changes files when this script does.
//
// Font: tests/fixtures/fonts/PlaypenSans-fixture.ttf — Playpen Sans (OFL-1.1, see PlaypenSans-OFL.txt), static
// wght=400, subset to Latin, Cyrillic and ʻ ʼ so the text layer carries real Uzbek characters. Rebuild with:
//   fonttools varLib.instancer fonts-src/PlaypenSans-Variable.ttf wght=400 -o static.ttf
//   pyftsubset static.ttf --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+02BB-02BC,U+0400-04FF,U+2010-2026" \
//     --no-hinting --layout-features='' --output-file=tests/fixtures/fonts/PlaypenSans-fixture.ttf
import { readFileSync, writeFileSync } from 'node:fs'
import { jsPDF } from 'jspdf'

const DIR = new URL('../tests/fixtures/', import.meta.url)
const FONT = readFileSync(new URL('fonts/PlaypenSans-fixture.ttf', DIR)).toString('base64')
const MARGIN = 56
const WIDTH = 595.28 - 2 * MARGIN // A4 in pt

function newDoc() {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  doc.addFileToVFS('Playpen.ttf', FONT)
  doc.addFont('Playpen.ttf', 'Playpen', 'normal')
  doc.setFont('Playpen')
  doc.setCreationDate(new Date(Date.UTC(2026, 0, 1)))
  doc.setFileId('00000000000000000000000000000000')
  return doc
}

/** Writes a heading or a wrapped paragraph at y (baseline of the first line); returns y after the block. */
function block(doc, text, y, { size = 11, gapAfter = size * 0.9 } = {}) {
  doc.setFontSize(size)
  const lines = doc.splitTextToSize(text, WIDTH)
  const leading = size * 1.35
  lines.forEach((line, i) => doc.text(line, MARGIN, y + i * leading))
  return y + (lines.length - 1) * leading + leading + gapAfter
}

function save(doc, name) {
  writeFileSync(new URL(name, DIR), Buffer.from(doc.output('arraybuffer')))
  console.log('wrote', name)
}

// ---------------------------------------------------------------------------------------------- text-only
{
  const doc = newDoc()
  let y = 80
  y = block(doc, 'Qolyozma: sinov hujjati', y, { size: 20 })
  y = block(
    doc,
    'Oʻzbekiston — goʻzal yurt. Bogʻlarda gʻoʻza ochildi, maʼno toʻla kun. Bu paragraf bir necha qatorga ' +
      'boʻlinadi, chunki u sahifa kengligidan uzunroq; tahlilchi qatorlarni yana bitta paragrafga yigʻishi kerak.',
    y,
  )
  y = block(doc, 'Ikkinchi paragraf qisqa.', y)
  y = block(doc, 'Kirill yozuvi', y + 6, { size: 15 })
  y = block(doc, 'Ўзбекистон — гўзал юрт. Қишлоқда ҳаво тоза, ғалла пишди. Ҳар бир ҳарф тўғри чиқиши керак. Ғайрат ва Қодир ҳам келди.', y)
  doc.addPage()
  y = 80
  y = block(doc, 'Ikkinchi bet', y, { size: 15 })
  block(doc, 'The quick brown fox jumps over the lazy dog. This paragraph is on the second page.', y)
  save(doc, 'text-only.pdf')
}

// ---------------------------------------------------------------------------------------------------- table
{
  const doc = newDoc()
  let y = 80
  y = block(doc, 'Dars jadvali', y, { size: 20 })
  y = block(doc, 'Quyidagi jadvalda haftalik darslar koʻrsatilgan.', y)

  // Table 1: stroked grid lines.
  const rows = [
    ['Kun', 'Fan', 'Xona'],
    ['Dushanba', 'Ona tili', '12'],
    ['Seshanba', 'Matematika', '7'],
    ['Chorshanba', 'Tarix', '3'],
  ]
  const cols = [0, 150, 320, WIDTH]
  const rowH = 24
  const top = y
  doc.setLineWidth(0.8)
  for (let r = 0; r <= rows.length; r++) doc.line(MARGIN, top + r * rowH, MARGIN + WIDTH, top + r * rowH)
  for (const c of cols) doc.line(MARGIN + c, top, MARGIN + c, top + rows.length * rowH)
  doc.setFontSize(11)
  rows.forEach((row, r) => row.forEach((cell, c) => doc.text(cell, MARGIN + cols[c] + 6, top + r * rowH + 16)))
  y = top + rows.length * rowH + 30
  block(doc, 'Jadvaldan keyingi matn.', y)

  // Table 2 (page 2): borders drawn as hairline filled rectangles, as office suites often do.
  doc.addPage()
  y = block(doc, 'Ikkinchi jadval', 80, { size: 15 })
  const rows2 = [
    ['Ism', 'Baho'],
    ['Aziza', '5'],
    ['Gʻayrat', '4'],
  ]
  const cols2 = [0, 200, 300]
  const top2 = y
  for (let r = 0; r <= rows2.length; r++) doc.rect(MARGIN, top2 + r * rowH - 0.4, 300, 0.8, 'F')
  for (const c of cols2) doc.rect(MARGIN + c - 0.4, top2, 0.8, rows2.length * rowH, 'F')
  doc.setFontSize(11)
  rows2.forEach((row, r) => row.forEach((cell, c) => doc.text(cell, MARGIN + cols2[c] + 6, top2 + r * rowH + 16)))
  save(doc, 'table.pdf')
}

// -------------------------------------------------------------------------------------------------- diagram
{
  const doc = newDoc()
  let y = 80
  y = block(doc, 'Ish jarayoni', y, { size: 20, gapAfter: 4 })
  doc.setLineWidth(0.8)
  doc.line(MARGIN, y - 10, MARGIN + WIDTH, y - 10) // rule under the heading: decoration, not a diagram
  y = block(doc, 'Fayl brauzerda qayta ishlanadi: avval tahlil, keyin natija.', y + 6)

  const boxW = 110
  const boxH = 40
  const gap = (WIDTH - 3 * boxW) / 2
  const top = y + 10
  const labels = ['Fayl', 'Tahlil', 'Natija']
  doc.setLineWidth(1.2)
  doc.setFontSize(12)
  labels.forEach((label, i) => {
    const x = MARGIN + i * (boxW + gap)
    doc.rect(x, top, boxW, boxH, 'S')
    doc.text(label, x + boxW / 2 - doc.getTextWidth(label) / 2, top + boxH / 2 + 4)
    if (i < labels.length - 1) {
      const ax = x + boxW
      const bx = x + boxW + gap
      const ay = top + boxH / 2
      doc.line(ax + 4, ay, bx - 10, ay)
      doc.triangle(bx - 10, ay - 4, bx - 10, ay + 4, bx - 2, ay, 'F') // arrowhead
    }
  })
  block(doc, 'Diagrammadan keyingi matn.', top + boxH + 36)
  save(doc, 'diagram.pdf')
}
