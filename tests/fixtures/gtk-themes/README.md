# GTK theme fixtures (F-043)

Synthetic themes for the `crates/core/src/theme/gtk` tests, one folder each, laid out as in
`/usr/share/themes`. The colours are made up or taken from GNOME's public palette; nothing is
copied from a real theme's stylesheet.

| Theme | What it checks |
|---|---|
| `Adwaitish` | libadwaita names and palette (`gtk-4.0`): every mapped token, light and dark |
| `Greyish` | GTK 3 names (`theme_bg_color`, `borders`) in `gtk-3.0` only |
| `Both` | `gtk-4.0` wins over `gtk-3.0` |
| `Nightish` | a dark theme defining only the window colours: the rest falls back |
| `Imported` | only an `@import`, which is never followed: nothing applies |
| `Variant` | `gtk-dark.css` beside `gtk.css`, used when the desktop prefers dark |
| `NoCss` | no `gtk.css`: not listed |
