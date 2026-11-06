//! The bundled themes' colours (12-settings-theme-onboarding.md#theme), written as GTK named
//! colours (`@define-color`) so they go through the same mapping as an installed GTK theme
//! ([`ThemeColors`](super::gtk::tokens::ThemeColors)): libadwaita's surface names, plus the
//! palette names the nine gloss colours come from (`blue_4`, `green_5`, … for light; `blue_1`,
//! `green_1`, … for dark). Only colour values are transcribed from each project's published
//! palette; no stylesheet or other code is copied.
//!
//! Sources: Adwaita, the GNOME HIG palette and libadwaita's named colours (Lecter's own default,
//! `docs/design/tokens.json`, uses the same surfaces); Yaru, Ubuntu's brand and Yaru colours;
//! Breeze, KDE's Breeze colour scheme (`kdeglobals`) and HIG palette; Catppuccin, Latte (light)
//! and Mocha (dark), MIT; Gruvbox, morhetz/gruvbox's faded (light) and bright (dark) colours, MIT;
//! Nord, Snow Storm (light) and Polar Night (dark) with Frost and Aurora, MIT.

/// One bundled theme's two variants, as `@define-color` text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Palette {
    /// The theme's name, as `ui.theme` gives it.
    pub name: &'static str,
    /// The light variant.
    pub light: &'static str,
    /// The dark variant.
    pub dark: &'static str,
}

/// The bundled themes, in the order the spec lists them.
pub const PALETTES: [Palette; 6] = [ADWAITA, YARU, BREEZE, CATPPUCCIN, GRUVBOX, NORD];

const ADWAITA: Palette = Palette {
    name: "Adwaita",
    light: "
@define-color window_bg_color #fafafb; @define-color window_fg_color #2e2e32;
@define-color view_bg_color #ffffff; @define-color view_fg_color #2e2e32;
@define-color headerbar_bg_color #ffffff; @define-color headerbar_border_color #e3e3e6;
@define-color sidebar_bg_color #ebebed; @define-color card_bg_color #ffffff;
@define-color popover_bg_color #ffffff; @define-color borders #dcdce0;
@define-color accent_bg_color #3584e4; @define-color accent_fg_color #ffffff;
@define-color accent_color #0461be;
@define-color blue_4 #1c71d8; @define-color green_4 #2ec27e; @define-color green_5 #26a269;
@define-color yellow_5 #e5a50a; @define-color purple_4 #813d9c; @define-color red_4 #c01c28;
@define-color orange_5 #c64600; @define-color dark_1 #77767b;",
    dark: "
@define-color window_bg_color #222226; @define-color window_fg_color #ffffff;
@define-color view_bg_color #1d1d20; @define-color view_fg_color #ffffff;
@define-color headerbar_bg_color #2e2e32; @define-color headerbar_border_color #151517;
@define-color sidebar_bg_color #2e2e32; @define-color card_bg_color #2a2a2e;
@define-color popover_bg_color #36363a; @define-color borders #3a3a3f;
@define-color accent_bg_color #3584e4; @define-color accent_fg_color #ffffff;
@define-color accent_color #81d0ff;
@define-color blue_1 #99c1f1; @define-color green_1 #8ff0a4; @define-color yellow_2 #f8e45c;
@define-color purple_1 #dc8add; @define-color red_1 #f66151; @define-color orange_2 #ffa348;
@define-color light_4 #c0bfbc;",
};

const YARU: Palette = Palette {
    name: "Yaru",
    light: "
@define-color window_bg_color #fafafa; @define-color window_fg_color #3d3d3d;
@define-color view_bg_color #ffffff; @define-color view_fg_color #3d3d3d;
@define-color headerbar_bg_color #ebebeb; @define-color headerbar_border_color #dadada;
@define-color sidebar_bg_color #f2f2f2; @define-color card_bg_color #ffffff;
@define-color popover_bg_color #ffffff; @define-color borders #dadada;
@define-color accent_bg_color #e95420; @define-color accent_fg_color #ffffff;
@define-color accent_color #c34113;
@define-color blue_4 #0073e5; @define-color green_4 #3eb34f; @define-color green_5 #0e8420;
@define-color yellow_5 #c88800; @define-color purple_4 #77216f; @define-color red_4 #c7162b;
@define-color orange_5 #c34113; @define-color dark_1 #7a7a7a;",
    dark: "
@define-color window_bg_color #2c2c2c; @define-color window_fg_color #f7f7f7;
@define-color view_bg_color #1e1e1e; @define-color view_fg_color #f7f7f7;
@define-color headerbar_bg_color #303030; @define-color headerbar_border_color #1d1d1d;
@define-color sidebar_bg_color #303030; @define-color card_bg_color #333333;
@define-color popover_bg_color #383838; @define-color borders #1d1d1d;
@define-color accent_bg_color #e95420; @define-color accent_fg_color #ffffff;
@define-color accent_color #f08763;
@define-color blue_1 #6eb4ff; @define-color green_1 #7fd88a; @define-color yellow_2 #ffc94d;
@define-color purple_1 #c98cc2; @define-color red_1 #f0767f; @define-color orange_2 #f5a97f;
@define-color light_4 #c0c0c0;",
};

const BREEZE: Palette = Palette {
    name: "Breeze",
    light: "
@define-color window_bg_color #eff0f1; @define-color window_fg_color #232627;
@define-color view_bg_color #fcfcfc; @define-color view_fg_color #232627;
@define-color headerbar_bg_color #dee0e2; @define-color headerbar_border_color #bcbebf;
@define-color sidebar_bg_color #eff0f1; @define-color card_bg_color #fcfcfc;
@define-color popover_bg_color #fcfcfc; @define-color borders #bcbebf;
@define-color accent_bg_color #3daee9; @define-color accent_fg_color #fcfcfc;
@define-color accent_color #2980b9;
@define-color blue_4 #2980b9; @define-color green_4 #27ae60; @define-color green_5 #1e8449;
@define-color yellow_5 #b37200; @define-color purple_4 #8e44ad; @define-color red_4 #da4453;
@define-color orange_5 #f67400; @define-color dark_1 #7f8c8d;",
    dark: "
@define-color window_bg_color #31363b; @define-color window_fg_color #eff0f1;
@define-color view_bg_color #232629; @define-color view_fg_color #eff0f1;
@define-color headerbar_bg_color #2a2e32; @define-color headerbar_border_color #1b1e20;
@define-color sidebar_bg_color #2a2e32; @define-color card_bg_color #31363b;
@define-color popover_bg_color #31363b; @define-color borders #616569;
@define-color accent_bg_color #3daee9; @define-color accent_fg_color #eff0f1;
@define-color accent_color #3daee9;
@define-color blue_1 #3daee9; @define-color green_1 #2ecc71; @define-color yellow_2 #fdbc4b;
@define-color purple_1 #b67bd0; @define-color red_1 #ed6e7a; @define-color orange_2 #f67400;
@define-color light_4 #bdc3c7;",
};

const CATPPUCCIN: Palette = Palette {
    name: "Catppuccin",
    light: "
@define-color window_bg_color #e6e9ef; @define-color window_fg_color #4c4f69;
@define-color view_bg_color #eff1f5; @define-color view_fg_color #4c4f69;
@define-color headerbar_bg_color #dce0e8; @define-color headerbar_border_color #bcc0cc;
@define-color sidebar_bg_color #e6e9ef; @define-color card_bg_color #eff1f5;
@define-color popover_bg_color #eff1f5; @define-color borders #ccd0da;
@define-color accent_bg_color #8839ef; @define-color accent_fg_color #eff1f5;
@define-color accent_color #8839ef;
@define-color blue_4 #1e66f5; @define-color green_4 #179299; @define-color green_5 #40a02b;
@define-color yellow_5 #df8e1d; @define-color purple_4 #8839ef; @define-color red_4 #d20f39;
@define-color orange_5 #fe640b; @define-color dark_1 #8c8fa1;",
    dark: "
@define-color window_bg_color #181825; @define-color window_fg_color #cdd6f4;
@define-color view_bg_color #1e1e2e; @define-color view_fg_color #cdd6f4;
@define-color headerbar_bg_color #11111b; @define-color headerbar_border_color #11111b;
@define-color sidebar_bg_color #181825; @define-color card_bg_color #313244;
@define-color popover_bg_color #313244; @define-color borders #45475a;
@define-color accent_bg_color #cba6f7; @define-color accent_fg_color #11111b;
@define-color accent_color #cba6f7;
@define-color blue_1 #89b4fa; @define-color green_1 #a6e3a1; @define-color yellow_2 #f9e2af;
@define-color purple_1 #cba6f7; @define-color red_1 #f38ba8; @define-color orange_2 #fab387;
@define-color light_4 #9399b2;",
};

const GRUVBOX: Palette = Palette {
    name: "Gruvbox",
    light: "
@define-color window_bg_color #fbf1c7; @define-color window_fg_color #3c3836;
@define-color view_bg_color #f9f5d7; @define-color view_fg_color #3c3836;
@define-color headerbar_bg_color #ebdbb2; @define-color headerbar_border_color #d5c4a1;
@define-color sidebar_bg_color #f2e5bc; @define-color card_bg_color #f9f5d7;
@define-color popover_bg_color #f9f5d7; @define-color borders #d5c4a1;
@define-color accent_bg_color #076678; @define-color accent_fg_color #fbf1c7;
@define-color accent_color #076678;
@define-color blue_4 #076678; @define-color green_4 #427b58; @define-color green_5 #79740e;
@define-color yellow_5 #b57614; @define-color purple_4 #8f3f71; @define-color red_4 #9d0006;
@define-color orange_5 #af3a03; @define-color dark_1 #7c6f64;",
    dark: "
@define-color window_bg_color #282828; @define-color window_fg_color #ebdbb2;
@define-color view_bg_color #1d2021; @define-color view_fg_color #ebdbb2;
@define-color headerbar_bg_color #3c3836; @define-color headerbar_border_color #1d2021;
@define-color sidebar_bg_color #32302f; @define-color card_bg_color #3c3836;
@define-color popover_bg_color #3c3836; @define-color borders #504945;
@define-color accent_bg_color #83a598; @define-color accent_fg_color #282828;
@define-color accent_color #83a598;
@define-color blue_1 #83a598; @define-color green_1 #b8bb26; @define-color yellow_2 #fabd2f;
@define-color purple_1 #d3869b; @define-color red_1 #fb4934; @define-color orange_2 #fe8019;
@define-color light_4 #a89984;",
};

const NORD: Palette = Palette {
    name: "Nord",
    light: "
@define-color window_bg_color #e5e9f0; @define-color window_fg_color #2e3440;
@define-color view_bg_color #eceff4; @define-color view_fg_color #3b4252;
@define-color headerbar_bg_color #d8dee9; @define-color headerbar_border_color #c2c9d6;
@define-color sidebar_bg_color #d8dee9; @define-color card_bg_color #eceff4;
@define-color popover_bg_color #eceff4; @define-color borders #c2c9d6;
@define-color accent_bg_color #5e81ac; @define-color accent_fg_color #eceff4;
@define-color accent_color #5e81ac;
@define-color blue_4 #5e81ac; @define-color green_4 #8fbcbb; @define-color green_5 #a3be8c;
@define-color yellow_5 #ebcb8b; @define-color purple_4 #b48ead; @define-color red_4 #bf616a;
@define-color orange_5 #d08770; @define-color dark_1 #4c566a;",
    dark: "
@define-color window_bg_color #3b4252; @define-color window_fg_color #eceff4;
@define-color view_bg_color #2e3440; @define-color view_fg_color #d8dee9;
@define-color headerbar_bg_color #3b4252; @define-color headerbar_border_color #2e3440;
@define-color sidebar_bg_color #3b4252; @define-color card_bg_color #434c5e;
@define-color popover_bg_color #434c5e; @define-color borders #4c566a;
@define-color accent_bg_color #88c0d0; @define-color accent_fg_color #2e3440;
@define-color accent_color #88c0d0;
@define-color blue_1 #81a1c1; @define-color green_1 #a3be8c; @define-color yellow_2 #ebcb8b;
@define-color purple_1 #b48ead; @define-color red_1 #bf616a; @define-color orange_2 #d08770;
@define-color light_4 #d8dee9;",
};
