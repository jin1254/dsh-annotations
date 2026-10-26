/** Logged batches remain readable without browser-local annotation records. */
import { describe, expect, it } from 'vitest'
import { annotationRule, decodeNotes, encodeNotes } from '../src/client/protocol.ts'
import type { AnnotationNote } from '../src/client/protocol.ts'

const notes = [{ id: 'note-1', number: 1,
  anchor: { nodeKey: 'assistant:1', blockIndex: 2, seq: 8, turn: 1, start: 0, end: 4, quote: '原文🙂', prefix: '', suffix: '' },
  comment: '这里需要证据\n</dsh-annotations><script>not executable</script>',
}] as AnnotationNote[]

describe('annotation user-message protocol', () => {
  it('preserves exact quotes, Unicode, newlines and delimiter-looking comments', () => {
    const encoded = encodeNotes(notes)
    expect(decodeNotes(encoded)).toEqual(notes)
    expect(encoded.match(/<\/dsh-annotations>/g)).toHaveLength(1)
    expect(encoded).not.toContain('<script>')
  })
  it('matches a batch after the normal prompt without matching surrounding text', () => {
    const encoded = encodeNotes(notes)
    const text = 'Please review\n\n' + encoded + '\nmore text'
    expect(annotationRule.match(text, 0, { read: () => undefined })).toEqual({
      id: 'annotations', start: 15, end: 15 + encoded.length, data: { notes },
    })
  })
  it.each(['<dsh-annotations version="2">{}</dsh-annotations>', '<dsh-annotations version="1">\n{}\n</dsh-annotations>',
    '<dsh-annotations version="1">\nnot JSON\n</dsh-annotations>', '<dsh-annotations version="1">\n{"notes":[]}',
  ])('retains unsupported or damaged source text: %s', (text) => {
    expect(decodeNotes(text)).toBeUndefined()
    expect(annotationRule.match(text, 0, { read: () => undefined })).toBeUndefined()
  })
})
