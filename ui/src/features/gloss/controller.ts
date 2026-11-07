// Asking about a block or own note (10-keymap.md: Enter on a slide or own-note line; 09-ui.md#prompt-row)
// and streaming the answer under it (06-ai-harness.md#loop). The answer arrives on the GlossStream channel and is
// drawn once per animation frame; when it ends, its fenced div (03-lecture-files.md#body) is
// inserted into the buffer under the block, so it goes to the core like every other edit (journal,
// save) and `u` undoes it. `Esc` stops a streaming answer and keeps what arrived.
import { type Extension, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { GlossBackend, GlossEvent } from "../../core/gloss";
import { blockSpan } from "../buffer/syntax";
import { askCommand } from "./askKey";
import { GlossCard } from "./card";
import { addCard, cardsField, glossBackendFacet, removeCard } from "./field";
import { anchorLine, glossInsertPos, noteAt } from "./place";

/** The cards in `view`. */
function cards(view: EditorView): GlossCard[] {
  return view.state.field(cardsField).map((p) => p.card);
}

function remove(view: EditorView, card: GlossCard): void {
  view.dispatch({ effects: removeCard.of(card) });
}

/**
 * Opens the prompt row under line `n` if it is a slide block, or a line of an own note, of a
 * lecture that can ask; returns whether it did. The answer is anchored to the block or the note
 * (F-048). An open prompt elsewhere closes first.
 */
export function openPrompt(view: EditorView, n: number): boolean {
  const backend = view.state.facet(glossBackendFacet);
  const line = view.state.doc.line(n);
  const anchor = blockSpan(line.text)?.id ?? noteAt(view.state.doc, n);
  if (!backend || !anchor) return false;
  const card: GlossCard = new GlossCard(anchor, {
    send: (question) => send(view, backend, card, question),
    escape: () => escapeCard(view, backend, card),
  });
  const prompts = cards(view).filter((old) => old.state === "prompt");
  view.dispatch({ effects: [...prompts.map((old) => removeCard.of(old)), addCard.of({ card, pos: line.to })] });
  card.focus();
  return true;
}

/** Esc on a card: a prompt closes, a stream stops, an ended card goes. */
function escapeCard(view: EditorView, backend: GlossBackend, card: GlossCard): void {
  if (card.state === "streaming") stop(backend, card);
  else remove(view, card);
  view.focus();
}

/** Sends `question` from `card`'s prompt and streams the answer into it. */
function send(view: EditorView, backend: GlossBackend, card: GlossCard, question: string): void {
  if (question.trim() === "") return;
  card.streaming(question);
  view.focus();
  const onEvent = (event: GlossEvent) => receive(view, card, event);
  void backend.request(card.anchor, question, onEvent).then((started) => {
    if (!started.ok) {
      card.fail(started.message);
      return;
    }
    card.gloss = started.gloss;
    // Esc came before the core named the gloss: stop it now.
    if (card.state === "stopped") backend.cancel(started.gloss);
  });
}

function receive(view: EditorView, card: GlossCard, event: GlossEvent): void {
  switch (event.event) {
    case "started":
      card.model(event.data.model);
      return;
    case "delta":
      card.append(event.data.text);
      return;
    case "done":
    case "stopped":
      // A stream stopped before any text has no gloss to save.
      if (event.data.markdown === null) remove(view, card);
      else save(view, card, event.data.markdown);
      return;
    case "failed":
      card.fail(event.data.error.message);
      return;
  }
}

/**
 * Inserts the gloss's fenced div under its block or note (after the earlier glosses there); the
 * card goes.
 */
function save(view: EditorView, card: GlossCard, markdown: string): void {
  const doc = view.state.doc;
  const n = anchorLine(doc, card.anchor);
  if (n === null) {
    card.fail("The line was deleted, so the answer was not saved.");
    return;
  }
  const at = glossInsertPos(doc, n, card.anchor);
  view.dispatch({
    changes: { from: at, insert: `\n\n${markdown}` },
    effects: removeCard.of(card),
  });
}

/** Stops `card`'s stream: the screen stops changing at once, and the core is told. */
function stop(backend: GlossBackend, card: GlossCard): void {
  card.stop();
  if (card.gloss !== null) backend.cancel(card.gloss);
}

/**
 * `Esc` in the buffer while answers stream stops them all (10-keymap.md#on-a-gloss), and closes
 * every other card (an open prompt, an answer that ended without a gloss). Vim still gets the key.
 */
function escapeKey(backend: GlossBackend): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown(e, view) {
        if (e.key !== "Escape") return false;
        for (const card of cards(view)) {
          if (card.state === "streaming") stop(backend, card);
          else remove(view, card);
        }
        return false;
      },
    }),
  );
}

/** The gloss feature of a lecture buffer whose asks go to `backend` (none: Enter asks nothing). */
export function glossExtension(backend: GlossBackend | null): Extension {
  return backend ? [glossBackendFacet.of(backend), cardsField, escapeKey(backend), askCommand(openPrompt)] : [];
}
