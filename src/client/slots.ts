/** Derived Slot props and plain injected annotation actions. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { AnnotationAnchor, AnnotationId } from './protocol.ts'
import type { AnnotationState } from './model.ts'
import type {} from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'

/** Shared view state and Session-addressed actions supplied by the plugin. */
export interface AnnotationInjected {
  hooks: { annotationState: ObservableSnapshot<AnnotationState> }
  mount: (element: HTMLElement | null) => () => void
  add: () => void
  edit: (id: AnnotationId) => void
  change: (comment: string) => void
  save: (comment: string) => void
  cancel: () => void
  remove: (id: AnnotationId) => void
  reattach: (id: AnnotationId) => void
  locate: (anchor: AnnotationAnchor) => void
}

/** Overlay props with Session and locale seats supplied by the renderer. */
export type AnnotationOverlayProps = PropsRuntime<'conversation.input.overlay'> & InjectFace<AnnotationInjected> & PropsLocale<'annotations'>
/** Pending-note rail props, rendered above the official composer. */
export type AnnotationDockProps = PropsRuntime<'conversation.input.dock'> & InjectFace<AnnotationInjected> & PropsLocale<'annotations'>
/** Historical annotation label props; logged payloads do not depend on local drafts. */
export type AnnotationLabelProps = PropsRuntime<'conversation.user.text.node', 'annotations'> & InjectFace<Pick<AnnotationInjected, 'locate'>> & PropsLocale<'annotations'>
