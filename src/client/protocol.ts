/** Annotation text matching for the browser user-message renderer. */
import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { annotationTitle, decodeNotes } from '../protocol.ts'
import type { AnnotationNote } from '../protocol.ts'
export { anchorSchema, noteSchema, decodeNotes, encodeNotes } from '../protocol.ts'
export type { AnnotationAnchor, AnnotationId, AnnotationNote } from '../protocol.ts'

const OPEN = '<dsh-annotations version="1">\n'
const CLOSE = '\n</dsh-annotations>'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    /** Logged annotation batch with its original quotes and comments. */
    annotations: { readonly notes: readonly AnnotationNote[] }
  }
}

/** Complete blocks become labels; unknown and malformed text remains readable verbatim. */
export const annotationRule: UserTextRule<'annotations'> = {
  id: 'annotations', order: -10,
  match(text, from) {
    for (let start = text.indexOf(OPEN, from); start >= 0; start = text.indexOf(OPEN, start + OPEN.length)) {
      const closing = text.indexOf(CLOSE, start + OPEN.length)
      if (closing < 0) return undefined
      const end = closing + CLOSE.length
      const notes = decodeNotes(text.slice(start, end))
      if (notes !== undefined) {
        const header = `${annotationTitle(notes)}\n\n`
        const headerStart = start - header.length
        if (headerStart >= from && text.slice(headerStart, start) === header) start = headerStart
        return { id: 'annotations', start, end, data: { notes } }
      }
    }
    return undefined
  },
}
