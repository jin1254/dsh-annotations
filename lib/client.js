window.__ModuleLoader__.load({id:"@jin1254/dsh-annotations",factory:(require)=>{var module={exports:{}};var exports=module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/model.ts
var import_dsh_client_store = require("@deepseek-ai/dsh-client-store");
var import_zod2 = require("zod");

// src/protocol.ts
var import_zod = require("zod");
var anchorSchema = import_zod.z.object({
  nodeKey: import_zod.z.string().min(1),
  blockIndex: import_zod.z.number().int().min(-1),
  seq: import_zod.z.number().int().nonnegative(),
  turn: import_zod.z.number().int().nonnegative(),
  start: import_zod.z.number().int().nonnegative(),
  end: import_zod.z.number().int().positive(),
  quote: import_zod.z.string().min(1),
  prefix: import_zod.z.string(),
  suffix: import_zod.z.string()
}).refine((value) => value.end > value.start);
var noteSchema = import_zod.z.object({
  id: import_zod.z.string().min(1).transform((value) => value),
  number: import_zod.z.number().int().positive(),
  anchor: anchorSchema,
  comment: import_zod.z.string().min(1)
});
var batchSchema = import_zod.z.object({ notes: import_zod.z.array(noteSchema).min(1) });
var OPEN = '<dsh-annotations version="1">\n';
var CLOSE = "\n</dsh-annotations>";
function encodeNotes(notes) {
  return OPEN + JSON.stringify({ notes }, null, 2).replace(/</g, "\\u003c") + CLOSE;
}
function decodeNotes(text) {
  if (!text.startsWith(OPEN) || !text.endsWith(CLOSE)) return void 0;
  try {
    const result = batchSchema.safeParse(JSON.parse(text.slice(OPEN.length, -CLOSE.length)));
    return result.success ? result.data.notes : void 0;
  } catch (error) {
    if (error instanceof SyntaxError) return void 0;
    throw error;
  }
}
function annotationTitle(notes) {
  const first = notes[0];
  const quote = first?.anchor.quote.replace(/\s+/gu, " ").slice(0, 120) ?? "";
  return notes.length === 1 ? `Annotation ${String(first?.number)}: ${quote}` : `${String(notes.length)} annotations: ${quote}`;
}

// src/client/protocol.ts
var OPEN2 = '<dsh-annotations version="1">\n';
var CLOSE2 = "\n</dsh-annotations>";
var annotationRule = {
  id: "annotations",
  order: -10,
  match(text, from) {
    for (let start = text.indexOf(OPEN2, from); start >= 0; start = text.indexOf(OPEN2, start + OPEN2.length)) {
      const closing = text.indexOf(CLOSE2, start + OPEN2.length);
      if (closing < 0) return void 0;
      const end = closing + CLOSE2.length;
      const notes = decodeNotes(text.slice(start, end));
      if (notes !== void 0) {
        const header = `${annotationTitle(notes)}

`;
        const headerStart = start - header.length;
        if (headerStart >= from && text.slice(headerStart, start) === header) start = headerStart;
        return { id: "annotations", start, end, data: { notes } };
      }
    }
    return void 0;
  }
};

// src/client/model.ts
var localNoteSchema = noteSchema.extend({ status: import_zod2.z.enum(["draft", "sending", "sent", "uncertain"]) });
var storedSchema = import_zod2.z.object({ version: import_zod2.z.literal(1), notes: import_zod2.z.array(localNoteSchema) });
var legacySchema = import_zod2.z.object({ annotations: import_zod2.z.array(import_zod2.z.object({
  id: import_zod2.z.string(),
  nodeKey: import_zod2.z.string().min(1),
  turn: import_zod2.z.number().nullable(),
  start: import_zod2.z.number().int().nonnegative(),
  end: import_zod2.z.number().int().positive(),
  quote: import_zod2.z.string().min(1),
  prefix: import_zod2.z.string(),
  suffix: import_zod2.z.string(),
  comment: import_zod2.z.string()
})) });
var AnnotationModel = class {
  /**
   * @param sessionId - owning Session identity.
   * @param storage - browser-local persistence; tests provide an isolated adapter.
   */
  constructor(sessionId, storage) {
    this.storage = storage;
    this.key = `dsh-annotations/v1/${sessionId}`;
    try {
      const raw = storage.getItem(this.key);
      let notes;
      if (raw === null) {
        const legacy = storage.getItem(`dsh-annotate/v1/${sessionId}`);
        notes = legacy === null ? [] : legacySchema.parse(JSON.parse(legacy)).annotations.filter((note) => note.comment.trim() !== "").map((note, index) => ({
          id: note.id,
          number: index + 1,
          comment: note.comment,
          status: "draft",
          anchor: {
            nodeKey: note.nodeKey,
            start: note.start,
            end: note.end,
            quote: note.quote,
            prefix: note.prefix,
            suffix: note.suffix,
            blockIndex: -1,
            seq: 0,
            turn: note.turn ?? 0
          }
        }));
      } else notes = storedSchema.parse(JSON.parse(raw)).notes;
      const pending = notes.filter((note) => note.status !== "sent").map((note, index) => ({
        ...note,
        number: index + 1,
        status: note.status === "sending" ? "uncertain" : note.status
      }));
      this.state.set({ ...this.state.getSnapshot(), notes: pending });
      this.pending.set(pending.some((note) => note.status === "draft"));
    } catch (error) {
      this.persistenceReadable = false;
      this.state.set({ ...this.state.getSnapshot(), issue: "loadError" });
      console.error("[annotations] Saved notes could not be read; original data retained", error);
    }
  }
  storage;
  /** Current drafts and shared overlay state. */
  state = (0, import_dsh_client_store.createSnapshotStore)({ notes: [], editor: null, selection: null, bubbles: [], issue: null });
  /** Readiness source observed by the native composer. */
  pending = (0, import_dsh_client_store.createSnapshotStore)(false);
  /** Session-local producer for ordinary user-message submissions. */
  contribution = { pending: this.pending, capture: () => this.reserve(this.state.getSnapshot().notes.filter((note) => note.status === "draft")) };
  key;
  persistenceReadable = true;
  /**
   * Publish interaction-only fields without writing browser storage.
   * @param patch - editor, selection, bubble, or visible issue changes.
   */
  present(patch) {
    const previous = this.state.getSnapshot();
    const persistent = previous.issue === "storageError" || previous.issue === "loadError";
    this.state.set({ ...previous, ...patch, ...persistent ? { issue: previous.issue } : {} });
  }
  /**
   * Open a new comment without adding it to the next message until explicitly saved.
   * @param anchor - selected source snapshot.
   * @param position - viewport anchor for the editor.
   */
  create(anchor, position) {
    this.present({ selection: null, editor: { anchor, position, comment: "" } });
  }
  /**
   * Open a saved annotation; sending reservations cannot be modified.
   * @param id - browser-local annotation identity.
   * @param position - current viewport location.
   */
  edit(id, position) {
    const note = this.state.getSnapshot().notes.find((item) => item.id === id);
    if (note === void 0 || note.status === "sending" || note.status === "uncertain") return;
    this.present({ selection: null, editor: { id, anchor: note.anchor, comment: note.comment, position } });
  }
  /**
   * Save a nonempty comment as pending, retaining the source number on subsequent edits.
   * @param comment - current editor value.
   * @returns whether the editor was committed.
   */
  save(comment) {
    const state = this.state.getSnapshot();
    if (state.editor === null || comment.trim() === "" || !this.persistenceReadable) return false;
    const { editor } = state;
    const previous = state.notes.find((note2) => note2.id === editor.id);
    if (previous?.status === "sending" || previous?.status === "uncertain") return false;
    const note = {
      id: editor.id ?? crypto.randomUUID(),
      number: previous?.number ?? Math.max(0, ...state.notes.map((item) => item.number)) + 1,
      anchor: editor.anchor,
      comment: comment.trim(),
      status: "draft"
    };
    this.commit([...state.notes.filter((item) => item.id !== note.id), note].sort((a, b) => a.number - b.number), { editor: null });
    return true;
  }
  /**
   * Remove a draft; historical messages are never rewritten.
   * @param id - annotation to remove.
   */
  remove(id) {
    const state = this.state.getSnapshot();
    const note = state.notes.find((item) => item.id === id);
    if (note === void 0 || note.status === "sending" || note.status === "uncertain") return;
    this.commit(state.notes.filter((item) => item.id !== id), { editor: state.editor?.id === id ? null : state.editor });
  }
  /**
   * Explicitly reattach a batch whose admission could not be established after a reload.
   * @param id - note the user elected to send again after inspecting history.
   */
  reattach(id) {
    this.commit(this.state.getSnapshot().notes.map((note) => note.id === id && note.status === "uncertain" ? { ...note, status: "draft" } : note));
  }
  commit(notes, patch = {}) {
    const previous = this.state.getSnapshot();
    let issue = previous.issue === "storageError" ? null : previous.issue;
    try {
      this.storage.setItem(this.key, JSON.stringify({ version: 1, notes }));
    } catch (error) {
      issue = "storageError";
      console.error("[annotations] Browser persistence failed; notes retained in memory", error);
    }
    this.state.set({ ...previous, ...patch, notes, issue });
    this.pending.set(notes.some((note) => note.status === "draft"));
  }
  /**
   * Reserve the exact notes frozen in a native reference chip.
   * @param notes - validated snapshots from the chip being serialized.
   * @returns an idempotent admission settlement for this batch.
   */
  reserve(notes) {
    const current = this.state.getSnapshot().notes;
    for (const note of notes) {
      const live = current.find((item) => item.id === note.id);
      if (live === void 0 || live.status !== "draft" || live.comment !== note.comment || JSON.stringify(live.anchor) !== JSON.stringify(note.anchor)) {
        throw new Error("The annotation reference is outdated. Review the pending annotations before sending.");
      }
    }
    const snapshots = notes.map((note) => structuredClone(note));
    const ids = new Set(notes.map((note) => note.id));
    const text = encodeNotes(snapshots);
    this.commit(this.state.getSnapshot().notes.map((note) => ids.has(note.id) ? { ...note, status: "sending" } : note));
    let settled = false;
    return { text, settle: (outcome) => {
      if (settled) return;
      settled = true;
      const current2 = this.state.getSnapshot().notes;
      this.commit(outcome === "success" ? current2.filter((note) => !ids.has(note.id)).map((note, index) => ({ ...note, number: index + 1 })) : current2.map((note) => ids.has(note.id) ? { ...note, status: outcome === "cancelled" ? "uncertain" : "draft" } : note));
    } };
  }
};

// src/client/anchors.ts
function textStream(root) {
  const segments = [];
  let text = "";
  const walk = (node) => {
    if (node instanceof Element) {
      if (node.matches('button,script,style,[aria-hidden="true"],.katex-mathml,[data-annotation-ui],[data-turn-process-inline]')) return;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return;
    }
    if (node instanceof Text) {
      const start = text.length;
      text += node.data;
      segments.push({ node, start, end: text.length });
    } else for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return { text, segments };
}
function locateRange(root, anchor) {
  const { text, segments } = textStream(root);
  let start = anchor.start;
  let end = anchor.end;
  const contextMatches = (offset) => (anchor.prefix === "" || text.slice(0, offset).endsWith(anchor.prefix)) && (anchor.suffix === "" || text.slice(offset + anchor.quote.length).startsWith(anchor.suffix));
  if (text.slice(start, end) !== anchor.quote || !contextMatches(start)) {
    const candidates = [];
    for (let offset = text.indexOf(anchor.quote); offset >= 0; offset = text.indexOf(anchor.quote, offset + 1)) {
      if (contextMatches(offset)) candidates.push(offset);
    }
    if (candidates.length !== 1) return null;
    start = candidates[0];
    end = start + anchor.quote.length;
  }
  const first = segments.find((segment) => start >= segment.start && start < segment.end);
  const last = segments.find((segment) => end > segment.start && end <= segment.end);
  if (first === void 0 || last === void 0) return null;
  const range = document.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}
function selectedAnchor(source) {
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const root = element?.closest('[data-chat-node-key][data-chat-flow-kind="assistant-step"]');
  const owner = source.root();
  if (root === null || root === void 0 || owner === null || !owner.contains(root) || !root.contains(range.endContainer) || element?.closest("[data-turn-process-inline],button")) return null;
  const nodeKey = root.getAttribute("data-chat-node-key");
  const node = nodeKey === null ? void 0 : source.node(nodeKey);
  if (node === void 0 || nodeKey === null) return null;
  const stream = textStream(root);
  const prefix = document.createRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const prefixRoot = document.createElement("div");
  prefixRoot.append(prefix.cloneContents());
  const start = textStream(prefixRoot).text.length;
  const selectedRoot = document.createElement("div");
  selectedRoot.append(range.cloneContents());
  const quote = textStream(selectedRoot).text;
  if (quote.trim() === "" || stream.text.slice(start, start + quote.length) !== quote) return null;
  const end = start + quote.length;
  return {
    anchor: {
      nodeKey,
      blockIndex: -1,
      seq: node.seq,
      turn: node.turn,
      start,
      end,
      quote,
      prefix: stream.text.slice(Math.max(0, start - 32), start),
      suffix: stream.text.slice(end, end + 32)
    },
    range: range.cloneRange()
  };
}
function sourceRange(source, anchor) {
  const root = source.root();
  if (root === null || source.node(anchor.nodeKey) === void 0) return null;
  const matches = [];
  for (const row of root.querySelectorAll('[data-chat-node-key][data-chat-flow-kind="assistant-step"]')) {
    if (row.getAttribute("data-chat-node-key") !== anchor.nodeKey || row.getClientRects().length === 0) continue;
    const range = locateRange(row, anchor);
    if (range !== null) matches.push(range);
  }
  return matches.length === 1 ? matches[0] : null;
}

// src/client/controller.ts
var AnnotationController = class {
  /**
   * @param source - current Conversation DOM and settled assistant node lookup.
   * @param model - annotation drafts and view state.
   * @param loadThrough - existing Session history loader.
   * @param focusComposer - restore the main editor after saving or cancelling a comment.
   */
  constructor(source, model, loadThrough, focusComposer) {
    this.source = source;
    this.model = model;
    this.loadThrough = loadThrough;
    this.focusComposer = focusComposer;
  }
  source;
  model;
  loadThrough;
  focusComposer;
  mounts = 0;
  cleanup;
  frame = 0;
  flashTimer;
  active;
  disposed = false;
  highlightName = `dsh-annotation-${crypto.randomUUID()}`;
  /**
   * Observe source layout and selection while at least one surface is mounted.
   * @returns disposer releasing this mount and its listeners.
   */
  mount() {
    if (this.disposed) return () => {
    };
    this.mounts++;
    if (this.mounts === 1) {
      const onSelection = (event) => {
        if (event.target instanceof Element && event.target.closest("[data-annotation-ui]")) return;
        if (this.model.state.getSnapshot().editor !== null) return;
        const selected = selectedAnchor(this.source);
        this.model.present({ selection: selected === null ? null : { anchor: selected.anchor, position: this.position(selected.range) } });
      };
      const onOutside = (event) => {
        if (event.target instanceof Element && event.target.closest("[data-annotation-ui]")) return;
        this.active = void 0;
        this.model.present({ editor: null, selection: null });
      };
      const schedule = () => {
        if (this.frame !== 0) return;
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          this.refresh();
        });
      };
      const observer = new MutationObserver((records) => {
        if (records.some((record) => {
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          return target?.closest("[data-annotation-ui]") === null;
        })) schedule();
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      document.addEventListener("mouseup", onSelection);
      document.addEventListener("keyup", onSelection);
      document.addEventListener("pointerdown", onOutside);
      window.addEventListener("scroll", schedule, true);
      window.addEventListener("resize", schedule);
      const off = this.model.state.subscribe(schedule);
      const style = document.createElement("style");
      style.textContent = `::highlight(${this.highlightName}) { background-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 25%, transparent); }`;
      document.head.append(style);
      this.cleanup = () => {
        off();
        observer.disconnect();
        document.removeEventListener("mouseup", onSelection);
        document.removeEventListener("keyup", onSelection);
        document.removeEventListener("pointerdown", onOutside);
        window.removeEventListener("scroll", schedule, true);
        window.removeEventListener("resize", schedule);
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        clearTimeout(this.flashTimer);
        style.remove();
        if (typeof CSS !== "undefined" && "highlights" in CSS) CSS.highlights.delete(this.highlightName);
      };
      this.refresh();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.mounts--;
      if (this.mounts === 0) {
        this.cleanup?.();
        this.cleanup = void 0;
      }
    };
  }
  /** Open the selected source's comment editor. */
  add() {
    const selected = this.model.state.getSnapshot().selection;
    if (selected === null) return;
    this.active = selected.anchor;
    this.model.create(selected.anchor, selected.position);
    document.getSelection()?.removeAllRanges();
    this.refresh();
  }
  /**
   * Open a pending note at its source.
   * @param id - local annotation identity.
   */
  edit(id) {
    const note = this.model.state.getSnapshot().notes.find((item) => item.id === id);
    if (note === void 0) return;
    const range = sourceRange(this.source, note.anchor);
    if (range === null) {
      void this.locate(note.anchor).then(() => {
        this.editLocated(id);
      });
      return;
    }
    this.active = note.anchor;
    this.model.edit(id, this.position(range));
    this.refresh();
  }
  editLocated(id) {
    if (this.inactive()) return;
    const note = this.model.state.getSnapshot().notes.find((item) => item.id === id);
    const range = note === void 0 ? null : sourceRange(this.source, note.anchor);
    if (note !== void 0 && range !== null) {
      this.active = note.anchor;
      this.model.edit(id, this.position(range));
      this.refresh();
    }
  }
  /**
   * Commit the current editor and return focus to the ordinary composer.
   * @param comment - explicit user comment.
   */
  save(comment) {
    if (!this.model.save(comment)) return;
    this.active = void 0;
    this.focusComposer();
    this.refresh();
  }
  /**
   * Remove a local source marker without changing submitted user messages.
   * @param id - note to remove.
   */
  remove(id) {
    this.active = void 0;
    this.model.remove(id);
    this.focusComposer();
    this.refresh();
  }
  /** Cancel without modifying a saved annotation. */
  cancel() {
    this.model.present({ editor: null, selection: null });
    this.active = void 0;
    this.focusComposer();
    this.refresh();
  }
  /**
   * Load old history, reveal enclosing Chat disclosures, scroll to and emphasize the quote.
   * @param anchor - frozen source coordinates from a draft or logged user message.
   */
  async locate(anchor) {
    try {
      await this.loadThrough(anchor.seq);
      if (this.inactive()) return;
      const node = [...this.source.root()?.querySelectorAll("[data-chat-node-key]") ?? []].find((element) => element.getAttribute("data-chat-node-key") === anchor.nodeKey);
      node?.dispatchEvent(new Event("beforematch", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => {
        resolve();
      }));
      if (this.inactive()) return;
      const range = sourceRange(this.source, anchor);
      if (range === null) {
        this.model.present({ issue: "locateError" });
        return;
      }
      const parent = range.startContainer.parentElement;
      parent?.scrollIntoView({ block: "center", behavior: "smooth" });
      this.active = anchor;
      this.model.present({ issue: null });
      this.refresh();
      clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => {
        this.active = void 0;
        this.refresh();
      }, 1800);
    } catch (error) {
      console.error("[annotations] Source navigation failed", error);
      if (!this.disposed) this.model.present({ issue: "locateError" });
    }
  }
  /** Release observers, frames, timers, and this Session's highlight registration. */
  dispose() {
    this.disposed = true;
    this.cleanup?.();
    this.cleanup = void 0;
  }
  inactive() {
    return this.disposed || this.mounts === 0;
  }
  position(range) {
    const rects = range.getClientRects();
    const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
    return { left: rect.right, top: rect.top };
  }
  refresh() {
    if (this.inactive()) return;
    const state = this.model.state.getSnapshot();
    const bubbles = state.notes.flatMap((note) => {
      const range = sourceRange(this.source, note.anchor);
      return range === null ? [] : [{ id: note.id, number: note.number, position: this.position(range) }];
    });
    const highlight = this.active ?? state.editor?.anchor;
    if (typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined") {
      const range = highlight === void 0 ? null : sourceRange(this.source, highlight);
      if (range === null) CSS.highlights.delete(this.highlightName);
      else CSS.highlights.set(this.highlightName, new Highlight(range));
    }
    const editor = state.editor;
    const editorRange = editor === null ? null : sourceRange(this.source, editor.anchor);
    let nextEditor = editor;
    if (editor !== null && editorRange !== null) {
      const position = this.position(editorRange);
      if (position.left !== editor.position.left || position.top !== editor.position.top) nextEditor = { ...editor, position };
    }
    if (JSON.stringify(bubbles) !== JSON.stringify(state.bubbles) || nextEditor !== editor) {
      this.model.present({ bubbles, editor: nextEditor });
    }
  }
};

// src/client/Annotations.tsx
var import_react = require("react");
var import_react_dom = require("react-dom");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/annotations.module.css
if (!document.querySelector("style[data-plugin-css=" + JSON.stringify("@jin1254/dsh-annotations/annotations.module.css") + "]")) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@jin1254/dsh-annotations";
  tag.dataset.pluginCss = "@jin1254/dsh-annotations/annotations.module.css";
  tag.textContent = ".dsh_ann_layer_7gI2oG{pointer-events:none;z-index:110;position:fixed;inset:0}.dsh_ann_layer_7gI2oG button,.dsh_ann_popover_7gI2oG{pointer-events:auto}.dsh_ann_anchor_7gI2oG{width:0;height:0;position:fixed}.dsh_ann_popover_7gI2oG{border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);max-width:calc(100vw - 16px);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-panel);position:fixed}.dsh_ann_editor_7gI2oG{box-sizing:border-box;width:min(360px,100vw - 16px);padding:12px}.dsh_ann_actions_7gI2oG{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.dsh_ann_spacer_7gI2oG{flex:1}.dsh_ann_bubble_7gI2oG{border:1px solid var(--dsw-alias-bg-layer-1);corner-shape:round;background:var(--dsw-alias-state-business-primary);width:22px;height:22px;color:var(--dsw-static-neutral-bluish-00);cursor:pointer;border-radius:50%;padding:0;font-size:12px;font-weight:500;position:fixed}.dsh_ann_dock_7gI2oG{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance));max-width:var(--dsh-composer-card-max-width);flex-direction:column;gap:8px;min-width:0;margin:0 auto;padding:0 0 8px;font-size:13px;display:flex}.dsh_ann_tag_7gI2oG{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-business-primary);font:inherit;cursor:pointer;white-space:nowrap;align-items:center;padding:5px 10px;font-size:13px;font-weight:500;display:inline-flex}.dsh_ann_tag_7gI2oG:focus-visible,.dsh_ann_bubble_7gI2oG:focus-visible,.dsh_ann_noteLink_7gI2oG:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);outline-offset:2px}.dsh_ann_preview_7gI2oG,.dsh_ann_note_7gI2oG{flex-direction:column;gap:8px;max-width:100%;display:flex}.dsh_ann_note_7gI2oG+.dsh_ann_note_7gI2oG{margin-top:12px}.dsh_ann_caption_7gI2oG{opacity:.75;font-size:12px}.dsh_ann_quote_7gI2oG,.dsh_ann_opinion_7gI2oG{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.dsh_ann_list_7gI2oG{flex-direction:column;gap:8px;max-height:240px;padding:4px;display:flex;overflow:auto}.dsh_ann_row_7gI2oG{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);flex-wrap:wrap;align-items:center;gap:8px;padding:8px;display:flex}.dsh_ann_noteLink_7gI2oG{min-width:min(140px,100%);color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;white-space:normal;overflow-wrap:anywhere;background:0 0;border:0;flex:1;padding:4px}.dsh_ann_error_7gI2oG{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px}.dsh_ann_sent_7gI2oG,.dsh_ann_sentList_7gI2oG{flex-wrap:wrap;align-items:center;gap:6px;max-width:100%;display:inline-flex}";
  document.head.append(tag);
}
var annotations_default = { "dock": "dsh_ann_dock_7gI2oG", "bubble": "dsh_ann_bubble_7gI2oG", "note": "dsh_ann_note_7gI2oG", "sentList": "dsh_ann_sentList_7gI2oG", "quote": "dsh_ann_quote_7gI2oG", "anchor": "dsh_ann_anchor_7gI2oG", "editor": "dsh_ann_editor_7gI2oG", "tag": "dsh_ann_tag_7gI2oG", "noteLink": "dsh_ann_noteLink_7gI2oG", "layer": "dsh_ann_layer_7gI2oG", "preview": "dsh_ann_preview_7gI2oG", "caption": "dsh_ann_caption_7gI2oG", "actions": "dsh_ann_actions_7gI2oG", "opinion": "dsh_ann_opinion_7gI2oG", "popover": "dsh_ann_popover_7gI2oG", "spacer": "dsh_ann_spacer_7gI2oG", "row": "dsh_ann_row_7gI2oG", "error": "dsh_ann_error_7gI2oG", "sent": "dsh_ann_sent_7gI2oG", "list": "dsh_ann_list_7gI2oG" };

// src/client/Annotations.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function AnnotationOverlay({
  useAnnotationState,
  mount,
  add,
  edit,
  change,
  save,
  cancel,
  remove,
  locate,
  t
}) {
  const state = useAnnotationState((value) => value);
  const seat = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => mount(seat.current), [mount]);
  const anchor = (0, import_react.useRef)(null);
  const panel = (0, import_react.useRef)(null);
  const target = state.editor ?? state.selection;
  const position = (0, import_dsh_client_ui_primitives.useAnchoredPosition)({ open: target !== null, anchorRef: anchor, panelRef: panel, side: "top", gap: 8, margin: 8 });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { hidden: true, ref: seat }),
    (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: annotations_default.layer, "data-annotation-ui": "", children: [
      state.bubbles.map((bubble, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: annotations_default.bubble,
          style: {
            left: bubble.position.left + 3 + state.bubbles.slice(0, index).filter((previous) => Math.abs(previous.position.left - bubble.position.left) < 24 && Math.abs(previous.position.top - bubble.position.top) < 20).length * 24,
            top: bubble.position.top - 12
          },
          "aria-label": `${t("edit")} ${bubble.number}`,
          onClick: () => {
            edit(bubble.id);
          },
          children: bubble.number
        },
        bubble.id
      )),
      target !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { ref: anchor, className: annotations_default.anchor, style: target.position }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { ref: panel, className: annotations_default.popover, style: position ?? { visibility: "hidden" }, children: state.editor === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.Button,
          {
            size: "sm",
            onMouseDown: (event) => {
              event.preventDefault();
            },
            onClick: add,
            onKeyDown: (event) => {
              if (event.key === "Escape") cancel();
            },
            children: t("add")
          }
        ) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: annotations_default.editor, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_dsh_client_ui_primitives.InlineEditor,
            {
              value: state.editor.comment,
              label: t("comment"),
              onChange: change,
              onSave: () => {
                save(state.editor?.comment ?? "");
              },
              onCancel: cancel
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: annotations_default.actions, children: [
            state.editor.id !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              import_dsh_client_ui_primitives.Button,
              {
                size: "sm",
                variant: "outline",
                onClick: () => {
                  if (state.editor?.id !== void 0) remove(state.editor.id);
                },
                children: t("delete")
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              import_dsh_client_ui_primitives.Button,
              {
                size: "sm",
                variant: "outline",
                onMouseDown: (event) => {
                  event.preventDefault();
                },
                onClick: () => {
                  if (state.editor !== null) locate(state.editor.anchor);
                },
                children: t("locate")
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: annotations_default.spacer }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", onClick: cancel, children: t("cancel") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              import_dsh_client_ui_primitives.Button,
              {
                size: "sm",
                variant: "primary",
                disabled: state.editor.comment.trim() === "",
                onClick: () => {
                  save(state.editor?.comment ?? "");
                },
                children: t("save")
              }
            )
          ] })
        ] }) })
      ] })
    ] }), document.body)
  ] });
}
function Preview({ notes, quoteLabel, opinionLabel }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: annotations_default.preview, children: notes.map((note) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: annotations_default.note, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: annotations_default.caption, children: [
      note.number,
      ". ",
      quoteLabel
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: annotations_default.quote, children: note.anchor.quote }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: annotations_default.caption, children: opinionLabel }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: annotations_default.opinion, children: note.comment })
  ] }, note.id)) });
}
function AnnotationDock({ useAnnotationState, edit, remove, reattach, locate, t }) {
  const state = useAnnotationState((value) => value);
  const [expanded, setExpanded] = (0, import_react.useState)(false);
  const notes = state.notes.filter((note) => note.status !== "sent");
  if (notes.length === 0 && state.issue === null) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: annotations_default.dock, "data-annotation-ui": "", "data-annotation-dock": "", children: [
    state.issue !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: annotations_default.error, role: "alert", children: t(state.issue) }),
    notes.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_dsh_client_ui_primitives.HoverCard,
        {
          inline: true,
          anchor: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: annotations_default.tag,
              "aria-expanded": expanded,
              onClick: () => {
                setExpanded((value) => !value);
              },
              children: t("count", { count: notes.length })
            }
          ),
          content: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Preview, { notes, quoteLabel: t("quote"), opinionLabel: t("opinion") })
        }
      ),
      expanded && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: annotations_default.list, children: notes.map((note) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: annotations_default.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: annotations_default.noteLink, onClick: () => {
          locate(note.anchor);
        }, children: [
          note.number,
          ". ",
          note.anchor.quote
        ] }),
        note.status === "sending" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("sending") }) : note.status === "uncertain" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: annotations_default.error, children: t("uncertain") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", onClick: () => {
            reattach(note.id);
          }, children: t("reattach") })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: annotations_default.actions, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "outline", onClick: () => {
            edit(note.id);
          }, children: t("edit") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "outline", onClick: () => {
            remove(note.id);
          }, children: t("delete") })
        ] })
      ] }, note.id)) })
    ] })
  ] });
}
function AnnotationLabel({ node, interactive, locate, t }) {
  const [expanded, setExpanded] = (0, import_react.useState)(false);
  const { notes } = node.data;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: annotations_default.sent, "data-annotation-sent": "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.HoverCard, { inline: true, anchor: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: annotations_default.tag,
        "aria-expanded": expanded,
        onClick: () => {
          if (notes.length === 1 && interactive) locate(notes[0].anchor);
          else setExpanded((value) => !value);
        },
        children: t("count", { count: notes.length })
      }
    ), content: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Preview, { notes, quoteLabel: t("quote"), opinionLabel: t("opinion") }) }),
    expanded && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: annotations_default.sentList, children: notes.map((note) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_dsh_client_ui_primitives.HoverCard,
      {
        inline: true,
        anchor: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: annotations_default.tag, onClick: () => {
          if (interactive) locate(note.anchor);
        }, children: note.number }),
        content: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Preview, { notes: [note], quoteLabel: t("quote"), opinionLabel: t("opinion") })
      },
      note.id
    )) })
  ] });
}

// src/client/locales.ts
var zh = {
  add: "\u6DFB\u52A0\u5230\u5BF9\u8BDD",
  count: "{count} \u6761\u6CE8\u91CA",
  comment: "\u6DFB\u52A0\u8BC4\u8BBA",
  save: "\u4FDD\u5B58",
  cancel: "\u53D6\u6D88",
  delete: "\u5220\u9664",
  quote: "\u6240\u9009\u6587\u672C",
  opinion: "\u7528\u6237\u8BC4\u8BBA",
  locate: "\u8DF3\u8F6C\u5230\u539F\u6587",
  edit: "\u7F16\u8F91\u6CE8\u91CA",
  sending: "\u53D1\u9001\u4E2D",
  sent: "\u5DF2\u53D1\u9001",
  uncertain: "\u4E0A\u6B21\u53D1\u9001\u7ED3\u679C\u672A\u786E\u8BA4\uFF0C\u8BF7\u5148\u68C0\u67E5\u5BF9\u8BDD\u8BB0\u5F55\uFF0C\u518D\u51B3\u5B9A\u662F\u5426\u91CD\u65B0\u9644\u5E26",
  reattach: "\u91CD\u65B0\u9644\u5230\u4E0B\u4E00\u6761\u6D88\u606F",
  storageError: "\u6279\u6CE8\u5C1A\u672A\u4FDD\u5B58\u5230\u6D4F\u89C8\u5668\uFF0C\u8BF7\u4FDD\u7559\u6B64\u9875\u9762\u5E76\u68C0\u67E5\u6D4F\u89C8\u5668\u5B58\u50A8\u7A7A\u95F4",
  attachError: "\u6279\u6CE8\u5C1A\u672A\u9644\u5230\u8F93\u5165\u6846\uFF0C\u8BF7\u7ED3\u675F\u5F53\u524D\u547D\u4EE4\u540E\u91CD\u8BD5",
  loadError: "\u65E0\u6CD5\u8BFB\u53D6\u5DF2\u6709\u6279\u6CE8\uFF0C\u5DF2\u4FDD\u7559\u539F\u59CB\u6570\u636E\uFF0C\u8BF7\u68C0\u67E5\u6D4F\u89C8\u5668\u5B58\u50A8\u540E\u91CD\u8BD5",
  locateError: "\u6682\u65F6\u65E0\u6CD5\u5B9A\u4F4D\u539F\u6587\uFF0C\u8BF7\u5C55\u5F00\u76F8\u5173\u56DE\u590D\u540E\u91CD\u8BD5",
  navigation: "\u6CE8\u91CA {number}\uFF1A{quote}",
  navigationMany: "{count} \u6761\u6CE8\u91CA\uFF1A{quote}"
};
var en = {
  add: "Add to conversation",
  count: "{count} annotations",
  comment: "Add a comment",
  save: "Save",
  cancel: "Cancel",
  delete: "Delete",
  quote: "Selected text",
  opinion: "Your comment",
  locate: "Go to source",
  edit: "Edit annotation",
  sending: "Sending",
  sent: "Sent",
  uncertain: "The last send could not be confirmed. Check the conversation before attaching again.",
  reattach: "Attach to next message again",
  storageError: "Annotations are not saved in this browser. Keep this page open and check browser storage.",
  attachError: "Annotations could not be attached. Finish the current command and try again.",
  loadError: "Saved annotations could not be read. Original data was preserved; check browser storage and retry.",
  locateError: "The source could not be located. Expand the relevant reply and try again.",
  navigation: "Annotation {number}: {quote}",
  navigationMany: "{count} annotations: {quote}"
};

// src/client/native-composer.ts
var import_zod3 = require("zod");
var ANNOTATION_SOURCE = "dsh-annotations";
var referenceSchema = import_zod3.z.object({ sessionId: import_zod3.z.string().min(1), notes: import_zod3.z.array(noteSchema).min(1) });
function readReference(ref) {
  return referenceSchema.parse(JSON.parse(ref));
}
function referenceClipboard(ref) {
  return `@annotations:${readReference(ref).notes.map((note) => note.id).join(",")}`;
}
function detectOffset(state, offset) {
  let result = offset;
  for (const occurrence of state.occurrences) {
    if (occurrence.offset + occurrence.length <= offset) result -= occurrence.length - 1;
  }
  if (state.claim !== void 0) {
    const token = state.claim.token.trimEnd();
    if (state.draft.startsWith(token) && offset >= token.length) result -= token.length - 1;
  }
  return result;
}
var NativeComposer = class {
  /**
   * @param binding - retained Session and its public event feed.
   * @param input - official per-Session composer.
   * @param model - independently persisted annotation drafts.
   * @param label - localized count label read at attachment time.
   */
  constructor(binding, input, model, label) {
    this.binding = binding;
    this.input = input;
    this.model = model;
    this.label = label;
    this.stops = [
      model.state.subscribe(() => {
        this.schedule();
      }),
      input.state.subscribe(() => {
        this.inputChanged();
      }),
      binding.eventSource.subscribe(() => {
        this.eventsChanged();
      })
    ];
    this.schedule();
  }
  binding;
  input;
  model;
  label;
  disposed = false;
  scheduled = false;
  mutating = false;
  activeRef;
  flights = /* @__PURE__ */ new Map();
  stops;
  eventRevision = -1;
  /**
   * Freeze only the chip's notes; native submission still owns attachments and delivery policy.
   * @param ref - validated snapshot reference selected by the native editor.
   * @param signal - native submission cancellation.
   * @returns exactly the original frozen notes as model-visible text.
   */
  serialize(ref, signal) {
    if (this.disposed || signal.aborted) throw new Error("The annotation submission was cancelled.");
    const value = readReference(ref);
    if (value.sessionId !== this.binding.sessionId) throw new Error("This annotation belongs to another conversation.");
    if (this.flights.has(ref)) throw new Error("Remove the duplicate annotation label before sending.");
    const reservation = this.model.reserve(value.notes);
    const abort = () => {
      this.finish(ref, "cancelled");
    };
    const record = { reservation, signal, abort, detached: false };
    this.flights.set(ref, record);
    signal.addEventListener("abort", abort, { once: true });
    this.schedule();
    return `${annotationTitle(value.notes)}

${reservation.text}`;
  }
  /** Release subscriptions and retain unresolved admission snapshots for explicit recovery. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const stop of this.stops) stop();
    for (const ref of [...this.flights.keys()]) this.finish(ref, "cancelled");
  }
  finish(ref, outcome) {
    const flight = this.flights.get(ref);
    if (flight === void 0) return;
    this.flights.delete(ref);
    flight.signal.removeEventListener("abort", flight.abort);
    flight.reservation.settle(outcome);
    this.schedule();
  }
  inputChanged() {
    if (this.mutating || this.disposed) return;
    const state = this.input.state.getSnapshot();
    const refs = new Set(state.occurrences.filter((item) => item.source === ANNOTATION_SOURCE).map((item) => item.ref));
    for (const [ref, flight] of this.flights) {
      if (!refs.has(ref)) flight.detached = true;
      else if (flight.detached) this.finish(ref, "error");
    }
    const active = this.activeRef;
    if (active !== void 0 && !refs.has(active) && !this.flights.has(active)) {
      this.activeRef = void 0;
      for (const note of readReference(active).notes) this.model.remove(note.id);
    }
    this.schedule();
  }
  schedule() {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.disposed) this.synchronize();
    });
  }
  removeOccurrence(occurrence) {
    const state = this.input.state.getSnapshot();
    const start = detectOffset(state, occurrence.offset);
    return this.binding.ctx.bail("slash/input-consume-token", {
      guard: { kind: "span", span: { start, end: start + 1, draftRev: state.draftRev } }
    }) === true;
  }
  synchronize() {
    const state = this.input.state.getSnapshot();
    if (state.phase === "adjudicating" || state.phase === "submitting") return;
    const notes = this.model.state.getSnapshot().notes.filter((note) => note.status === "draft").map(({ status: _status, ...note }) => note);
    const command = state.phase === "claimed" || state.draft.trimStart().startsWith("/");
    const desired = notes.length === 0 || command ? void 0 : JSON.stringify({ sessionId: this.binding.sessionId, notes });
    const own = state.occurrences.filter((item) => item.source === ANNOTATION_SOURCE && !this.flights.has(item.ref));
    if (own.length === 1 && own[0]?.ref === desired) {
      this.activeRef = desired;
      return;
    }
    this.mutating = true;
    let attached = true;
    try {
      this.activeRef = void 0;
      for (const occurrence of own.toReversed()) {
        if (!this.removeOccurrence(occurrence)) {
          attached = false;
          break;
        }
      }
      if (attached && desired !== void 0) {
        const latest = this.input.state.getSnapshot();
        const end = detectOffset(latest, latest.draft.length);
        attached = this.input.insertReference(
          {
            source: ANNOTATION_SOURCE,
            ref: desired,
            label: this.label(notes.length),
            clipboardText: referenceClipboard(desired)
          },
          { start: end, end, draftRev: latest.draftRev }
        );
        if (attached) this.activeRef = desired;
      }
    } finally {
      this.mutating = false;
    }
    if (!attached) this.model.present({ issue: "attachError" });
    else if (this.model.state.getSnapshot().issue === "attachError") this.model.present({ issue: null });
  }
  eventsChanged() {
    const window2 = this.binding.eventSource.getSnapshot();
    if (window2.revision === this.eventRevision || this.flights.size === 0) return;
    this.eventRevision = window2.revision;
    const entries = window2.change.kind === "settle-assistant" ? window2.change.entry === void 0 ? [] : [window2.change.entry] : window2.change.entries;
    for (const entry of entries) this.admitted(entry);
  }
  admitted(entry) {
    if (entry.type !== "event") return;
    const event = entry.event;
    const messages = event.type === "user/message" ? [event.data] : event.type === "agent/inbox/spliced" ? event.data.inserted : [];
    for (const message of messages) {
      if (message.source.kind !== "user") continue;
      const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
      for (const [ref, flight] of this.flights) {
        if (text.includes(flight.reservation.text)) this.finish(ref, "success");
      }
    }
  }
};

// src/client/index.ts
var inject = ["slots", "sessions", "locale", "conversation", "uiConversation", "inputTriggers"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register("annotations", { zh, en }), "annotations: dictionaries");
  const t = ctx.locale.bind("annotations");
  const controllers = /* @__PURE__ */ new WeakMap();
  const recordFor = (sessionId) => {
    const binding = ctx.sessions.binding(sessionId);
    if (binding === void 0) throw new Error("Annotations require a retained Session");
    const existing = controllers.get(binding);
    if (existing !== void 0) return existing;
    const input = ctx.conversation.input.for(binding.ctx);
    let storage;
    try {
      storage = localStorage;
    } catch (error) {
      storage = { getItem: () => {
        throw error;
      }, setItem: () => {
        throw error;
      } };
    }
    const model = new AnnotationModel(sessionId, storage);
    const chat = ctx.uiConversation.binding(binding).target("chat");
    let seat = null;
    const source = {
      root: () => seat?.closest("[data-conversation-content]") ?? null,
      node: (key) => {
        const node = chat.getSnapshot()?.nodes.get(key);
        if (node?.kind !== "assistant-step") return void 0;
        const assistant = node;
        if (assistant.data.status !== "settled" || assistant.data.finalNode === void 0) return void 0;
        return { seq: assistant.data.finalNode.seq, turn: assistant.data.turn };
      }
    };
    const controller = new AnnotationController(source, model, (seq) => binding.session.loadThrough(seq), () => {
      input.focus();
    });
    const composer = new NativeComposer(binding, input, model, (count) => t("count", { count }));
    const face = {
      hooks: { annotationState: model.state },
      mount: (element) => {
        seat = element;
        return controller.mount();
      },
      add: () => {
        controller.add();
      },
      edit: (id) => {
        controller.edit(id);
      },
      change: (comment) => {
        const editor = model.state.getSnapshot().editor;
        if (editor !== null) model.present({ editor: { ...editor, comment } });
      },
      save: (comment) => {
        controller.save(comment);
      },
      cancel: () => {
        controller.cancel();
      },
      remove: (id) => {
        controller.remove(id);
      },
      reattach: (id) => {
        model.reattach(id);
      },
      locate: (anchor) => {
        void controller.locate(anchor);
      }
    };
    const record = { controller, composer, face };
    controllers.set(binding, record);
    let disposed = false;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      composer.dispose();
      controller.dispose();
      controllers.delete(binding);
      void stopSession();
    };
    const stopPlugin = ctx.effect(() => cleanup, "annotations: Session integration");
    const stopSession = binding.ctx.effect(() => () => {
      void stopPlugin();
    }, "annotations: retained Session");
    return record;
  };
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: "@",
    name: ANNOTATION_SOURCE,
    candidates: async () => [],
    onPick: () => void 0,
    codec: {
      clipboardText: referenceClipboard,
      serialize: async (ref, signal) => {
        const value = readReference(ref);
        return recordFor(value.sessionId).composer.serialize(ref, signal);
      }
    },
    openReference: (session, reference) => {
      const value = readReference(reference.ref);
      if (value.sessionId !== session.sessionId) return false;
      const first = value.notes[0];
      if (first === void 0) return false;
      void recordFor(session.sessionId).controller.locate(first.anchor);
      return true;
    }
  }), "annotations: native references");
  ctx.effect(() => ctx.uiConversation.userText.register(annotationRule), "annotations: user text rule");
  ctx.slots.inject("conversation.input.overlay", () => ctx.slots.register({
    name: "conversation.input.overlay",
    id: ANNOTATION_SOURCE,
    order: 20,
    locale: "annotations",
    inject: (sessionId) => recordFor(sessionId).face
  }, AnnotationOverlay));
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: ANNOTATION_SOURCE,
    order: 20,
    locale: "annotations",
    inject: (sessionId) => recordFor(sessionId).face
  }, AnnotationDock));
  ctx.slots.inject("conversation.user.text.node", () => ctx.slots.register({
    name: "conversation.user.text.node",
    key: "annotations",
    locale: "annotations",
    inject: (sessionId) => ({ locate: recordFor(sessionId).face.locate })
  }, AnnotationLabel));
}
return module.exports;}});
