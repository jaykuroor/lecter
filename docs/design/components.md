# Components

One entry per component in the concept demo (D-036). Layout, states and the tokens each uses (`tokens.json`; written here as `--name`). Reference crops: `reference/light/<name>.png` and `reference/dark/<name>.png`. The crops show placeholder text; match the layout, tokens and states, not the words.

Rules for every component:
- Colours, radii, shadows and fonts only from tokens. Hover is `mix.hover`, selected is `mix.selected`, keyboard focus is a 2px `--accent` outline with 2px offset.
- Every action has a key and a mouse path; where a key exists, the control shows it as a keycap.
- Reduced motion: no animation (`motion.reduced-motion`).

## App frame (`app.png`, `app-steps.png`)
Three columns under a headerbar: rail 208px, document (fills, max 800px text column), side panel 312px; status line along the bottom of the document column. Background `--window-bg`, outer radius 12px and `shadow.app` only when windowed in the demo; in the real app the OS window frame replaces them. The rail and side panel can collapse (rail column becomes 0).

## Headerbar (`headerbar.png`)
Grid: left controls · centred title · right controls; min height 47px, padding 6px 8px, `--headerbar-bg`, bottom border `--headerbar-border`.
- Title: lecture name (`type.headerbar-title`), subtitle course · lecture · path (`type.headerbar-subtitle`, ellipsis).
- Left: rail toggle (34px icon button, radius 7px), status pills.
- Right: try-first toggle (button), reading mode, theme, menu, close.
- **Pill:** radius 999px, padding 3px 10px, 11.5px 600, `mix.pill-bg`, 7px dot. States: live (dot `--k-prof`, pulsing), in sync (`--k-ask` text and dot), out of sync (`--k-doubt` on `color-mix(--k-doubt 14%)`), on (`--accent` on `color-mix(--accent 14%)`).

## Rail (`rail.png`)
`--sidebar-bg`, right border `--borders`, padding 10px 8px, sections 12px apart, each with a label (`.rlab`: 11.5px 700 `--dim`).
- **Slide row:** grid 18px number (mono 11px `--faint`) + title (12.5px 600, ellipsis); second line of 7px square markers, one per gloss, coloured by kind; radius 7px, padding 6px 8px. States: hover, current slide (`mix.selected`), "you can" live marker (9.5px 700 `--k-prof`), flagged (`--k-flag` ⚑).
- **Legend:** gloss kinds (8px squares) and parse-confidence swatches (18×11px: solid = from text, dotted = OCR or vision 85–95%, dotted `--k-doubt` = below 85%).

## Buffer (document column)
`--view-bg` / `--view-fg`, scrolls independently. Every row of the document uses the same two-column grid: 92px right-aligned gutter label + 16px gap + content.

## Slide heading (`slide-heading.png`)
Gutter: `SLIDE n / N` (`type.label-mono`, `--faint`). Content: title (`type.slide-title`) and source line (mono 10.5px `--faint`). Bottom border `--line2`, 8px padding below. Flagged: ⚑ before the label in `--k-flag`.

## Block (`block-focused.png`, `block-low-confidence.png`)
One parsed line or paragraph. Content `type.doc-block`, padding 2px 8px, radius 6px; list items prefixed with an en dash in `--faint`. Gutter: cursor marker (`--accent`) and flag mark.
- **Focused:** background `mix.block-focus-bg`, cursor marker visible, block actions shown.
- **Flagged:** inset 3px left bar `--k-flag`.
- **Mid confidence (OCR or vision 85–95%):** `mix.block-mid-confidence-border`, 12px top padding, a small badge top-right with the key to compare (`gx`).
- **Low confidence (below 85%):** `mix.block-low-confidence`; badge in `--k-doubt`.
- **Reading mode:** no focus background, no cursor, no keycaps.

## Block actions (`block-actions.png`)
Floating row at the focused block's bottom-right: `--popover-bg`, border `--borders`, radius 8px, padding 2px, `shadow.acts`. Buttons 11.5px `--dim`, radius 5px, padding 3px 7px; each starts with its key in mono 600 `--accent` (`s` steps, `a` ask, `D` doubt, `>` write, `mm` flag). Hover: `mix.hover`, text `--view-fg`.

## Gloss (`gloss.png`, `gloss-steps.png`, `gloss-focused.png`, `gloss-draft.png`)
An AI answer or note under the line it explains. CSS `--k` is the kind's colour (`gloss-kind`).
- **Gutter tag:** kind label (10.5px 700 uppercase, `--k`) under the key that made it, as a keycap tinted by `--k`.
- **Card:** `mix.gloss-bg`, border `mix.gloss-border`, radius 10px, body `type.gloss-body`.
- **Ask row** (top): label (mono 10.5px 600 `--k`: "you asked", "steps", "doubt"), the question (italic `--dim`), right-aligned meta (mono 10.5px `--dim`: model, sources). Background `mix.gloss-ask-bg`, bottom border `mix.gloss-ask-border`. A feedback line can follow under a dashed top border.
- **Body:** padding 10px 15px 4px; paragraphs, lists, optional heading (doc 1.05rem 600), math (KaTeX).
- **Steps:** numbered rows (mono number + step text + right-aligned check result in mono `--dim`, ✓ when checked); a sub-gloss for one step has a 2px `--k` left border.
- **Footer:** see keycap row.
- **States:** streaming (text grows; no footer until done; caret in `--k`), done, draft (dashed border `mix.gloss-draft-border`, hidden in reading mode), low confidence (1.5px dotted border), focused (2px `--accent` outline, offset 2px), folded (`za`: ask row only, "folded · za" hint), entering (`motion.gloss-enter`).

## Keycap row (gloss footer, `gloss-footer-keycaps.png`)
Under the gloss body: 11.5px `--dim`, gap 6px 12px, padding 4px 15px 9px. Each item is a keycap plus a word: 👍 `zg`, 👎 `zw`, `r` regenerate, `R` with feedback, variant `n/N` with `g-` / `g+`, and "kept hh:mm" in `--k-ask`. Footer keycaps are 10px, 1.6em square. Clickable as buttons; the keycap shows the key.
- **Keycap** (everywhere): `tokens.keycap`, including its states (hover, now, done, on-osd, in-gloss-tag).

## Prompt row
The ask row in edit mode: the label ("ask", "into this gloss" / "new gloss"), a borderless input in `--view-fg` filling the row, and keycaps for `Tab` (toggle target) and `Enter` (send). Same tokens as the ask row.

## Hint bar and which-key
- **Hint bar** (`09-ui.md`): one line above the status line listing the keys that work now, as keycaps + words, `--dim`; compact and off modes per `ui.hintBar`.
- **Which-key popover:** after a leader or prefix key, bottom-right over the document: width ≤ 440px, `--popover-bg`, border `--borders`, radius 12px, padding 10px 12px 12px, `shadow.popover`, 12.5px. Title row in mono 11px 600 `--accent` (prefix) with a `--faint` hint; grid of keycap (min 2.1em) + description.

## Keystroke overlay (`keystroke-overlay.png`)
Bottom-left of the document, 14px from the edge: the last keys pressed as on-osd keycaps (12.5px, 1.9em) in a `--osd-bg` capsule (radius 9px, padding 6px 9px, `shadow.toast`). Fades after 0.5s; off with `ui.keystrokes`.

## Cmdline
`:` opens a centred box at 16% from the top: width ≤ 520px, `--popover-bg`, 1.5px `--accent` border, radius 10px, `shadow.popover`, mono 13.5px. A small title notch on the top border ("Cmdline", `--accent` 10.5px). Prompt `:` in `--accent` 700, input fills.

## Status line (`status-line.png`)
Bottom of the document column: `--headerbar-bg`, top border `--borders`, mono 11.5px, min height 27px, tabular numbers. Segments (padding 5px 10px): mode (700, letter-spacing 0.06em, `mode-colors`), course/lecture (`color-mix(--window-fg 8%)`), current line (fills, ellipsis), doubts `D n` (`--k-doubt`) and flags `⚑ n` (`--k-flag`), position `n/N`.

## Side panel (`side-panel.png`)
`--sidebar-bg`, left border `--borders`. Tabs: Transcript, Doubts, Flags, Sources, AI, with counts (mono 10px `--dim`); tab 12px 600, radius 7px; selected `mix.selected`.
- **Transcript row:** time (mono `--faint`) + text; the live line highlighted with `color-mix(--k-prof 14%)` and a `--k-prof` caption.
- **Parse row:** grid 52px page + text + confidence (mono 10.5px 600: ok `--k-ask`, mid `--dim`, low `--k-doubt`).
- **AI tab:** checklist rows with ✓ and a card (`--card-bg`, radius 10px) for the current answer.

## Compare parse
Popover over the document (16px insets, top 14px): `--popover-bg`, border, radius 12px, `shadow.popover`. Header (14px bold title + mono 11px `--dim` meta), two equal columns (original crop | parsed text) as figures with 8px radius borders and 11px 600 `--dim` captions, a summary row, and action buttons (suggested action uses `.btn.sug`: `--accent-bg` / `--accent-fg`).

## Selection toolbar
Floats above a text selection: `--popover-bg`, border, radius 9px, padding 3px, shadow `0 10px 26px -12px rgba(0,0,0,.5)`. Buttons 12px, radius 6px, padding 4px 9px, each with its key.

## Nudge (`nudge.png`)
A suggestion banner at the top of the document (16px insets): `color-mix(--k-doubt 14%, --popover-bg)`, border `color-mix(--k-doubt 45%, --borders)`, radius 12px, padding 9px 13px, 13px text, `!` icon 800 `--k-doubt`, an inline keycap for the action, `shadow.nudge`.

## Toast (`toast.png`)
Centred near the bottom of the document: `--osd-bg` / `--osd-fg`, 13px 500, padding 9px 18px, radius 999px, `shadow.toast`, max width = column − 32px.

## Buttons and chips
- **Button:** radius 8px, padding 6px 12px, 12.5px 600, background `color-mix(--view-fg 8%)`; suggested: `--accent-bg` / `--accent-fg` with on-accent keycaps; "hit" (just triggered by its key): 2px `--accent` ring.
- **Chip:** radius 999px, padding 1px 9px, 11px 600, colour `--c`, background `mix.chip-bg`.

## Terminal panel
Overlay for running a command (`:!`): `--term-bg` / `--term-fg`, radius 12px, mono 12.5px / 1.55, header in mono 11px at 65% opacity, prompt in `--k-ask` (dark values), highlights in `--k-derive` (dark values).
