// @vitest-environment jsdom
/** Visible-text offsets stay stable across markup, repeated quotes, and Session surfaces. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SourceAccess } from '../src/client/anchors.ts'
import { locateRange, selectedAnchor, textStream } from '../src/client/anchors.ts'
import type { AnnotationAnchor } from '../src/client/protocol.ts'

let settled = true
let owned: Element | null = null
const access: SourceAccess = { root: () => owned, node: key => settled && key === 'assistant:1' ? { seq: 9, turn: 1 } : undefined }
function source() {
  const root = document.createElement('div')
  root.setAttribute('data-chat-node-key', 'assistant:1')
  root.setAttribute('data-chat-flow-kind', 'assistant-step')
  root.innerHTML = '<p>First <strong>中文🙂</strong> second.</p><button>Copy</button><span class="katex-mathml">duplicate</span>'
  document.body.append(root)
  owned = document.body
  settled = true
  return root
}
const anchor: AnnotationAnchor = { nodeKey: 'assistant:1', blockIndex: -1, seq: 9, turn: 1, start: 6, end: 10, quote: '中文🙂', prefix: 'First ', suffix: ' second.' }
afterEach(() => { document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); vi.restoreAllMocks() })

describe('assistant prose anchors', () => {
  it('excludes controls and duplicate math text without changing styled source text', () => {
    const root = source()
    expect(textStream(root).text).toBe('First 中文🙂 second.')
    expect(locateRange(root, anchor)?.toString()).toBe('中文🙂')
  })
  it('captures a selection within one settled Session block', () => {
    const root = source()
    const range = locateRange(root, anchor)!
    document.getSelection()?.addRange(range)
    expect(selectedAnchor(access)?.anchor).toEqual(anchor)
    expect(selectedAnchor({ ...access, root: () => document.createElement('div') })).toBeNull()
    settled = false
    expect(selectedAnchor(access)).toBeNull()
  })
  it('rejects cross-message selections and whitespace', () => {
    const a = source()
    const b = source()
    const range = document.createRange()
    range.setStart(a.querySelector('strong')!.firstChild!, 0)
    range.setEnd(b.querySelector('strong')!.firstChild!, 1)
    document.getSelection()?.addRange(range)
    expect(selectedAnchor(access)).toBeNull()
  })
  it('relocates a uniquely contextualized quote and refuses an ambiguous replacement', () => {
    const root = source()
    root.querySelector('p')!.prepend('new ')
    expect(locateRange(root, anchor)?.toString()).toBe('中文🙂')
    root.textContent = 'hello hello'
    expect(locateRange(root, { ...anchor, quote: 'hello', start: 1, end: 6, prefix: '', suffix: '' })).toBeNull()
  })
  it('checks context even when an old offset now points to another equal quote', () => {
    const root = source()
    root.textContent = 'hello A hello B'
    const range = locateRange(root, { ...anchor, quote: 'hello', start: 0, end: 5, prefix: '', suffix: ' B' })
    expect(range?.startOffset).toBe(8)
  })
  it('treats hidden display-contents wrappers according to their actual visibility', () => {
    const root = source()
    root.setAttribute('hidden', '')
    root.style.display = 'contents'
    expect(textStream(root).text).toBe('First 中文🙂 second.')
    root.style.display = 'none'
    expect(textStream(root).text).toBe('')
  })
})
