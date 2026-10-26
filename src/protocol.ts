/** Replayable annotation text carried by ordinary user messages. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Browser-created identity retained in submitted annotation snapshots. */
export type AnnotationId = Branded<'AnnotationId'>

/** Source coordinates over one rendered assistant prose block's visible text. */
export const anchorSchema = z.object({
  nodeKey: z.string().min(1), blockIndex: z.number().int().min(-1),
  seq: z.number().int().nonnegative(), turn: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
  quote: z.string().min(1), prefix: z.string(), suffix: z.string(),
}).refine(value => value.end > value.start)

/** Source identity and quoted text retained independently of browser DOM. */
export type AnnotationAnchor = z.infer<typeof anchorSchema>

/** One immutable quote and opinion in a submitted user message. */
export const noteSchema = z.object({
  id: z.string().min(1).transform(value => value as AnnotationId),
  number: z.number().int().positive(), anchor: anchorSchema, comment: z.string().min(1),
})

/** Logged annotation fields interpreted by the plugin's user-message renderer. */
export type AnnotationNote = z.infer<typeof noteSchema>

const batchSchema = z.object({ notes: z.array(noteSchema).min(1) })
const OPEN = '<dsh-annotations version="1">\n'
const CLOSE = '\n</dsh-annotations>'

/**
 * Encode snapshots after ordinary user text; angle brackets inside user data are escaped.
 * @param notes - captured notes in displayed-number order.
 * @returns readable, self-contained user-message text.
 */
export function encodeNotes(notes: readonly AnnotationNote[]): string {
  return OPEN + JSON.stringify({ notes }, null, 2).replace(/</g, '\\u003c') + CLOSE
}

/**
 * Read a complete annotation block without interpreting malformed or future versions.
 * @param text - exact original user-message substring.
 * @returns validated snapshots, or undefined while preserving the original text.
 */
export function decodeNotes(text: string): readonly AnnotationNote[] | undefined {
  if (!text.startsWith(OPEN) || !text.endsWith(CLOSE)) return undefined
  try {
    const result = batchSchema.safeParse(JSON.parse(text.slice(OPEN.length, -CLOSE.length)))
    return result.success ? result.data.notes : undefined
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

/**
 * Keep the official history navigator readable without a custom host Slot.
 * @param notes - complete snapshots serialized by one native reference.
 * @returns a bounded human-readable first line.
 */
export function annotationTitle(notes: readonly AnnotationNote[]): string {
  const first = notes[0]
  const quote = first?.anchor.quote.replace(/\s+/gu, ' ').slice(0, 120) ?? ''
  return notes.length === 1 ? `Annotation ${String(first?.number)}: ${quote}` : `${String(notes.length)} annotations: ${quote}`
}
