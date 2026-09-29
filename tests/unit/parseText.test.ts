import { describe, expect, it } from 'vitest'
import { normalizeText, parseText } from '../../src/core/parse/text'

describe('parseText', () => {
  it('splits paragraphs on blank lines and joins soft-wrapped lines', () => {
    expect(parseText('Birinchi qator\ndavomi.\n\nIkkinchi paragraf.').blocks).toEqual([
      { kind: 'paragraph', text: 'Birinchi qator davomi.' },
      { kind: 'paragraph', text: 'Ikkinchi paragraf.' },
    ])
  })

  it('reads Markdown-style headings', () => {
    expect(parseText('# Sarlavha\nMatn\n## Boʻlim\n### Kichik ###').blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Sarlavha' },
      { kind: 'paragraph', text: 'Matn' },
      { kind: 'heading', level: 2, text: 'Boʻlim' },
      { kind: 'heading', level: 3, text: 'Kichik' },
    ])
  })

  it('keeps list items as separate paragraphs', () => {
    expect(parseText('Roʻyxat:\n- olma\n- nok\n1. bir\nа) кирилл').blocks.map((b) => (b as { text: string }).text)).toEqual([
      'Roʻyxat:',
      '- olma',
      '- nok',
      '1. bir',
      'а) кирилл',
    ])
  })

  it('handles Windows line endings, BOM and extra whitespace', () => {
    expect(parseText('\uFEFF  Salom   dunyo \r\n\r\n\tYana ').blocks).toEqual([
      { kind: 'paragraph', text: 'Salom dunyo' },
      { kind: 'paragraph', text: 'Yana' },
    ])
  })

  it('returns an empty document for empty input', () => {
    expect(parseText(' \n\n ').blocks).toEqual([])
  })
})

describe('normalizeText', () => {
  it('composes decomposed Cyrillic letters (у + breve -> ў)', () => {
    expect(normalizeText('у\u0306 У\u0306')).toBe('ў Ў')
  })

  it('turns no-break spaces into spaces and drops soft hyphens and zero-width characters', () => {
    expect(normalizeText('a\u00A0b so\u00ADz x\u200By')).toBe('a b soz xy')
  })

  it('keeps Uzbek modifier letters untouched', () => {
    expect(normalizeText('oʻzbek maʼno')).toBe('oʻzbek maʼno')
  })
})
