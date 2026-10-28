/** Optional annotations using the official Conversation, Chat and reference APIs. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { AnnotationModel } from './model.ts'
import { AnnotationController } from './controller.ts'
import { annotationRule } from './protocol.ts'
import { AnnotationDock, AnnotationLabel, AnnotationOverlay } from './Annotations.tsx'
import type { AnnotationInjected } from './slots.ts'
import { en, zh } from './locales.ts'
import { ANNOTATION_SOURCE, NativeComposer, readReference, referenceClipboard } from './native-composer.ts'

/** All required services are shipped by official DSH Web 0.2.1-rc.2. */
export const inject = ['slots', 'sessions', 'locale', 'conversation', 'uiConversation', 'inputTriggers']

interface SessionAnnotations {
  readonly controller: AnnotationController
  readonly composer: NativeComposer
  readonly face: AnnotationInjected
}

/**
 * Register selection overlays and native annotation reference serialization.
 * @param ctx - plugin-owned browser scope.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('annotations', { zh, en }), 'annotations: dictionaries')
  const t = ctx.locale.bind('annotations')
  const controllers = new WeakMap<SessionBinding, SessionAnnotations>()
  const recordFor = (sessionId: SessionId): SessionAnnotations => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error('Annotations require a retained Session')
    const existing = controllers.get(binding)
    if (existing !== undefined) return existing
    const input = ctx.conversation.input.for(binding.ctx)
    let storage: Pick<Storage, 'getItem' | 'setItem'>
    try { storage = localStorage } catch (error) {
      storage = { getItem: () => { throw error }, setItem: () => { throw error } }
    }
    const model = new AnnotationModel(sessionId, storage)
    const chat = ctx.uiConversation.binding(binding).target('chat')
    let seat: HTMLElement | null = null
    const source = {
      root: (): Element | null => seat?.closest('[data-conversation-content]') ?? null,
      node: (key: string) => {
        const node = chat.getSnapshot()?.nodes.get(key)
        if (node?.kind !== 'assistant-step') return undefined
        const assistant = node as ChatNode<'assistant-step'>
        if (assistant.data.status !== 'settled' || assistant.data.finalNode === undefined) return undefined
        return { seq: assistant.data.finalNode.seq, turn: assistant.data.turn }
      },
    }
    const controller = new AnnotationController(source, model, seq => binding.session.loadThrough(seq), () => { input.focus() })
    const composer = new NativeComposer(binding, input, model, count => t('count', { count }))
    const face: AnnotationInjected = {
      hooks: { annotationState: model.state },
      mount: (element) => { seat = element; return controller.mount() },
      add: () => { controller.add() }, edit: id => { controller.edit(id) },
      change: (comment) => {
        const editor = model.state.getSnapshot().editor
        if (editor !== null) model.present({ editor: { ...editor, comment } })
      },
      save: comment => { controller.save(comment) }, cancel: () => { controller.cancel() },
      remove: id => { controller.remove(id) }, reattach: id => { model.reattach(id) },
      locate: anchor => { void controller.locate(anchor) },
    }
    const record = { controller, composer, face }
    controllers.set(binding, record)
    let disposed = false
    const cleanup = (): void => {
      if (disposed) return
      disposed = true
      composer.dispose()
      controller.dispose()
      controllers.delete(binding)
      void stopSession()
    }
    const stopPlugin = ctx.effect(() => cleanup, 'annotations: Session integration')
    const stopSession = binding.ctx.effect(() => () => { void stopPlugin() }, 'annotations: retained Session')
    return record
  }
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: '@', name: ANNOTATION_SOURCE,
    candidates: async () => [], onPick: () => undefined,
    codec: {
      clipboardText: referenceClipboard,
      serialize: async (ref, signal) => {
        const value = readReference(ref)
        return recordFor(value.sessionId as SessionId).composer.serialize(ref, signal)
      },
    },
    openReference: (session, reference) => {
      const value = readReference(reference.ref)
      if (value.sessionId !== session.sessionId) return false
      if (value.notes.length === 0) return false
      const model = recordFor(session.sessionId).controller.model
      model.present({ expanded: !model.state.getSnapshot().expanded })
      return true
    },
  }), 'annotations: native references')
  ctx.effect(() => ctx.uiConversation.userText.register(annotationRule), 'annotations: user text rule')
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: ANNOTATION_SOURCE, order: 20, locale: 'annotations',
    inject: sessionId => recordFor(sessionId).face,
  }, AnnotationOverlay))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: ANNOTATION_SOURCE, order: 20, locale: 'annotations',
    inject: sessionId => recordFor(sessionId).face,
  }, AnnotationDock))
  ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
    name: 'conversation.user.text.node', key: 'annotations', locale: 'annotations',
    inject: sessionId => ({ locate: recordFor(sessionId).face.locate }),
  }, AnnotationLabel))
}
