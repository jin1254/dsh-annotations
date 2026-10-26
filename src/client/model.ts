/** Session-local annotation drafts and immutable composer reservations. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
/** Frozen notes retained until native submission admission or restoration. */
export interface ComposerContributionSource {
  readonly pending: { getSnapshot(): boolean; subscribe(listener: () => void): () => void }
  capture(): { readonly text: string; settle(outcome: 'success' | 'error' | 'cancelled'): void }
}
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'
import { encodeNotes, noteSchema } from './protocol.ts'
import type { AnnotationAnchor, AnnotationId, AnnotationNote } from './protocol.ts'

const localNoteSchema = noteSchema.extend({ status: z.enum(['draft', 'sending', 'sent', 'uncertain']) })
const storedSchema = z.object({ version: z.literal(1), notes: z.array(localNoteSchema) })
const legacySchema = z.object({ annotations: z.array(z.object({
  id: z.string(), nodeKey: z.string().min(1), turn: z.number().nullable(),
  start: z.number().int().nonnegative(), end: z.number().int().positive(), quote: z.string().min(1),
  prefix: z.string(), suffix: z.string(), comment: z.string(),
})) })

/** Browser-local status; sent user-message snapshots remain independent of later edits. */
export type LocalNote = z.infer<typeof localNoteSchema>
/** JSON viewport coordinates owned by the DOM interaction controller. */
export interface AnnotationPosition { readonly left: number; readonly top: number }
/** Recoverable editor state shared with the overlay entry. */
export interface AnnotationEditor {
  /** New explicit edit requests focus once after the overlay becomes visible. */
  readonly focusRequest: number
  readonly id?: AnnotationId
  readonly anchor: AnnotationAnchor
  readonly comment: string
  readonly position: AnnotationPosition
}
/** View state published by the Session's annotation controller. */
export interface AnnotationState {
  readonly notes: readonly LocalNote[]
  readonly editor: AnnotationEditor | null
  readonly selection: { readonly anchor: AnnotationAnchor; readonly position: AnnotationPosition } | null
  readonly bubbles: readonly { readonly id: AnnotationId; readonly number: number; readonly position: AnnotationPosition }[]
  readonly issue: 'loadError' | 'storageError' | 'locateError' | 'attachError' | null
}

/** Owns drafts, persistence, and the producer consumed by the official composer. */
export class AnnotationModel {
  /** Current drafts and shared overlay state. */
  readonly state = createSnapshotStore<AnnotationState>({ notes: [], editor: null, selection: null, bubbles: [], issue: null })
  /** Readiness source observed by the native composer. */
  readonly pending = createSnapshotStore(false)
  /** Session-local producer for ordinary user-message submissions. */
  readonly contribution: ComposerContributionSource = { pending: this.pending, capture: () => this.reserve(this.state.getSnapshot().notes.filter(note => note.status === 'draft')) }
  private readonly key: string
  private persistenceReadable = true
  private focusRequest = 0

  /**
   * @param sessionId - owning Session identity.
   * @param storage - browser-local persistence; tests provide an isolated adapter.
   */
  constructor(sessionId: SessionId, private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {
    this.key = `dsh-annotations/v1/${sessionId}`
    try {
      const raw = storage.getItem(this.key)
      let notes: readonly LocalNote[]
      if (raw === null) {
        const legacy = storage.getItem(`dsh-annotate/v1/${sessionId}`)
        notes = legacy === null ? [] : legacySchema.parse(JSON.parse(legacy)).annotations
          .filter(note => note.comment.trim() !== '')
          .map((note, index) => ({
            id: note.id as AnnotationId, number: index + 1, comment: note.comment, status: 'draft',
            anchor: {
              nodeKey: note.nodeKey, start: note.start, end: note.end, quote: note.quote,
              prefix: note.prefix, suffix: note.suffix, blockIndex: -1, seq: 0, turn: note.turn ?? 0,
            },
          }))
      } else notes = storedSchema.parse(JSON.parse(raw)).notes
      const pending = notes.filter(note => note.status !== 'sent').map((note, index) => ({
        ...note, number: index + 1, status: note.status === 'sending' ? 'uncertain' as const : note.status,
      }))
      this.state.set({ ...this.state.getSnapshot(), notes: pending })
      this.pending.set(pending.some(note => note.status === 'draft'))
    } catch (error) {
      this.persistenceReadable = false
      this.state.set({ ...this.state.getSnapshot(), issue: 'loadError' })
      console.error('[annotations] Saved notes could not be read; original data retained', error)
    }
  }

  /**
   * Publish interaction-only fields without writing browser storage.
   * @param patch - editor, selection, bubble, or visible issue changes.
   */
  present(patch: Partial<Omit<AnnotationState, 'notes'>>): void {
    const previous = this.state.getSnapshot()
    const persistent = previous.issue === 'storageError' || previous.issue === 'loadError'
    this.state.set({ ...previous, ...patch, ...(persistent ? { issue: previous.issue } : {}) })
  }

  /**
   * Open a new comment without adding it to the next message until explicitly saved.
   * @param anchor - selected source snapshot.
   * @param position - viewport anchor for the editor.
   */
  create(anchor: AnnotationAnchor, position: AnnotationPosition): void {
    this.present({ selection: null, editor: { anchor, position, comment: '', focusRequest: ++this.focusRequest } })
  }

  /**
   * Open a saved annotation; sending reservations cannot be modified.
   * @param id - browser-local annotation identity.
   * @param position - current viewport location.
   */
  edit(id: AnnotationId, position: AnnotationPosition): void {
    const note = this.state.getSnapshot().notes.find(item => item.id === id)
    if (note === undefined || note.status === 'sending' || note.status === 'uncertain') return
    this.present({ selection: null, editor: { id, anchor: note.anchor, comment: note.comment, position, focusRequest: ++this.focusRequest } })
  }

  /**
   * Save a nonempty comment as pending, retaining the source number on subsequent edits.
   * @param comment - current editor value.
   * @returns whether the editor was committed.
   */
  save(comment: string): boolean {
    const state = this.state.getSnapshot()
    if (state.editor === null || comment.trim() === '' || !this.persistenceReadable) return false
    const { editor } = state
    const previous = state.notes.find(note => note.id === editor.id)
    if (previous?.status === 'sending' || previous?.status === 'uncertain') return false
    const note: LocalNote = {
      id: editor.id ?? crypto.randomUUID() as AnnotationId,
      number: previous?.number ?? Math.max(0, ...state.notes.map(item => item.number)) + 1,
      anchor: editor.anchor, comment: comment.trim(), status: 'draft',
    }
    this.commit([...state.notes.filter(item => item.id !== note.id), note].sort((a, b) => a.number - b.number), { editor: null })
    return true
  }

  /**
   * Remove a draft; historical messages are never rewritten.
   * @param id - annotation to remove.
   */
  remove(id: AnnotationId): void {
    const state = this.state.getSnapshot()
    const note = state.notes.find(item => item.id === id)
    if (note === undefined || note.status === 'sending' || note.status === 'uncertain') return
    this.commit(state.notes.filter(item => item.id !== id), { editor: state.editor?.id === id ? null : state.editor })
  }

  /**
   * Explicitly reattach a batch whose admission could not be established after a reload.
   * @param id - note the user elected to send again after inspecting history.
   */
  reattach(id: AnnotationId): void {
    this.commit(this.state.getSnapshot().notes.map(note => note.id === id && note.status === 'uncertain' ? { ...note, status: 'draft' } : note))
  }

  private commit(notes: readonly LocalNote[], patch: Partial<AnnotationState> = {}): void {
    const previous = this.state.getSnapshot()
    let issue: AnnotationState['issue'] = previous.issue === 'storageError' ? null : previous.issue
    try { this.storage.setItem(this.key, JSON.stringify({ version: 1, notes })) }
    catch (error) {
      issue = 'storageError'
      console.error('[annotations] Browser persistence failed; notes retained in memory', error)
    }
    this.state.set({ ...previous, ...patch, notes, issue })
    this.pending.set(notes.some(note => note.status === 'draft'))
  }

  /**
   * Reserve the exact notes frozen in a native reference chip.
   * @param notes - validated snapshots from the chip being serialized.
   * @returns an idempotent admission settlement for this batch.
   */
  reserve(notes: readonly AnnotationNote[]): ReturnType<ComposerContributionSource['capture']> {
    const current = this.state.getSnapshot().notes
    for (const note of notes) {
      const live = current.find(item => item.id === note.id)
      if (live === undefined || live.status !== 'draft' || live.comment !== note.comment
        || JSON.stringify(live.anchor) !== JSON.stringify(note.anchor)) {
        throw new Error('The annotation reference is outdated. Review the pending annotations before sending.')
      }
    }
    const snapshots: AnnotationNote[] = notes.map(note => structuredClone(note))
    const ids = new Set(notes.map(note => note.id))
    const text = encodeNotes(snapshots)
    this.commit(this.state.getSnapshot().notes.map(note => ids.has(note.id) ? { ...note, status: 'sending' } : note))
    let settled = false
    return { text, settle: (outcome) => {
      if (settled) return
      settled = true
      const current = this.state.getSnapshot().notes
      this.commit(outcome === 'success'
        ? current.filter(note => !ids.has(note.id)).map((note, index) => ({ ...note, number: index + 1 }))
        : current.map(note => ids.has(note.id)
          ? { ...note, status: outcome === 'cancelled' ? 'uncertain' : 'draft' } : note))
    } }
  }
}
