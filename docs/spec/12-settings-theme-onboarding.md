# 12 · Settings, theme and onboarding

## Settings

One schema (`settings.schema.json`, generated from Rust types), three ways in, all writing the same files:

- **Settings window** (`Ctrl/Cmd-,`): searchable; pages Appearance, Keys, AI (harness), Providers, Courses, Notes and files, Privacy, Advanced. Fully keyboard-navigable.
- **`:set key=value`** with completion and validation; `:set key?` shows the value and where it comes from (default, global, course).
- **Files**: global `config.jsonc` and `keymaps.jsonc`; per course `.lecter/course.jsonc` → `settings`.

Global folder: `~/.config/lecter/` on Linux and macOS (`$XDG_CONFIG_HOME/lecter` if set); `%APPDATA%\lecter\` on Windows. It holds `config.jsonc`, `keymaps.jsonc`, `trusted.jsonc`, `AGENTS.md`, `memory.md`, `agents/`, `skills/`. Data and caches go to the OS data and cache folders (`directories` crate).

Precedence: per prompt > role file > course > global > built-in default. Unknown keys are kept and reported, never deleted.

Key settings (non-exhaustive): `ai.defaultFast`, `ai.defaultStrong`, `ai.backupProvider`, `ai.hedgeAfterMs`, `ai.webSearch`, `ai.search.service`, `ai.search.maxPerAnswer`, `ai.search.allowDomains`, `ai.search.blockDomains`, `ai.budget.perLecture`, `ai.budget.monthly`, `ai.maxPrefixTokens`, `figures.mode.described`, `figures.mode.page`, `figures.maxLiveFrames`, `parsing.vision` (`provider` default | `local` | `auto` | `off`), `index.embeddings` (`local-small` default | `local-quality` | `provider` | `off`), `index.contextLines` (off), `lectures.namePattern`, `ui.hintBar` (`full` | `compact` | `off`), `ui.keystrokes`, `ui.theme`, `ui.accent`, `ui.docFont`, `privacy.shareFeedback`, `privacy.shareFeedbackText`, `feedback.endpoint`.

## Keys page

Lists every binding by context; rebind by pressing the new key; clash warnings; reset to defaults; import/export `keymaps.jsonc`.

## Theme

- **Linux**: follow the desktop's GTK theme live. Read theme name, colour scheme and accent through the XDG desktop settings portal (`org.freedesktop.appearance`) with `gsettings` as fallback. Parse the theme's `gtk-4.0/gtk.css` (else `gtk-3.0/gtk.css`) for `@define-color` named colours and map them to Lecter tokens: window, view, headerbar, sidebar, card, popover, borders, accent, plus the nine gloss colours derived from the theme's palette. Settings → Appearance lists every installed GTK theme (`/usr/share/themes`, `~/.themes`, `~/.local/share/themes`, Flatpak theme extensions) to choose instead.
- **macOS and Windows**: follow the OS light/dark mode and accent colour. Offer bundled themes (Adwaita, Yaru, Breeze, Catppuccin, Gruvbox, Nord; light and dark) and any GTK theme folder the user adds to `~/.themes`.
- **Bundled default "Lecter" theme** (light and dark): the palette in `docs/design/tokens.json`. It is the fallback whenever no GTK theme applies (macOS, Windows, or a GTK theme missing a named colour). Its token names are libadwaita's named colours, so a GTK theme overrides them one to one; the nine gloss colours derive from the theme's accent presets.
- All UI colours are CSS custom properties; no hard-coded colours in components.

## Onboarding (first run; every step skippable; `:tutor` reopens it)

1. **Welcome**: one screen on what Lecter does.
2. **Look**: detected theme already applied; choose light/dark or another theme.
3. **Vim?** "Daily · a little · never" sets the hint bar detail.
4. **Connect AI**: sign in or paste a key (`07-providers.md`), or a local server, or skip.
5. **Reading your files**: provider (default, fast, small cost) or local model (private, needs a download, slower without a GPU) or off. Text-based slides need neither.
6. **Help improve Lecter**: opt in or out of sharing feedback history; a second opt-in for question and answer text; shows a sample payload. Off unless chosen.
7. **Tutorial course**: a bundled sample course, "Lecter 101", whose one lecture ("Taking notes with Lecter") teaches the app itself.
   - The lecture is a few slides of plain English, generated from Markdown at build time, with no course material and no maths.
   - Every AI answer in the tutorial is a canned placeholder labelled "Sample answer". The tutorial needs no provider, no key and no network.
   - A checklist ticks itself as you go: open the slides, ask about a line with `a`, expand steps with `s`, park a doubt with `D`, flag with `mm`, ask about a figure, rate with `zg`, open the dashboard. Each task shows the click way and the key way.
   - Real lecture files are never used as tutorial or sample content.
8. **Your first course**: pick or create a folder, trust it, fill in details.
