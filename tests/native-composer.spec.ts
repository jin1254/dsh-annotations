/** Native labels preserve ordinary input and settle only their own annotation batch. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { InputState, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { NativeComposer, ANNOTATION_SOURCE, detectOffset, readReference } from '../src/client/native-composer.ts'
import { AnnotationModel } from '../src/client/model.ts'
import type { AnnotationAnchor } from '../src/client/protocol.ts'

const sid = 'native-test' as SessionId
const anchor: AnnotationAnchor = { nodeKey: 'assistant:1', blockIndex: -1, seq: 5, turn: 1,
  start: 0, end: 5, quote: 'hello', prefix: '', suffix: '' }
const cleanup: (() => void)[] = []
afterEach(() => { for (const stop of cleanup.splice(0).reverse()) stop() })
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

function setup(text = '') {
  const ctx = new Context()
  const model = new AnnotationModel(sid, { getItem: () => null, setItem: () => {} })
  const events = createSnapshotStore<SessionEventWindow>({ entries: [], hasMore: false,
    revision: 0, change: { kind: 'replace', entries: [] } })
  const state = createSnapshotStore<InputState>({ draft: text, draftRev: 0, attachmentIds: [], phase: 'plain', occurrences: [], queue: [] })
  let occurrenceId = 0
  const input: SessionInput = {
    state, beginCommand: () => false,
    insertReference(ref, span) {
      const previous = state.getSnapshot()
      if (span.draftRev !== previous.draftRev || span.start !== detectOffset(previous, previous.draft.length)) return false
      state.set({ ...previous, draft: previous.draft + ref.clipboardText + ' ', draftRev: previous.draftRev + 1,
        occurrences: [...previous.occurrences, { ...ref, occurrenceId: ++occurrenceId, offset: previous.draft.length,
          length: ref.clipboardText.length }] })
      return true
    },
    setDraft(draft) { const previous = state.getSnapshot(); state.set({ ...previous, draft, draftRev: previous.draftRev + 1, occurrences: [] }) },
    addAttachments: () => false, removeAttachment: () => false, pruneAttachments: () => {},
    submit: () => {}, notify: () => {}, focus: () => {},
  }
  const unsubscribe = ctx.on('slash/input-consume-token', ({ guard }) => {
    if (guard.kind !== 'span') return undefined
    const previous = state.getSnapshot()
    const occurrence = previous.occurrences.find(item => detectOffset(previous, item.offset) === guard.span.start)
    if (occurrence === undefined || guard.span.draftRev !== previous.draftRev) return undefined
    state.set({ ...previous, draftRev: previous.draftRev + 1,
      draft: previous.draft.slice(0, occurrence.offset) + previous.draft.slice(occurrence.offset + occurrence.length),
      occurrences: previous.occurrences.filter(item => item !== occurrence).map(item => item.offset > occurrence.offset
        ? { ...item, offset: item.offset - occurrence.length } : item) })
    return true
  })
  const bridge = new NativeComposer({ ctx, sessionId: sid, eventSource: events }, input, model, count => `${String(count)} annotations`)
  cleanup.push(unsubscribe, () => bridge.dispose())
  const add = (comment: string): void => { model.create(anchor, { left: 0, top: 0 }); model.save(comment) }
  const reference = (): string => state.getSnapshot().occurrences.find(item => item.source === ANNOTATION_SOURCE)!.ref
  const acknowledge = (text: string): void => {
    const event: SessionEvent<'user/message'> = { type: 'user/message', seq: 6 as SessionSeq, time: 1, surfaceOp: 'append',
      data: { id: 'message-1' as MessageId, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } }
    const entries = [{ type: 'event' as const, event }]
    events.set({ entries, hasMore: false, revision: 1, change: { kind: 'append', entries } })
  }
  return { model, state, input, bridge, add, reference, acknowledge }
}

describe('native annotation labels', () => {
  it('automatically attaches labels, refreshes edits, and removes only its own attachment', async () => {
    const test = setup('Keep my text. ')
    test.add('First comment'); await flush()
    expect(test.state.getSnapshot().draft).toMatch(/^Keep my text\. @annotations:/u)
    expect(test.state.getSnapshot().draft).not.toContain('First comment')
    const first = readReference(test.reference()).notes[0]!
    test.model.edit(first.id, { left: 0, top: 0 }); test.model.save('Edited comment'); await flush()
    expect(readReference(test.reference()).notes[0]?.comment).toBe('Edited comment')
    test.model.remove(first.id); await flush()
    expect(test.state.getSnapshot().occurrences).toEqual([])
    expect(test.state.getSnapshot().draft.trim()).toBe('Keep my text.')
  })

  it('freezes a send and removes its markers only after durable admission', async () => {
    const test = setup()
    test.add('Submitted'); await flush()
    const ref = test.reference()
    const text = test.bridge.serialize(ref, new AbortController().signal)
    expect(text).toMatch(/^Annotation 1: hello\n\n<dsh-annotations/u)
    test.input.setDraft(''); await flush()
    expect(test.model.state.getSnapshot().notes[0]?.status).toBe('sending')
    test.add('Next round'); await flush()
    test.acknowledge(text); await flush()
    expect(test.model.state.getSnapshot().notes.map(note => [note.number, note.comment])).toEqual([[1, 'Next round']])
    expect(readReference(test.reference()).notes[0]?.comment).toBe('Next round')
  })

  it('restores annotation drafts when the native composer restores a rejected send', async () => {
    const test = setup()
    test.add('Do not lose this'); await flush()
    const ref = test.reference()
    const original = test.state.getSnapshot()
    test.bridge.serialize(ref, new AbortController().signal)
    test.input.setDraft(''); await flush()
    test.state.set({ ...original, draftRev: test.state.getSnapshot().draftRev + 1 }); await flush()
    expect(test.model.state.getSnapshot().notes[0]?.status).toBe('draft')
    expect(readReference(test.reference()).notes[0]?.comment).toBe('Do not lose this')
  })

  it('treats native deletion as removing the pending annotation attachment', async () => {
    const test = setup()
    test.add('Delete from this turn'); await flush()
    test.input.setDraft(''); await flush()
    expect(test.model.state.getSnapshot().notes).toEqual([])
    expect(test.state.getSnapshot().occurrences).toEqual([])
  })

  it('retains unknown admission outcomes after disposal and rejects stale snapshots', async () => {
    const test = setup()
    test.add('Original'); await flush()
    const ref = test.reference()
    const note = test.model.state.getSnapshot().notes[0]!
    test.model.edit(note.id, { left: 0, top: 0 }); test.model.save('New edit'); await flush()
    expect(() => test.bridge.serialize(ref, new AbortController().signal)).toThrow('outdated')
    test.bridge.serialize(test.reference(), new AbortController().signal)
    test.bridge.dispose(); await flush()
    expect(test.model.state.getSnapshot().notes[0]?.status).toBe('uncertain')
  })

  it('maps native reference boundaries while retaining other owners’ chips', () => {
    const base = setup().state.getSnapshot()
    const state: InputState = { ...base, draft: '@file-name normal @annotations:id', occurrences: [
      { source: 'file', ref: 'f', label: 'file', clipboardText: '@file-name', offset: 0, length: 10, occurrenceId: 1 },
      { source: ANNOTATION_SOURCE, ref: 'a', label: 'note', clipboardText: '@annotations:id', offset: 18, length: 15, occurrenceId: 2 },
    ] }
    expect(detectOffset(state, 18)).toBe(9)
    expect(detectOffset(state, state.draft.length)).toBe(state.draft.length - 9 - 14)
  })
})
