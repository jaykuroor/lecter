# 10 · Keymap

Rule: **read-only elements (slide lines, glosses, dashboard rows) take single-letter commands; `i` makes an element editable.** Own notes behave as normal Vim. LazyVim conventions: Space is the leader (which-key), `]`/`[` go next/previous, `z` folds, AI lives under `␣a`. Every binding is rebindable (`keymaps.jsonc`, Settings → Keys). Keys marked v1 are reserved but not built in v0.

## Move (everywhere)

| Keys | Action |
|---|---|
| `j k` `gg G` `Ctrl-d Ctrl-u` `zz zt zb` | Line or element, top/bottom, half page, scroll |
| `]] [[` | Next / previous slide (dashboard: panel) |
| `]g [g` `]f [f` `]d [d` | Next / previous gloss, flag, doubt |
| `]b [b` | Next / previous build step |
| `Ctrl-o Ctrl-i` | Jump list back / forward |
| `/ ? n N * #` | Search in buffer |
| `{count}` | Counts work as in Vim (`3]]`) |
| `gl` `gL` | v1: go to / pin the live slide |

## On a slide line

| Key | Action |
|---|---|
| `s` | Steps (checked) |
| `a` | Ask about this line |
| `D` | Park a doubt (answered in background) |
| `x` | Worked example |
| `K` | Define terms |
| `gd` | Go to this idea in your sources |
| `>` | Write for me |
| `o O` | Own note below / above |
| `mm ms` | Flag line / flag slide (kept by decision; shadows Vim marks `m`, `s` on slide lines) |
| `gx` | Compare parse with original |
| `i` | Fix the parsed line |
| `.` | Repeat the last AI command here |
| `⌫` `c` | v1: rewind last 30 s, catch me up |

## On a gloss

| Key | Action |
|---|---|
| `r` `R` | Regenerate; regenerate with feedback |
| `zg zw` | Rate good / wrong |
| `g- g+` | Older / newer variant |
| `Ctrl-a Ctrl-x` | More / less detail |
| `v…a` | Ask about a selection |
| `i` | Edit the gloss |
| `↵` | Reply in thread (on a draft: keep it) |
| `gq` | Tidy (own notes) |
| `za zM zR` | Fold one / all / none |
| `dd yy` | Delete / yank as Markdown |
| `u Ctrl-r` | Undo / redo |
| `Esc` | Stop a streaming answer |

## Prompt row

`Tab` into this gloss ↔ new gloss · `↵` send · `Shift-↵` new line · `Esc` cancel · `@` mentions (`@slide4`, `@L06`, `@source`, `@model`, `@web`, `@noweb`) · `↑ ↓` history.

## Figure proposal card (when focused)

`y` first option · `2` second option · `n` skip · `A` always allow this kind.

## Leader groups (`␣`)

| Group | Keys |
|---|---|
| `␣a` AI | `a` ask, `s` steps, `d` doubt, `x` example, `p` plot, `g` gap finder, `w` write, `m` pick model, `f` figure mode, `c` course chat |
| `␣s` Search | `g` sources, `s` slides, `n` notes across the course, `w` web |
| `␣x` Lists | `x` doubts, `f` flags, `l` later, `o` office hours, `r` revise |
| `␣f` Files | `f` open slides, `r` recent lectures, `n` new lecture, `s` add source, `R` rename lecture |
| `␣u` UI | `C` theme, `b` light/dark, `r` read mode, `k` keystroke overlay, `h` hint bar detail |
| `␣e` `␣r` | Toggle sidebar, right panel |
| `␣␣` `␣,` `␣?` `␣qq` | Find lecture, switch buffers, keys for this element, quit |
| `Ctrl /` (`␣ft`) | v1: floating terminal in the course folder |

## Global (OS conventions)

`Ctrl/Cmd-K` switcher · `Ctrl/Cmd-Shift-P` palette · `Ctrl/Cmd-,` settings · `Ctrl/Cmd-1…9` course · macOS `Cmd-C/V/S/Q/W` native; Windows/Linux `Ctrl-Shift-C/V` (plain `Ctrl-V` stays Vim block select). System clipboard shared by default.

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
