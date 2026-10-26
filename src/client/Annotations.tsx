/** Annotation overlays and compact draft and historical-message labels. */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, HoverCard, InlineEditor, useAnchoredPosition } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AnnotationNote } from './protocol.ts'
import type { AnnotationDockProps, AnnotationLabelProps, AnnotationOverlayProps } from './slots.ts'
import css from './annotations.module.css'

/**
 * Render source bubbles and the comment editor outside clipped transcript ancestors.
 * @param props - framework Session seats, live annotation view, and injected actions.
 * @returns a body portal with the current selection action and editor.
 */
export function AnnotationOverlay({
  useAnnotationState, mount, add, edit, change, save, cancel, remove, locate, t,
}: AnnotationOverlayProps) {
  const state = useAnnotationState(value => value)
  const seat = useRef<HTMLSpanElement>(null)
  useEffect(() => mount(seat.current), [mount])
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const target = state.editor ?? state.selection
  const position = useAnchoredPosition({ open: target !== null, anchorRef: anchor, panelRef: panel, side: 'top', gap: 8, margin: 8 })
  return <><span hidden ref={seat} />{createPortal(<div className={css.layer} data-annotation-ui="">
    {state.bubbles.map((bubble, index) => <button type="button" key={bubble.id} className={css.bubble}
      style={{ left: bubble.position.left + 3 + state.bubbles.slice(0, index).filter(previous =>
        Math.abs(previous.position.left - bubble.position.left) < 24
          && Math.abs(previous.position.top - bubble.position.top) < 20).length * 24,
      top: bubble.position.top - 12 }}
      aria-label={`${t('edit')} ${bubble.number}`} onClick={() => { edit(bubble.id) }}>{bubble.number}</button>)}
    {target !== null && <>
      <span ref={anchor} className={css.anchor} style={target.position} />
      <div ref={panel} className={css.popover} style={position ?? { visibility: 'hidden' }}>
        {state.editor === null
          ? <Button size="sm" onMouseDown={(event) => { event.preventDefault() }}
            onClick={add} onKeyDown={(event) => { if (event.key === 'Escape') cancel() }}>{t('add')}</Button>
          : <div className={css.editor}>
            <InlineEditor value={state.editor.comment} label={t('comment')} onChange={change}
              onSave={() => { save(state.editor?.comment ?? '') }} onCancel={cancel} />
            <div className={css.actions}>
              {state.editor.id !== undefined && <Button size="sm" variant="outline"
                onClick={() => { if (state.editor?.id !== undefined) remove(state.editor.id) }}>
                {t('delete')}</Button>}
              <Button size="sm" variant="outline" onMouseDown={(event) => { event.preventDefault() }}
                onClick={() => { if (state.editor !== null) locate(state.editor.anchor) }}>{t('locate')}</Button>
              <span className={css.spacer} />
              <Button size="sm" onClick={cancel}>{t('cancel')}</Button>
              <Button size="sm" variant="primary" disabled={state.editor.comment.trim() === ''}
                onClick={() => { save(state.editor?.comment ?? '') }}>{t('save')}</Button>
            </div>
          </div>}
      </div>
    </>}
  </div>, document.body)}</>
}

function Preview({ notes, quoteLabel, opinionLabel }: {
  notes: readonly AnnotationNote[]
  quoteLabel: string
  opinionLabel: string
}) {
  return <span className={css.preview}>{notes.map(note => <span key={note.id} className={css.note}>
    <span className={css.caption}>{note.number}. {quoteLabel}</span>
    <span className={css.quote}>{note.anchor.quote}</span>
    <span className={css.caption}>{opinionLabel}</span>
    <span className={css.opinion}>{note.comment}</span>
  </span>)}</span>
}

/**
 * Keep pending annotations separate from the ordinary Lexical draft.
 * @param props - live Session annotation state and explicit note actions.
 * @returns pending count and the optionally expanded source list.
 */
export function AnnotationDock({ useAnnotationState, edit, remove, reattach, locate, t }: AnnotationDockProps) {
  const state = useAnnotationState(value => value)
  const [expanded, setExpanded] = useState(false)
  const notes = state.notes.filter(note => note.status !== 'sent')
  if (notes.length === 0 && state.issue === null) return null
  return <div className={css.dock} data-annotation-ui="" data-annotation-dock="">
    {state.issue !== null && <p className={css.error} role="alert">{t(state.issue)}</p>}
    {notes.length > 0 && <>
      <HoverCard inline anchor={<button type="button" className={css.tag} aria-expanded={expanded}
        onClick={() => { setExpanded(value => !value) }}>{t('count', { count: notes.length })}</button>}
      content={<Preview notes={notes} quoteLabel={t('quote')} opinionLabel={t('opinion')} />} />
      {expanded && <div className={css.list}>{notes.map(note => <div key={note.id} className={css.row}>
        <button type="button" className={css.noteLink} onClick={() => { locate(note.anchor) }}>
          {note.number}. {note.anchor.quote}
        </button>
        {note.status === 'sending' ? <span>{t('sending')}</span> : note.status === 'uncertain'
          ? <div><p className={css.error}>{t('uncertain')}</p><Button size="sm" onClick={() => { reattach(note.id) }}>{t('reattach')}</Button></div>
          : <span className={css.actions}>
            <Button size="sm" variant="outline" onClick={() => { edit(note.id) }}>{t('edit')}</Button>
            <Button size="sm" variant="outline" onClick={() => { remove(note.id) }}>{t('delete')}</Button>
          </span>}
      </div>)}</div>}
    </>}
  </div>
}

/**
 * Present a logged batch as labels and hover cards, including after local data has been removed.
 * @param props - parsed original user-message snapshots and navigation action.
 * @returns compact annotation label with expandable per-note navigation.
 */
export function AnnotationLabel({ node, interactive, locate, t }: AnnotationLabelProps) {
  const [expanded, setExpanded] = useState(false)
  const { notes } = node.data
  return <span className={css.sent} data-annotation-sent="">
    <HoverCard inline anchor={<button type="button" className={css.tag} aria-expanded={expanded}
      onClick={() => {
        if (notes.length === 1 && interactive) locate((notes[0] as AnnotationNote).anchor)
        else setExpanded(value => !value)
      }}>
      {t('count', { count: notes.length })}
    </button>} content={<Preview notes={notes} quoteLabel={t('quote')} opinionLabel={t('opinion')} />} />
    {expanded && <span className={css.sentList}>{notes.map(note => <HoverCard key={note.id} inline
      anchor={<button type="button" className={css.tag} onClick={() => { if (interactive) locate(note.anchor) }}>{note.number}</button>}
      content={<Preview notes={[note]} quoteLabel={t('quote')} opinionLabel={t('opinion')} />} />)}</span>}
  </span>
}
