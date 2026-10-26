/** DOM selection, numbered source markers, and navigation for one Session. */
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { selectedAnchor, sourceRange } from './anchors.ts'
import type { SourceAccess } from './anchors.ts'
import type { AnnotationAnchor, AnnotationId } from './protocol.ts'
import type { AnnotationModel, AnnotationPosition } from './model.ts'

/** Owns document listeners only while a Session's annotation surface is mounted. */
export class AnnotationController {
  private mounts = 0
  private cleanup: (() => void) | undefined
  private frame = 0
  private flashTimer: ReturnType<typeof setTimeout> | undefined
  private active: AnnotationAnchor | undefined
  private disposed = false
  private readonly highlightName = `dsh-annotation-${crypto.randomUUID()}`

  /**
   * @param source - current Conversation DOM and settled assistant node lookup.
   * @param model - annotation drafts and view state.
   * @param loadThrough - existing Session history loader.
   * @param focusComposer - restore the main editor after saving or cancelling a comment.
   */
  constructor(
    private readonly source: SourceAccess,
    readonly model: AnnotationModel,
    private readonly loadThrough: (seq: SessionSeq) => Promise<void>,
    private readonly focusComposer: () => void,
  ) {}

  /**
   * Observe source layout and selection while at least one surface is mounted.
   * @returns disposer releasing this mount and its listeners.
   */
  mount(): () => void {
    if (this.disposed) return () => {}
    this.mounts++
    if (this.mounts === 1) {
      const onSelection = (event: Event): void => {
        if (event.target instanceof Element && event.target.closest('[data-annotation-ui]')) return
        if (this.model.state.getSnapshot().editor !== null) return
        const selected = selectedAnchor(this.source)
        this.model.present({ selection: selected === null ? null : { anchor: selected.anchor, position: this.position(selected.range) } })
      }
      const onOutside = (event: Event): void => {
        if (event.target instanceof Element && event.target.closest('[data-annotation-ui]')) return
        this.active = undefined
        this.model.present({ editor: null, selection: null })
      }
      const schedule = (): void => {
        if (this.frame !== 0) return
        this.frame = requestAnimationFrame(() => { this.frame = 0; this.refresh() })
      }
      const observer = new MutationObserver((records) => {
        if (records.some((record) => {
          const target = record.target instanceof Element ? record.target : record.target.parentElement
          return target?.closest('[data-annotation-ui]') === null
        })) schedule()
      })
      observer.observe(document.body, { subtree: true, childList: true, characterData: true })
      document.addEventListener('mouseup', onSelection)
      document.addEventListener('keyup', onSelection)
      document.addEventListener('pointerdown', onOutside)
      window.addEventListener('scroll', schedule, true)
      window.addEventListener('resize', schedule)
      const off = this.model.state.subscribe(schedule)
      const style = document.createElement('style')
      style.textContent = `::highlight(${this.highlightName}) { background-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 25%, transparent); }`
      document.head.append(style)
      this.cleanup = () => {
        off()
        observer.disconnect()
        document.removeEventListener('mouseup', onSelection)
        document.removeEventListener('keyup', onSelection)
        document.removeEventListener('pointerdown', onOutside)
        window.removeEventListener('scroll', schedule, true)
        window.removeEventListener('resize', schedule)
        cancelAnimationFrame(this.frame)
        this.frame = 0
        clearTimeout(this.flashTimer)
        style.remove()
        if (typeof CSS !== 'undefined' && 'highlights' in CSS) CSS.highlights.delete(this.highlightName)
      }
      this.refresh()
    }
    let released = false
    return () => {
      if (released) return
      released = true
      this.mounts--
      if (this.mounts === 0) { this.cleanup?.(); this.cleanup = undefined }
    }
  }

  /** Open the selected source's comment editor. */
  add(): void {
    const selected = this.model.state.getSnapshot().selection
    if (selected === null) return
    this.active = selected.anchor
    this.model.create(selected.anchor, selected.position)
    document.getSelection()?.removeAllRanges()
    this.refresh()
  }

  /**
   * Open a pending note at its source.
   * @param id - local annotation identity.
   */
  edit(id: AnnotationId): void {
    const note = this.model.state.getSnapshot().notes.find(item => item.id === id)
    if (note === undefined) return
    const range = sourceRange(this.source, note.anchor)
    if (range === null) { void this.locate(note.anchor).then(() => { this.editLocated(id) }); return }
    this.active = note.anchor
    this.model.edit(id, this.position(range))
    this.refresh()
  }

  private editLocated(id: AnnotationId): void {
    if (this.inactive()) return
    const note = this.model.state.getSnapshot().notes.find(item => item.id === id)
    const range = note === undefined ? null : sourceRange(this.source, note.anchor)
    if (note !== undefined && range !== null) { this.active = note.anchor; this.model.edit(id, this.position(range)); this.refresh() }
  }

  /**
   * Commit the current editor and return focus to the ordinary composer.
   * @param comment - explicit user comment.
   */
  save(comment: string): void {
    if (!this.model.save(comment)) return
    this.active = undefined
    this.focusComposer()
    this.refresh()
  }

  /**
   * Remove a local source marker without changing submitted user messages.
   * @param id - note to remove.
   */
  remove(id: AnnotationId): void {
    this.active = undefined
    this.model.remove(id)
    this.focusComposer()
    this.refresh()
  }

  /** Cancel without modifying a saved annotation. */
  cancel(): void {
    this.model.present({ editor: null, selection: null })
    this.active = undefined
    this.focusComposer()
    this.refresh()
  }

  /**
   * Load old history, reveal enclosing Chat disclosures, scroll to and emphasize the quote.
   * @param anchor - frozen source coordinates from a draft or logged user message.
   */
  async locate(anchor: AnnotationAnchor): Promise<void> {
    try {
      await this.loadThrough(anchor.seq as SessionSeq)
      if (this.inactive()) return
      // Chat listens for focus events to reveal folded process and Turn ancestors.
      const node = [...(this.source.root()?.querySelectorAll('[data-chat-node-key]') ?? [])]
        .find(element => element.getAttribute('data-chat-node-key') === anchor.nodeKey)
      node?.dispatchEvent(new Event('beforematch', { bubbles: true }))
      await new Promise<void>(resolve => requestAnimationFrame(() => { resolve() }))
      if (this.inactive()) return
      const range = sourceRange(this.source, anchor)
      if (range === null) { this.model.present({ issue: 'locateError' }); return }
      const parent = range.startContainer.parentElement
      const scroller = parent?.closest<HTMLElement>('[data-conversation-scroll]')
      if (scroller === null || scroller === undefined) parent?.scrollIntoView({ block: 'center', behavior: 'instant' })
      else {
        const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
        const viewport = scroller.getBoundingClientRect()
        // Center the selected line, even when its enclosing paragraph exceeds the viewport.
        scroller.scrollTo({ top: scroller.scrollTop + rect.top - viewport.top - (scroller.clientHeight - rect.height) / 2,
          behavior: 'instant' })
      }
      this.active = anchor
      this.model.present({ issue: null })
      this.refresh()
      clearTimeout(this.flashTimer)
      this.flashTimer = setTimeout(() => { this.active = undefined; this.refresh() }, 1800)
    } catch (error) {
      console.error('[annotations] Source navigation failed', error)
      if (!this.disposed) this.model.present({ issue: 'locateError' })
    }
  }

  /** Release observers, frames, timers, and this Session's highlight registration. */
  dispose(): void {
    this.disposed = true
    this.cleanup?.()
    this.cleanup = undefined
  }

  private inactive(): boolean { return this.disposed || this.mounts === 0 }

  private position(range: Range): AnnotationPosition {
    const rects = range.getClientRects()
    const rect = rects[rects.length - 1] ?? range.getBoundingClientRect()
    return { left: rect.right, top: rect.top }
  }

  private refresh(): void {
    if (this.inactive()) return
    const state = this.model.state.getSnapshot()
    const bubbles = state.notes.flatMap((note) => {
      const range = sourceRange(this.source, note.anchor)
      return range === null ? [] : [{ id: note.id, number: note.number, position: this.position(range) }]
    })
    const highlight = this.active ?? state.editor?.anchor
    if (typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined') {
      const range = highlight === undefined ? null : sourceRange(this.source, highlight)
      if (range === null) CSS.highlights.delete(this.highlightName)
      else CSS.highlights.set(this.highlightName, new Highlight(range))
    }
    const editor = state.editor
    const editorRange = editor === null ? null : sourceRange(this.source, editor.anchor)
    let nextEditor = editor
    if (editor !== null && editorRange !== null) {
      const position = this.position(editorRange)
      if (position.left !== editor.position.left || position.top !== editor.position.top) nextEditor = { ...editor, position }
    }
    if (JSON.stringify(bubbles) !== JSON.stringify(state.bubbles) || nextEditor !== editor) {
      this.model.present({ bubbles, editor: nextEditor })
    }
  }
}
