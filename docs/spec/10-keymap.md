# 10 · Keymap

Rule: **keep only the Vim subset that speeds up typing and moving in notes; every Lecter key means the same on a slide line and in an own note; most keys are one lowercase or unshifted key.** Read-only elements (slide lines, glosses, dashboard rows) take these keys directly; `i` makes an element editable. LazyVim conventions: Space is the leader (which-key), `]`/`[` go next/previous, `z` folds. Every binding is rebindable (`keymaps.jsonc`, Settings → Keys). Keys marked v1 are reserved but not built in v0.

## Vim subset (kept)

`h j k l w b e 0 ^ $ gg G Ctrl-d Ctrl-u f ; , / ? n N *` · `i a I A o O x d c y p P r` · `u Ctrl-r v V .` · `J >> <<` · counts and text objects · `Esc` · `zz zt zb` · `za zM zR`.

Given up (the Lecter meaning wins): `s S` (substitute), `q` (macros), `t T`, marks (`m ' ` `), `=`, `Tab` (jump forward), `Enter` (line down), `R`, `H M L`, `#`.

## Move (everywhere)

| Keys | Action |
|---|---|
| `j k` `gg G` `Ctrl-d Ctrl-u` `zz zt zb` | Line or element, top/bottom, half page, scroll |
| `Ctrl-j Ctrl-k` | Next / previous slide (`]] [[` also work; dashboard: panel) |
| `]g [g` `]f [f` `]d [d` | Next / previous gloss, flag, doubt |
| `]b [b` | Next / previous build step |
| `Alt-← Alt-→` | Jump list back / forward |
| `/ ? n N *` | Search in buffer |
| `{count}` | Counts work as in Vim (`3]]`) |
| `gl` `gL` | v1: go to / pin the live slide |

## On a slide line

These keys work the same on a slide line and on an own-note line.

| Key | Action |
|---|---|
| `Enter` | Ask about this line (a selection: `v…Enter`) |
| `s` | Steps (checked) |
| `q` | Park a doubt (answered in background) |
| `t` | Define terms |
| `'` | Worked example |
| `=` | Plot |
| `Tab` | Write for me |
| `m` `M` | Flag line / flag slide |
| `.` | Repeat the last action (the last edit or AI command, whichever came last) |
| `o O` | Own note below / above |
| `gd` | Go to this idea in your sources |
| `gx` | Compare parse with original |
| `i` | Edit / fix the line |
| `⌫` `c` | v1: rewind last 30 s, catch me up |

In insert mode these keys type text as usual. In an own note, `o O i x .` and `a` keep their Vim meaning; the AI keys above are the same on both kinds of line.

## On a gloss

Glosses are read-only.

| Key | Action |
|---|---|
| `Enter` | Reply in thread (on an unkept draft: keep it) |
| `r` | Regenerate (feedback goes through the reply prompt) |
| `-` `=` | Less / more detail |
| `<` `>` | Older / newer variant |
| `zg zw` | Rate good / wrong |
| `i` | Edit the gloss |
| `gq` | Tidy (own notes) |
| `za zM zR` | Fold one / all / none |
| `dd yy` | Delete / yank as Markdown |
| `u Ctrl-r` | Undo / redo |
| `Esc` | Stop a streaming answer |

A gloss is **kept** or **unkept**. A new gloss is unkept and stays in the lecture until the user keeps it (`Enter` on it, editing it, replying, or rating it good); a gloss stopped part-way stays unkept. Closing a lecture that has unkept glosses asks first ("Closing deletes N unkept glosses": confirm or cancel); with only kept glosses, or none, it closes without asking. Quitting the app asks the same (D-168).

## Prompt row

`Tab` into this gloss ↔ new gloss · `↵` send · `Shift-↵` new line · `Esc` cancel · `@` mentions (`@slide4`, `@L06`, `@source`, `@model`, `@web`, `@noweb`) · `↑ ↓` history.

## Figure proposal card (when focused)

`1` first option · `2` second option · `Esc` skip · `a` always allow this kind.

## Leader groups (`␣`)

The leader holds the rarer things; letters that duplicate a single key above are gone.

| Group | Keys |
|---|---|
| `␣a` AI | `g` gap finder, `m` pick model, `f` figure mode, `c` course chat |
| `␣s` Search | `g` sources, `s` slides, `n` notes across the course, `w` web |
| `␣x` Lists | `x` doubts, `f` flags, `l` later, `o` office hours, `r` revise |
| `␣f` Files | `f` open slides, `r` recent lectures, `n` new lecture, `s` add source, `R` rename lecture |
| `␣u` UI | `C` theme, `b` light/dark, `r` read mode, `k` keystroke overlay, `h` hint bar detail |
| `␣e` `␣r` | Toggle sidebar, right panel |
| `␣␣` `␣,` `␣?` `␣qq` | Find lecture, switch buffers, keys for this element, quit |
| `Ctrl /` (`␣ft`) | v1: floating terminal in the course folder |

## Global (OS conventions)

Windows/Linux use `Ctrl`; macOS uses `Cmd`, which has no Vim clash. They work in every mode and element.

`Ctrl-z` undo · `Ctrl-Shift-z` and `Ctrl-y` redo · `Ctrl-s` save · `Ctrl-f` find · `Ctrl-a` select all · `Ctrl-x` cut · `Ctrl-c` copy · `Ctrl-v` paste · `Ctrl-w` close lecture (asks if it has unkept glosses) · `Ctrl-o` open · `Ctrl-n` new lecture · `Ctrl-,` settings · `Ctrl-1…9` course · `Ctrl-Shift-P` palette · `Ctrl-p` quick switcher. macOS also `Cmd-Q` quit. System clipboard shared by default.

Vim meanings given up on Windows/Linux, and their replacements: insert `Ctrl-w` delete word → `Ctrl-Backspace`; `Ctrl-c` leave insert → `Esc`; `Ctrl-v` block select → `v` / `V`; `Ctrl-o` / `Ctrl-i` jump list → `Alt-←` / `Alt-→`; `Ctrl-y` scroll is gone. `Ctrl-r` stays Vim redo. The webview's own reload shortcuts are disabled. Conflicts found while building are reported in PROGRESS "Watch out".

## Commands

| Command | Action |
|---|---|
| `:open path` | Open or add a course folder |
| `:new` `:rename name` | New lecture; rename current |
| `:e file` | Link and open a slide file |
| `:find query` | Search sources, cite page |
| `:connect` `:model role model` | Providers; models per role |
| `:set key=value` `:set key?` | Any setting (with completion) |
| `:map lhs rhs` | Rebind |
| `:theme name` | Theme |
| `:w` `:wq` `:q` | Save (autosave is always on); v1: study pack on `:wq` |
| `:read` `:tutor` `:dashboard` | Read mode, tutorial, dashboard |
| `:export md\|pdf\|tex` | Export (PDF via installed Pandoc) |
