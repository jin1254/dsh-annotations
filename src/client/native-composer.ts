/** Native reference chips carry annotation snapshots without changing the host composer. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEventSource, SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { InputState, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-agent/types'
import { z } from 'zod'
import { noteSchema } from './protocol.ts'
import { annotationTitle } from '../protocol.ts'
import type { AnnotationModel, ComposerContributionSource } from './model.ts'

/** Reference source owned by this plugin's native composer integration. */
export const ANNOTATION_SOURCE = 'dsh-annotations'
type Occurrence = InputState['occurrences'][number]
const referenceSchema = z.object({ sessionId: z.string().min(1), notes: z.array(noteSchema).min(1) })
/** Immutable native reference payload, including the source Session. */
export type AnnotationReference = z.infer<typeof referenceSchema>

/**
 * Validate native or persisted reference data before serialization.
 * @param ref - opaque reference string stored in the native editor.
 * @returns complete annotation snapshots.
 */
export function readReference(ref: string): AnnotationReference {
  return referenceSchema.parse(JSON.parse(ref))
}

/**
 * Produce a copyable marker distinct from the model-visible annotation text.
 * @param ref - complete native reference payload.
 * @returns the displayed notes' stable clipboard marker.
 */
export function referenceClipboard(ref: string): string {
  return `@annotations:${readReference(ref).notes.map(note => note.id).join(',')}`
}

/**
 * Convert chip-boundary clipboard coordinates to native insertion coordinates.
 * @param state - exact current native input snapshot.
 * @param offset - clipboard offset at a reference boundary or document end.
 * @returns the corresponding detect offset.
 */
export function detectOffset(state: InputState, offset: number): number {
  let result = offset
  for (const occurrence of state.occurrences) {
    if (occurrence.offset + occurrence.length <= offset) result -= occurrence.length - 1
  }
  if (state.claim !== undefined) {
    const token = state.claim.token.trimEnd()
    if (state.draft.startsWith(token) && offset >= token.length) result -= token.length - 1
  }
  return result
}

interface NativeBinding {
  readonly sessionId: SessionId
  readonly eventSource: SessionEventSource
  readonly ctx: Pick<Context, 'bail'>
}

interface Flight {
  readonly reservation: ReturnType<ComposerContributionSource['capture']>
  readonly abort: () => void
  readonly signal: AbortSignal
  detached: boolean
}

/** Session-owned synchronization and durable admission observer for native reference chips. */
export class NativeComposer {
  private disposed = false
  private scheduled = false
  private mutating = false
  private activeRef: string | undefined
  private readonly flights = new Map<string, Flight>()
  private readonly stops: readonly (() => void)[]
  private eventRevision = -1

  /**
   * @param binding - retained Session and its public event feed.
   * @param input - official per-Session composer.
   * @param model - independently persisted annotation drafts.
   * @param label - localized count label read at attachment time.
   */
  constructor(
    private readonly binding: NativeBinding,
    private readonly input: SessionInput,
    private readonly model: AnnotationModel,
    private readonly label: (count: number) => string,
  ) {
    this.stops = [model.state.subscribe(() => { this.schedule() }), input.state.subscribe(() => { this.inputChanged() }),
      binding.eventSource.subscribe(() => { this.eventsChanged() })]
    this.schedule()
  }

  /**
   * Freeze only the chip's notes; native submission still owns attachments and delivery policy.
   * @param ref - validated snapshot reference selected by the native editor.
   * @param signal - native submission cancellation.
   * @returns exactly the original frozen notes as model-visible text.
   */
  serialize(ref: string, signal: AbortSignal): string {
    if (this.disposed || signal.aborted) throw new Error('The annotation submission was cancelled.')
    const value = readReference(ref)
    if (value.sessionId !== this.binding.sessionId) throw new Error('This annotation belongs to another conversation.')
    if (this.flights.has(ref)) throw new Error('Remove the duplicate annotation label before sending.')
    const reservation = this.model.reserve(value.notes)
    const abort = (): void => { this.finish(ref, 'cancelled') }
    const record: Flight = { reservation, signal, abort, detached: false }
    this.flights.set(ref, record)
    signal.addEventListener('abort', abort, { once: true })
    this.schedule()
    return `${annotationTitle(value.notes)}\n\n${reservation.text}`
  }

  /** Release subscriptions and retain unresolved admission snapshots for explicit recovery. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const stop of this.stops) stop()
    for (const ref of [...this.flights.keys()]) this.finish(ref, 'cancelled')
  }

  private finish(ref: string, outcome: 'success' | 'error' | 'cancelled'): void {
    const flight = this.flights.get(ref)
    if (flight === undefined) return
    this.flights.delete(ref)
    flight.signal.removeEventListener('abort', flight.abort)
    flight.reservation.settle(outcome)
    this.schedule()
  }

  private inputChanged(): void {
    if (this.mutating || this.disposed) return
    const state = this.input.state.getSnapshot()
    const refs = new Set(state.occurrences.filter(item => item.source === ANNOTATION_SOURCE).map(item => item.ref))
    for (const [ref, flight] of this.flights) {
      if (!refs.has(ref)) flight.detached = true
      else if (flight.detached) this.finish(ref, 'error')
    }
    const active = this.activeRef
    if (active !== undefined && !refs.has(active) && !this.flights.has(active)) {
      this.activeRef = undefined
      // Native deletion removes this pending attachment; an in-flight clear is reserved above.
      for (const note of readReference(active).notes) this.model.remove(note.id)
    }
    this.schedule()
  }

  private schedule(): void {
    if (this.scheduled || this.disposed) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (!this.disposed) this.synchronize()
    })
  }

  private removeOccurrence(occurrence: Occurrence): boolean {
    const state = this.input.state.getSnapshot()
    const start = detectOffset(state, occurrence.offset)
    return this.binding.ctx.bail('slash/input-consume-token', {
      guard: { kind: 'span', span: { start, end: start + 1, draftRev: state.draftRev } },
    }) === true
  }

  private synchronize(): void {
    const state = this.input.state.getSnapshot()
    if (state.phase === 'adjudicating' || state.phase === 'submitting') return
    const notes = this.model.state.getSnapshot().notes.filter(note => note.status === 'draft')
      .map(({ status: _status, ...note }) => note)
    const command = state.phase === 'claimed' || state.draft.trimStart().startsWith('/')
    const desired = notes.length === 0 || command ? undefined : JSON.stringify({ sessionId: this.binding.sessionId, notes })
    const own = state.occurrences.filter(item => item.source === ANNOTATION_SOURCE && !this.flights.has(item.ref))
    if (own.length === 1 && own[0]?.ref === desired) { this.activeRef = desired; return }
    this.mutating = true
    let attached = true
    try {
      this.activeRef = undefined
      for (const occurrence of own.toReversed()) {
        if (!this.removeOccurrence(occurrence)) { attached = false; break }
      }
      if (attached && desired !== undefined) {
        const latest = this.input.state.getSnapshot()
        const end = detectOffset(latest, latest.draft.length)
        attached = this.input.insertReference({ source: ANNOTATION_SOURCE, ref: desired,
          label: this.label(notes.length), clipboardText: referenceClipboard(desired) },
        { start: end, end, draftRev: latest.draftRev })
        if (attached) this.activeRef = desired
      }
    } finally { this.mutating = false }
    if (!attached) this.model.present({ issue: 'attachError' })
    else if (this.model.state.getSnapshot().issue === 'attachError') this.model.present({ issue: null })
  }

  private eventsChanged(): void {
    const window = this.binding.eventSource.getSnapshot()
    if (window.revision === this.eventRevision || this.flights.size === 0) return
    this.eventRevision = window.revision
    const entries = window.change.kind === 'settle-assistant'
      ? window.change.entry === undefined ? [] : [window.change.entry]
      : window.change.entries
    for (const entry of entries) this.admitted(entry)
  }

  private admitted(entry: SessionEventLikeEntry): void {
    if (entry.type !== 'event') return
    const event = entry.event
    const messages = event.type === 'user/message' ? [event.data]
      : event.type === 'agent/inbox/spliced' ? event.data.inserted : []
    for (const message of messages) {
      if (message.source.kind !== 'user') continue
      const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
      for (const [ref, flight] of this.flights) {
        if (text.includes(flight.reservation.text)) this.finish(ref, 'success')
      }
    }
  }
}
