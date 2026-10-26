/** Visible-text anchors over the Chat-owned assistant prose DOM protocol. */
/** Existing Chat node facts supplied by the Session's public target snapshot. */
export interface SourceNode { readonly seq: number; readonly turn: number }
/** DOM scope and settled-node lookup belonging to one mounted Conversation. */
export interface SourceAccess {
  root(): Element | null
  node(key: string): SourceNode | undefined
}
import type { AnnotationAnchor } from './protocol.ts'

interface Segment { readonly node: Text; readonly start: number; readonly end: number }
interface TextStream { readonly text: string; readonly segments: readonly Segment[] }

/**
 * Collect visible text, excluding controls and duplicate accessibility math.
 * @param root - one Chat prose block.
 * @returns text and its DOM offsets.
 */
export function textStream(root: Element): TextStream {
  const segments: Segment[] = []
  let text = ''
  const walk = (node: Node): void => {
    if (node instanceof Element) {
      if (node.matches('button,script,style,[aria-hidden="true"],.katex-mathml,[data-annotation-ui],[data-turn-process-inline]')) return
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return
    }
    if (node instanceof Text) {
      const start = text.length
      text += node.data
      segments.push({ node, start, end: text.length })
    } else for (const child of node.childNodes) walk(child)
  }
  walk(root)
  return { text, segments }
}

/**
 * Resolve a stored quote only when offsets or quote context identify it unambiguously.
 * @param root - mounted source block.
 * @param anchor - saved visible-text coordinates and context.
 * @returns matching DOM Range, or null when the quote is unavailable or ambiguous.
 */
export function locateRange(root: Element, anchor: AnnotationAnchor): Range | null {
  const { text, segments } = textStream(root)
  let start = anchor.start
  let end = anchor.end
  const contextMatches = (offset: number): boolean =>
    (anchor.prefix === '' || text.slice(0, offset).endsWith(anchor.prefix))
    && (anchor.suffix === '' || text.slice(offset + anchor.quote.length).startsWith(anchor.suffix))
  if (text.slice(start, end) !== anchor.quote || !contextMatches(start)) {
    const candidates: number[] = []
    for (let offset = text.indexOf(anchor.quote); offset >= 0; offset = text.indexOf(anchor.quote, offset + 1)) {
      if (contextMatches(offset)) candidates.push(offset)
    }
    if (candidates.length !== 1) return null
    start = candidates[0] as number
    end = start + anchor.quote.length
  }
  const first = segments.find(segment => start >= segment.start && start < segment.end)
  const last = segments.find(segment => end > segment.start && end <= segment.end)
  if (first === undefined || last === undefined) return null
  const range = document.createRange()
  range.setStart(first.node, start - first.start)
  range.setEnd(last.node, end - last.start)
  return range
}

/**
 * Capture a single settled assistant prose selection owned by this Session.
 * @param source - the mounted Conversation and its settled assistant nodes.
 * @returns durable anchor and current selection Range, or null for unsupported selections.
 */
export function selectedAnchor(source: SourceAccess): { anchor: AnnotationAnchor; range: Range } | null {
  const selection = document.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount !== 1) return null
  const range = selection.getRangeAt(0)
  const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const root = element?.closest('[data-chat-node-key][data-chat-flow-kind="assistant-step"]')
  const owner = source.root()
  if (root === null || root === undefined || owner === null || !owner.contains(root)
    || !root.contains(range.endContainer) || element?.closest('[data-turn-process-inline],button')) return null
  const nodeKey = root.getAttribute('data-chat-node-key')
  const node = nodeKey === null ? undefined : source.node(nodeKey)
  if (node === undefined || nodeKey === null) return null
  const stream = textStream(root)
  const prefix = document.createRange()
  prefix.selectNodeContents(root)
  prefix.setEnd(range.startContainer, range.startOffset)
  // Clone into a temporary element so the same exclusions apply to the selected prefix.
  const prefixRoot = document.createElement('div')
  prefixRoot.append(prefix.cloneContents())
  const start = textStream(prefixRoot).text.length
  const selectedRoot = document.createElement('div')
  selectedRoot.append(range.cloneContents())
  const quote = textStream(selectedRoot).text
  if (quote.trim() === '' || stream.text.slice(start, start + quote.length) !== quote) return null
  const end = start + quote.length
  return {
    anchor: {
      nodeKey, blockIndex: -1, seq: node.seq, turn: node.turn,
      start, end, quote, prefix: stream.text.slice(Math.max(0, start - 32), start), suffix: stream.text.slice(end, end + 32),
    },
    range: range.cloneRange(),
  }
}

/**
 * Locate a saved quote inside this Conversation's existing Chat node wrapper.
 * @param source - scoped DOM access and current settled-node metadata.
 * @param anchor - immutable quote coordinates and context.
 * @returns the unambiguous quote range, or null.
 */
export function sourceRange(source: SourceAccess, anchor: AnnotationAnchor): Range | null {
  const root = source.root()
  if (root === null || source.node(anchor.nodeKey) === undefined) return null
  const matches: Range[] = []
  for (const row of root.querySelectorAll('[data-chat-node-key][data-chat-flow-kind="assistant-step"]')) {
    if (row.getAttribute('data-chat-node-key') !== anchor.nodeKey || row.getClientRects().length === 0) continue
    const range = locateRange(row, anchor)
    if (range !== null) matches.push(range)
  }
  return matches.length === 1 ? matches[0] as Range : null
}
