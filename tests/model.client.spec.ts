/** Annotation storage and reservation behavior with isolated browser adapters. */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { AnnotationModel } from '../src/client/model.ts'
import { decodeNotes } from '../src/client/protocol.ts'
import type { AnnotationAnchor } from '../src/client/protocol.ts'

const sid = 'notes-session' as SessionId
const anchor: AnnotationAnchor = { nodeKey: 'assistant:1', blockIndex: 0, seq: 5, turn: 1, start: 0, end: 5, quote: 'hello', prefix: '', suffix: ' world' }
function storage() {
  const data = new Map<string, string>()
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
}
function add(model: AnnotationModel, comment: string) {
  model.create(anchor, { left: 20, top: 40 })
  expect(model.save(comment)).toBe(true)
}

describe('annotation drafts', () => {
  it('only attaches an explicitly saved comment and preserves Escape cancellation', () => {
    const model = new AnnotationModel(sid, storage())
    model.create(anchor, { left: 20, top: 40 })
    expect(model.pending.getSnapshot()).toBe(false)
    expect(model.save(' ')).toBe(false)
    model.present({ editor: null })
    expect(model.state.getSnapshot().notes).toEqual([])
    add(model, 'comment')
    expect(model.pending.getSnapshot()).toBe(true)
  })

  it('keeps list visibility local and collapses it after the last draft is sent or removed', () => {
    const saved = storage()
    const model = new AnnotationModel(sid, saved)
    add(model, 'comment')
    const persisted = saved.getItem(`dsh-annotations/v1/${sid}`)
    model.present({ expanded: true })
    expect(saved.getItem(`dsh-annotations/v1/${sid}`)).toBe(persisted)
    expect(new AnnotationModel(sid, saved).state.getSnapshot().expanded).toBe(false)
    model.contribution.capture().settle('success')
    expect(model.state.getSnapshot().expanded).toBe(false)
    add(model, 'next comment')
    model.present({ expanded: true })
    model.remove(model.state.getSnapshot().notes[0]!.id)
    expect(model.state.getSnapshot().expanded).toBe(false)
  })

  it('freezes the sent batch, keeps new annotations pending, and restores only failed notes', () => {
    const model = new AnnotationModel(sid, storage())
    add(model, 'first')
    const first = model.contribution.capture()
    const note = model.state.getSnapshot().notes[0]!
    model.edit(note.id, { left: 0, top: 0 })
    expect(model.state.getSnapshot().editor).toBeNull()
    add(model, 'second')
    expect(decodeNotes(first.text)?.map(value => value.comment)).toEqual(['first'])
    first.settle('error')
    expect(model.state.getSnapshot().notes.map(value => value.status)).toEqual(['draft', 'draft'])
    first.settle('success')
    expect(model.state.getSnapshot().notes[0]?.status).toBe('draft')
    const second = model.contribution.capture()
    second.settle('success')
    expect(model.pending.getSnapshot()).toBe(false)
    expect(model.state.getSnapshot().notes).toEqual([])
  })

  it('clears sent sources and restarts numbering without changing historical snapshots', () => {
    const saved = storage()
    const model = new AnnotationModel(sid, saved)
    add(model, 'old comment')
    const batch = model.contribution.capture()
    batch.settle('success')
    expect(model.state.getSnapshot().notes).toEqual([])
    const restored = new AnnotationModel(sid, saved)
    expect(restored.state.getSnapshot().notes).toEqual([])
    add(model, 'new comment')
    expect(model.pending.getSnapshot()).toBe(true)
    expect(model.state.getSnapshot().notes[0]?.number).toBe(1)
    expect(decodeNotes(batch.text)?.[0]?.comment).toBe('old comment')
    model.remove(model.state.getSnapshot().notes[0]!.id)
    expect(model.pending.getSnapshot()).toBe(false)
    expect(decodeNotes(batch.text)?.[0]?.comment).toBe('old comment')
  })

  it('keeps notes added during admission and numbers the next batch from one', () => {
    const model = new AnnotationModel(sid, storage())
    add(model, 'submitted')
    const batch = model.contribution.capture()
    add(model, 'next round')
    batch.settle('success')
    expect(model.state.getSnapshot().notes.map(note => [note.number, note.comment])).toEqual([[1, 'next round']])
    expect(decodeNotes(batch.text)?.[0]?.comment).toBe('submitted')
  })

  it('discards older sent markers on reload while retaining and renumbering pending comments', () => {
    const saved = storage()
    const model = new AnnotationModel(sid, saved)
    add(model, 'sent in an older version')
    add(model, 'still pending')
    const notes = model.state.getSnapshot().notes.map((note, index) => index === 0 ? { ...note, status: 'sent' } : note)
    saved.setItem(`dsh-annotations/v1/${sid}`, JSON.stringify({ version: 1, notes }))
    const restored = new AnnotationModel(sid, saved)
    expect(restored.state.getSnapshot().notes.map(note => [note.number, note.comment])).toEqual([[1, 'still pending']])
  })

  it('retains unconfirmed submissions without automatically sending duplicates after reload', () => {
    const saved = storage()
    const first = new AnnotationModel(sid, saved)
    add(first, 'pending round trip')
    first.contribution.capture()
    const restored = new AnnotationModel(sid, saved)
    expect(restored.pending.getSnapshot()).toBe(false)
    expect(restored.state.getSnapshot().notes[0]?.status).toBe('uncertain')
    restored.reattach(restored.state.getSnapshot().notes[0]!.id)
    expect(restored.pending.getSnapshot()).toBe(true)
    expect(restored.state.getSnapshot().expanded).toBe(true)
  })

  it('copies old local-plugin annotations without changing their source storage', () => {
    const saved = storage()
    const old = JSON.stringify({ v: 1, annotations: [{ id: 'old', ...anchor, comment: 'legacy' }] })
    saved.setItem(`dsh-annotate/v1/${sid}`, old)
    const model = new AnnotationModel(sid, saved)
    expect(model.state.getSnapshot().notes[0]?.anchor.blockIndex).toBe(-1)
    expect(model.pending.getSnapshot()).toBe(true)
    expect(saved.getItem(`dsh-annotate/v1/${sid}`)).toBe(old)
  })
})
