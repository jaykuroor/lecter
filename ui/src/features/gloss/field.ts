// The cards of glosses being asked or answered, as block widgets under their blocks. The field
// holds each card with the position of its block's line end, mapped through every edit, so a card
// stays under its block while the user types. With no cards (almost always) an edit costs nothing.
import { Facet, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { GlossBackend } from "../../core/gloss";
import type { GlossCard } from "./card";

/** Where the buffer's asks go: the open lecture's backend, or none (Enter asks nothing then). */
export const glossBackendFacet = Facet.define<GlossBackend, GlossBackend | null>({
  combine: (values) => values[0] ?? null,
});

/** A card and the end of its block's line. */
export interface Placed {
  card: GlossCard;
  pos: number;
}

/** Shows `card` under the line ending at `pos`. */
export const addCard = StateEffect.define<Placed>();

/** Removes `card`. */
export const removeCard = StateEffect.define<GlossCard>();

class CardWidget extends WidgetType {
  constructor(readonly card: GlossCard) {
    super();
  }

  override eq(other: CardWidget): boolean {
    return other.card === this.card;
  }

  toDOM(): HTMLElement {
    return this.card.root;
  }

  // The card handles its own keys and clicks; the editor and Vim leave them alone.
  override ignoreEvent(): boolean {
    return true;
  }
}

/** The cards on screen, in no set order. */
export const cardsField = StateField.define<readonly Placed[]>({
  create: () => [],
  update(cards, tr) {
    let next = cards;
    if (tr.docChanged && cards.length > 0) {
      next = cards.map((p) => ({ card: p.card, pos: tr.changes.mapPos(p.pos, 1) }));
    }
    for (const e of tr.effects) {
      if (e.is(addCard)) next = [...next, e.value];
      else if (e.is(removeCard)) next = next.filter((p) => p.card !== e.value);
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (cards) => {
      const ranges: Range<Decoration>[] = cards.map((p) =>
        Decoration.widget({ widget: new CardWidget(p.card), block: true, side: 1 }).range(p.pos),
      );
      return Decoration.set(ranges, true);
    }),
});
