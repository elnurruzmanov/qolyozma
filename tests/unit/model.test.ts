import { describe, expect, it } from 'vitest'
import { plainText, type Document } from '../../src/core/model'

describe('plainText', () => {
  it('joins text blocks and keeps Uzbek Latin characters intact', () => {
    const doc: Document = {
      blocks: [
        { kind: 'heading', level: 1, text: 'Oʻzbekiston' },
        { kind: 'paragraph', text: 'gʻoʻza, maʼno' },
        { kind: 'image', src: 'x.png', width: 1, height: 1 },
        { kind: 'table', rows: [['a', 'b']] },
      ],
    }
    expect(plainText(doc)).toBe('Oʻzbekiston\ngʻoʻza, maʼno\na\tb')
  })
})
