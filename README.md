# DSH annotations

English | [中文](README.zh.md)

Select assistant text in DSH Web, add a comment, and send it with your next message. Compact labels show the original quote and comment on hover and navigate back to the source on click.

## Compatibility

Verified against the official **DSH 0.2.1-rc.2 Web UI**. This community plugin requires no host patches or custom APIs and is not affiliated with DeepSeek. Other releases and desktop distributions are unverified.

This distribution uses native reference chips: saving a comment automatically attaches a compact label to the composer while the count and note list remain above it. Comments are never written into editable text. A label-only draft can be submitted with Enter or Send, and ordinary text can accompany it. The history navigator receives a readable annotation title.

## Use

1. Select a passage in a completed assistant reply and choose **Add to conversation**.
2. Write a comment. Enter saves, Escape cancels, and Shift+Enter inserts a newline.
3. Reopen a comment through its blue number; edit, delete, or navigate through the pending-note list.
4. Continue typing in the main composer or submit the labels alone. Sent labels expose hover previews and source navigation.

Opening or reopening **Edit annotation** focuses the comment field without scrolling the conversation. The editor’s **Go to source** action retains the unsaved comment; navigation from the bottom aligns the selected text, including inside long paragraphs. Successful admission clears this round’s blue markers and restarts the next round at 1; historical labels retain their source coordinates.

Unsent notes stay in this browser and do not synchronize between devices. Native submission failure restores reference chips. If closing the page or cancellation leaves admission uncertain, inspect the conversation before explicitly attaching the notes again. Disable other annotation plugins while using this one.

## Install

Release archives contain prebuilt artifacts and run no install scripts. Download the `.tgz` asset from this repository’s Releases and install through `dsh plugin --profile web add <archive-path> --ignore-scripts`. Follow DSH’s restart instructions and refresh the page.

## Model input

Annotations travel in one ordinary user message: optional composer text, a readable title, and a versioned `dsh-annotations` JSON text block. Each note contains its number, exact quote, source coordinates, and comment. No system or tool message is added. Quoted text consumes input tokens.

## Known limitations

- Compatibility is currently declared only for 0.2.1-rc.2. Source navigation uses that release’s existing Chat node markers; ambiguous sources retain their comments and report a navigation failure.
- Reasoning, tool cards, cross-message selections, and mobile selection gestures are unsupported. Browsers without CSS Custom Highlights retain comments without a text fill.

## Development and validation

Sources live in `src/`; `scripts/build.mjs` builds the Host entry and browser module factory. After installing development dependencies, run `pnpm run build`, `pnpm run typecheck`, and `pnpm test`. The committed `lib/` artifacts share React and services with the host.

For Web regression, separately clone and build the official 0.2.1-rc.2 checkout, set `DSH_TEST_HARNESS` to that directory, and run `pnpm run test:web`. Tests use temporary profiles, assigned ports, and recorded model replies; they access no real user data or paid model. The test adapter is created temporarily inside that isolated checkout and removed afterward.

MIT. The original DeepSeek copyright notice is retained; jin1254 maintains this community adaptation.
