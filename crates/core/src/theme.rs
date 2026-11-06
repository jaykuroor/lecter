//! Themes (`12-settings-theme-onboarding.md#theme`). The bundled Lecter theme is static CSS in
//! the UI (`ui/src/theme/tokens.css`, D-239); the core finds and reads the desktop's themes, holds
//! the other bundled themes ([`bundled`]) and reads the OS accent on macOS and Windows ([`accent`]).

pub mod accent;
pub mod bundled;
mod bundled_palettes;
pub mod gtk;
