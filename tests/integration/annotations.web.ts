/** Real Web composition: selection, annotation-only admission, and replayable labels. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterEach, beforeEach, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const packageDir = process.env.DSH_ANNOTATIONS_PACKAGE
if (packageDir === undefined) throw new Error('Run this test through scripts/run-web-test.mjs')
function chunks(text: string): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }]
}

describe('web e2e: independent annotations', () => {
  let dir: string
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleWatch: ReturnType<typeof watchConsole>
  const events: SessionEvent[] = []
  beforeEach(async ({ task }) => {
    events.length = 0
    dir = await mkdtemp(join(tmpdir(), 'dsh-annotations-web-'))
    const override = join(dir, 'replay.json')
    const fromBottom = task.name.includes('scrollport bottom')
    await writeFile(override, JSON.stringify([
      { kind: 'chunks', chunks: chunks([
        'A quoted statement needs evidence.' + (fromBottom ? ' Additional context remains within this same paragraph.'.repeat(160) : ''), 'Another paragraph remains selectable.',
        ...Array.from({ length: 32 }, (_, index) => `Context paragraph ${String(index + 1)} provides more material to review.`),
      ].join('\n\n')) },
      { kind: 'chunks', chunks: chunks('Annotation received with the original quote and your comment.') },
      { kind: 'chunks', chunks: chunks('Mixed text and annotations received.') },
    ].slice(0, task.name.startsWith('fits drafts') ? 3 : 1)))
    scaffold = await launchWebScaffold({
      replayFixture: join(dir, 'override-only.jsonl'), replayOverride: override,
      extraOverlayPath: join(packageDir, 'cordis.patch.yml'), extraInstallAnchors: [join(packageDir, 'package.json')],
    })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { events.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'annotations-e2e')
  })
  afterEach(async () => {
    try { await browser?.close() } finally {
      try { await scaffold?.close() } finally { if (dir !== undefined) await rm(dir, { recursive: true, force: true }) }
    }
  })

  async function pendingNote(longParagraph = false) {
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await composer.fill('Give me a statement to review.')
    const settled = scaffold.whenTurnSettled(30_000)
    await composer.press('Enter')
    await settled
    const quote = page.locator('[data-chat-node-key][data-chat-flow-kind="assistant-step"]')
      .getByText('A quoted statement needs evidence.', { exact: !longParagraph }).first()
    await quote.scrollIntoViewIfNeeded()
    await quote.evaluate(element => {
      const range = document.createRange()
      range.setStart(element.firstChild!, 0)
      range.setEnd(element.firstChild!, 'A quoted statement needs evidence.'.length)
      document.getSelection()?.removeAllRanges()
      document.getSelection()?.addRange(range)
    })
    await quote.dispatchEvent('mouseup')
    await page.getByRole('button', { name: 'Add to conversation', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Add a comment', exact: true })
    await editor.fill('Saved comment.')
    await editor.press('Enter')
    const dock = page.locator('[data-annotation-dock]')
    await dock.getByRole('button', { name: '1 annotations', exact: true }).click()
    const scroller = page.locator('[data-conversation-scroll]').last()
    await scroller.hover()
    await page.mouse.wheel(0, 10000)
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2)
    await expect.poll(() => quote.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThan(0)
    return { composer, quote, editor, dock, scroller }
  }

  it('focuses the comment field immediately on every edit request without moving the scrollport', async () => {
    onTestFailed(() => saveFailureShot(page, 'annotations-focus'))
    const { composer, editor, dock, scroller } = await pendingNote()
    const bottom = await scroller.evaluate(element => element.scrollTop)
    const edit = dock.getByRole('button', { name: 'Edit annotation', exact: true })
    await edit.click()
    await expect.poll(() => editor.evaluate(element => element === document.activeElement)).toBe(true)
    await page.keyboard.press('End')
    await page.keyboard.type(' Typed without another click.')
    expect(await editor.inputValue()).toBe('Saved comment. Typed without another click.')
    expect(await scroller.evaluate((element, initialTop) => Math.abs(element.scrollTop - initialTop), bottom)).toBeLessThan(2)
    await edit.click()
    await expect.poll(() => editor.evaluate(element => element === document.activeElement)).toBe(true)
    await editor.press('Escape')
    await expect.poll(() => composer.evaluate(element => element === document.activeElement)).toBe(true)
  })

  it('jumps from the scrollport bottom to the exact annotated text and retains its highlight', async () => {
    onTestFailed(() => saveFailureShot(page, 'annotations-bottom'))
    const { quote, dock, scroller } = await pendingNote(true)
    await dock.getByRole('button', { name: '1. A quoted statement needs evidence.', exact: true }).click()
    await expect.poll(() => quote.evaluate(element => {
      const range = document.createRange()
      range.setStart(element.firstChild!, 0)
      range.setEnd(element.firstChild!, 'A quoted statement needs evidence.'.length)
      const rect = range.getBoundingClientRect()
      const viewport = element.closest('[data-conversation-scroll]')!.getBoundingClientRect()
      return rect.top >= viewport.top && rect.bottom <= viewport.bottom
    })).toBe(true)
    expect(await page.evaluate(() => CSS.highlights.size)).toBeGreaterThan(0)
    // A content resize after landing must preserve the explicit reading position.
    await scroller.evaluate(element => new Promise<void>(resolve => {
      const observer = new ResizeObserver(() => {
        observer.disconnect()
        requestAnimationFrame(() => { requestAnimationFrame(() => { resolve() }) })
      })
      observer.observe(element)
      element.style.paddingBottom = '24px'
    }))
    await expect.poll(() => quote.evaluate(element => {
      const range = document.createRange()
      range.setStart(element.firstChild!, 0)
      range.setEnd(element.firstChild!, 'A quoted statement needs evidence.'.length)
      return range.getBoundingClientRect().top
    })).toBeGreaterThan(0)
    expect(await scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(100)
  })

  it('fits drafts to the composer, clears round markers and preserves historical previews and source jumps', async () => {
    onTestFailed(() => saveFailureShot(page, 'annotations'))
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await composer.fill('Give me a statement to review.')
    let settled = scaffold.whenTurnSettled(30_000)
    await composer.press('Enter')
    await settled
    const source = page.locator('[data-chat-node-key][data-chat-flow-kind="assistant-step"]').filter({ hasText: 'A quoted statement needs evidence.' }).first()
    await source.waitFor()
    expect(await page.locator('[data-dsh-assistant-text]').count()).toBe(0)
    const quote = source.getByText('A quoted statement needs evidence.', { exact: true })
    const selectSource = async (): Promise<void> => {
      await quote.scrollIntoViewIfNeeded()
      await source.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        const text = walker.nextNode()
        if (text === null) throw new Error('No source text')
        const range = document.createRange()
        range.setStart(text, 0)
        range.setEnd(text, 'A quoted statement needs evidence.'.length)
        const selection = document.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      })
      await source.dispatchEvent('mouseup')
      await page.getByRole('button', { name: 'Add to conversation', exact: true }).click()
    }
    await selectSource()
    const editor = page.getByRole('textbox', { name: 'Add a comment', exact: true })
    await editor.fill('Please provide supporting evidence.')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(async () => {
      const box = await editor.boundingBox()
      return box !== null && box.x >= 0 && box.x + box.width <= 390
    }).toBe(true)
    await page.setViewportSize({ width: 1440, height: 900 })
    await editor.press('Enter')
    const dock = page.locator('[data-annotation-dock]')
    const bubble = page.getByRole('button', { name: 'Edit annotation 1', exact: true })
    await bubble.waitFor()
    await bubble.click()
    const unsaved = 'Keep this unsaved draft while returning to the quote.'
    await editor.fill(unsaved)
    await source.getByText('Context paragraph 32 provides more material to review.', { exact: true }).scrollIntoViewIfNeeded()
    await expect.poll(() => quote.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThan(0)
    await page.getByRole('button', { name: 'Go to source', exact: true }).click()
    await expect.poll(() => quote.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.top >= 0 && rect.bottom <= window.innerHeight
    })).toBe(true)
    expect(await editor.inputValue()).toBe(unsaved)
    expect(await editor.evaluate(element => element === document.activeElement)).toBe(true)
    expect(await page.evaluate(() => CSS.highlights.size)).toBeGreaterThan(0)
    await editor.press('Escape')
    await expect.poll(() => source.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const text = walker.nextNode()!
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 'A quoted statement needs evidence.'.length)
      const rects = range.getClientRects()
      const rect = rects[rects.length - 1]!
      const marker = document.querySelector('button[aria-label="Edit annotation 1"]')!.getBoundingClientRect()
      return marker.top < rect.top && marker.bottom > rect.top
    })).toBe(true)
    await dock.getByRole('button', { name: '1 annotations', exact: true }).click()
    const verifyDock = async (): Promise<boolean> => {
      const left = await dock.boundingBox()
      const right = await page.locator('[data-composer-card]').last().boundingBox()
      return left !== null && right !== null && Math.abs(left.x - right.x) < 1 && Math.abs(left.width - right.width) < 1
    }
    await expect.poll(verifyDock).toBe(true)
    expect(await dock.getByRole('button', { name: 'Edit annotation', exact: true }).evaluate(element =>
      Number.parseFloat(getComputedStyle(element).borderTopWidth))).toBeGreaterThan(0)
    expect(await dock.getByRole('button', { name: 'Delete', exact: true }).evaluate(element =>
      Number.parseFloat(getComputedStyle(element).borderTopWidth))).toBeGreaterThan(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(verifyDock).toBe(true)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).not.toBeNull()
    expect(await dock.getByRole('button', { name: 'Edit annotation', exact: true }).evaluate((element) => {
      const style = getComputedStyle(element)
      return Number.parseFloat(style.borderTopWidth) > 0 && style.color !== style.backgroundColor
    })).toBe(true)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBeNull()
    expect(await composer.locator('[data-composer-chip="dsh-annotations"]').count()).toBe(1)
    expect(await composer.innerText()).not.toContain('Please provide supporting evidence.')
    settled = scaffold.whenTurnSettled(30_000)
    await composer.press('Enter')
    await settled
    const submitted = events.filter((event): event is SessionEvent<'user/message'> => event.type === 'user/message' && event.data.source.kind === 'user').at(-1)
    const text = submitted?.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('<dsh-annotations version="1">')
    expect(text).toContain('A quoted statement needs evidence.')
    expect(text).toContain('Please provide supporting evidence.')
    expect(await composer.innerText()).toBe('')
    const label = page.locator('[data-annotation-sent]')
    await label.waitFor()
    await expect.poll(() => bubble.count()).toBe(0)
    expect(await dock.count()).toBe(0)
    expect(await label.innerText()).toBe('1 annotations')
    await label.hover()
    await page.getByText('Please provide supporting evidence.', { exact: true }).waitFor()
    await page.mouse.move(0, 0)
    await page.reload()
    await page.locator('[data-annotation-sent]').waitFor()
    expect(await bubble.count()).toBe(0)
    await page.getByRole('button', { name: 'Jump to turn 2', exact: true }).hover()
    await page.getByRole('tooltip').filter({ hasText: 'Annotation 1: A quoted statement needs evidence.' }).waitFor()
    const turnPreview = await page.getByRole('tooltip').innerText()
    expect(turnPreview).toContain('Annotation received with the original quote and your comment.')
    expect(turnPreview).not.toContain('dsh-annotations')
    await page.mouse.move(0, 0)
    await page.locator('[data-annotation-sent]').hover()
    await page.getByText('Please provide supporting evidence.', { exact: true }).waitFor()
    await page.mouse.move(0, 0)
    await page.locator('[data-annotation-sent]').getByRole('button', { name: '1 annotations', exact: true }).click()
    await expect.poll(() => page.evaluate(() => CSS.highlights.size)).toBeGreaterThan(0)
    await selectSource()
    await editor.fill('This change should be cancelled.')
    await editor.press('Escape')
    expect(await page.locator('[data-annotation-dock]').count()).toBe(0)
    await selectSource()
    await editor.fill('A temporary note to delete.')
    await editor.press('Enter')
    await dock.getByRole('button', { name: '1 annotations', exact: true }).click()
    await dock.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.poll(() => bubble.count()).toBe(0)
    await selectSource()
    await editor.fill('Please clarify the evidence and assumptions.')
    await editor.press('Enter')
    await bubble.waitFor()
    expect(await page.getByRole('button', { name: 'Edit annotation 2', exact: true }).count()).toBe(0)
    await composer.press('Home')
    await composer.pressSequentially('Consider the revised comment.')
    expect(await composer.innerText()).toContain('Consider the revised comment.')
    expect(await composer.innerText()).not.toContain('Please clarify the evidence and assumptions.')
    settled = scaffold.whenTurnSettled(30_000)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await settled
    const mixed = events.filter((event): event is SessionEvent<'user/message'> =>
      event.type === 'user/message' && event.data.source.kind === 'user').at(-1)
    const mixedText = mixed?.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(mixedText).toMatch(/^Consider the revised comment\.[\s\S]*<dsh-annotations/)
    expect(mixedText).toContain('Please clarify the evidence and assumptions.')
    expect(mixedText).toContain('"number": 1')
    expect(text).toContain('Please provide supporting evidence.')
    expect(await composer.innerText()).toBe('')
    await page.locator('[data-annotation-sent]').last().getByRole('button', { name: '1 annotations', exact: true }).click()
    await expect.poll(() => page.evaluate(() => CSS.highlights.size)).toBeGreaterThan(0)
    await expect.poll(() => bubble.count()).toBe(0)
    expect(await page.locator('[data-annotation-sent]').count()).toBe(2)
    expect(consoleWatch.pageErrors).toEqual([])
    expect(consoleWatch.warnings.filter(text => !/connection lost/i.test(text))).toEqual([])
  })
})
