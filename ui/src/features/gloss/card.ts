// The gloss card under a block (docs/design/components.md#gloss, #prompt-row) while it is asked and
// answered: first the prompt row (ask · new gloss, an input, the ↵ keycap), then the streaming
// card (ask row "you asked" with the question and model, the answer growing in the body with a
// caret, and an Esc keycap to stop). Plain DOM: CodeMirror shows it as a block widget, and the
// answer is set as text, never as HTML. Once the answer is saved the card goes and the gloss is
// part of the lecture text.
import { FrameBatcher } from "./frame";
import "./Gloss.css";

/** Where the card is: asking, answering, or ended without a saved gloss. */
export type CardState = "prompt" | "streaming" | "stopped" | "failed";

/** What the card's controls do. */
export interface CardActions {
  /** ↵ in the prompt (or its keycap): send the question. */
  send: (question: string) => void;
  /** Esc in the prompt, or the Esc keycap: close the prompt or stop the answer. */
  escape: () => void;
}

/** A `tag` element with class `className`. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

/** A `tag` element with class `className` that shows `text`. */
function textEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const e = el(tag, className);
  e.textContent = text;
  return e;
}

/** A keycap button (tokens.keycap) showing `key`, followed by `word`. */
function keycap(key: string, word: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", `gloss-action ${className}`);
  b.type = "button";
  b.setAttribute("aria-label", word);
  b.append(textEl("kbd", "gloss-key", key), textEl("span", "gloss-action-word", word));
  // Clicking must not take focus from the input or the buffer before the action runs.
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", onClick);
  return b;
}

/** One gloss being asked or answered, for block `anchor`. */
export class GlossCard {
  readonly root = el("div", "gloss");
  /** The gloss id, once the core has answered the request. */
  gloss: string | null = null;
  private stateValue: CardState = "prompt";
  private readonly input = el("textarea", "gloss-prompt-input");
  private readonly body = el("div", "gloss-body");
  private readonly text = document.createTextNode("");
  private readonly meta = el("span", "gloss-meta");
  private readonly stopKey: HTMLButtonElement;
  private readonly batcher: FrameBatcher;

  constructor(
    readonly anchor: string,
    private readonly actions: CardActions,
  ) {
    this.root.dataset.anchor = anchor;
    this.input.rows = 1;
    this.input.setAttribute("aria-label", "Ask about this line");
    this.input.placeholder = "Ask about this line…";
    this.input.addEventListener("keydown", (e) => this.promptKey(e));
    this.body.setAttribute("aria-live", "polite");
    this.stopKey = keycap("Esc", "Stop", "gloss-stop", () => this.actions.escape());
    this.batcher = new FrameBatcher((t) => this.text.appendData(t));
    this.setState("prompt");
    const row = el("div", "gloss-ask gloss-prompt");
    row.append(textEl("span", "gloss-ask-label", "ask · new gloss"), this.input);
    row.append(keycap("↵", "Send", "gloss-send", () => this.actions.send(this.input.value)));
    this.root.append(row);
  }

  get state(): CardState {
    return this.stateValue;
  }

  private setState(state: CardState): void {
    this.stateValue = state;
    this.root.dataset.state = state;
  }

  /** Puts the cursor in the prompt. */
  focus(): void {
    this.input.focus();
  }

  /** ↵ sends, Shift-↵ is a new line, Esc closes (09-ui.md#prompt-row). Keys never reach Vim. */
  private promptKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.actions.send(this.input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.actions.escape();
    }
  }

  /** Turns the prompt into the streaming card for `question`. */
  streaming(question: string): void {
    this.setState("streaming");
    const ask = el("div", "gloss-ask");
    ask.append(textEl("span", "gloss-ask-label", "you asked"), textEl("span", "gloss-question", question.trim()));
    ask.append(this.meta, this.stopKey);
    this.body.append(this.text, el("span", "gloss-caret"));
    this.root.replaceChildren(ask, this.body);
  }

  /** Shows the model answering. */
  model(name: string): void {
    this.meta.textContent = name;
  }

  /** Adds answer text; the screen shows it on the next animation frame, once per frame. */
  append(delta: string): void {
    if (this.stateValue === "streaming") this.batcher.push(delta);
  }

  /** Stops showing the answer at once (Esc): deltas still in flight are dropped. */
  stop(): void {
    if (this.stateValue !== "streaming") return;
    this.batcher.discard();
    this.setState("stopped");
    this.stopKey.remove();
  }

  /** Shows why there is no gloss: `message` replaces the answer. */
  fail(message: string): void {
    this.setState("failed");
    this.stopKey.remove();
    const error = textEl("p", "gloss-error", message);
    error.setAttribute("role", "alert");
    this.body.replaceChildren(error);
  }
}
