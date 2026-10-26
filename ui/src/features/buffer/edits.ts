// What the buffer's edits look like to the core (18-contracts.md#journal-records, F-021): each
// CodeMirror change becomes an `Edit` in UTF-16 positions (CodeMirror's own), each counted in the
// document as the edit before it left it. The core turns them into UTF-8 journal records.
import type { ChangeSet, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Edit } from "../../core/lecture";

/**
 * The most UTF-16 units of text in one edit. A unit is at most 3 UTF-8 bytes, so a piece stays
 * well under the core's 64 KB string limit (18-contracts.md#validation); a longer paste is sent
 * as consecutive inserts.
 */
export const MAX_EDIT_UNITS = 16_384;

/** `text` in pieces of at most `MAX_EDIT_UNITS` units, never splitting a surrogate pair. */
function pieces(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(at + MAX_EDIT_UNITS, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
}

/** One change `from..to` → `text` as edits in order: a long text becomes consecutive inserts. */
function changeEdits(from: number, to: number, text: string): Edit[] {
  const parts = pieces(text);
  if (parts.length === 0) return [{ from, to, text: "" }];
  let at = from;
  return parts.map((piece, i) => {
    const edit = { from: at, to: i === 0 ? to : at, text: piece };
    at += piece.length;
    return edit;
  });
}

/**
 * A transaction's changes as edits, applied one after another. CodeMirror reports them by their
 * positions in the old document, so they go last-first: an edit then never moves the positions
 * of the ones after it.
 */
export function editsOf(changes: ChangeSet): Edit[] {
  const groups: Edit[][] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    groups.push(changeEdits(fromA, toA, inserted.toString()));
  });
  return groups.reverse().flat();
}

/** Calls `send` with the edits of every transaction that changes the document. */
export function sendEdits(send: (edits: Edit[]) => void): Extension {
  return EditorView.updateListener.of((update) => {
    if (update.docChanged) send(editsOf(update.changes));
  });
}
