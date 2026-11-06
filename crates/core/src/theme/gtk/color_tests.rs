use super::*;

fn css(c: Rgba) -> String {
    c.to_string()
}

#[test]
fn hash_colours_take_three_four_six_and_eight_digits() {
    assert_eq!(css(Rgba::from_hash("fff").unwrap()), "#ffffff");
    assert_eq!(css(Rgba::from_hash("1a2").unwrap()), "#11aa22");
    assert_eq!(css(Rgba::from_hash("0000").unwrap()), "rgba(0, 0, 0, 0)");
    assert_eq!(css(Rgba::from_hash("3584E4").unwrap()), "#3584e4");
    assert_eq!(css(Rgba::from_hash("3584e480").unwrap()), "rgba(53, 132, 228, 0.502)");
}

#[test]
fn hash_colours_refuse_other_lengths_and_non_hex_digits() {
    for bad in ["", "f", "ff", "fffff", "fffffff", "fffffffff", "ggg", "12345z", "+12", "éé"] {
        assert_eq!(Rgba::from_hash(bad), None, "{bad:?}");
    }
}

#[test]
fn named_colours_are_case_insensitive_and_unknown_names_are_none() {
    assert_eq!(css(Rgba::named("White").unwrap()), "#ffffff");
    assert_eq!(css(Rgba::named("grey").unwrap()), "#808080");
    assert_eq!(css(Rgba::named("green").unwrap()), "#008000");
    assert_eq!(css(Rgba::named("TRANSPARENT").unwrap()), "rgba(0, 0, 0, 0)");
    assert_eq!(Rgba::named("chartreuse-ish"), None);
    assert_eq!(Rgba::named("url"), None);
}

#[test]
fn shade_scales_hsl_lightness_and_saturation() {
    // Worked by hand: #ff0000 is h 0, s 1, l 0.5; at 0.5 → s 0.5, l 0.25 → q 0.375, p 0.125.
    assert_eq!(css(Rgba::from_hex(0xff0000).shade(0.5)), "#602020");
    // Grey keeps s 0: l 1 × 0.9 = 0.9 → 229.5 → 230.
    assert_eq!(css(Rgba::from_hex(0xffffff).shade(0.9)), "#e6e6e6");
    // Lightness clamps at 1.
    assert_eq!(css(Rgba::from_hex(0x808080).shade(3.0)), "#ffffff");
    // Hue survives: #3584e4 at 1.0 is itself, and a green stays green.
    assert_eq!(css(Rgba::from_hex(0x3584e4).shade(1.0)), "#3584e4");
    assert_eq!(css(Rgba::from_hex(0x00ff00).shade(0.5)), "#206020");
    assert_eq!(css(Rgba::from_hex(0x0000ff).shade(0.5)), "#202060");
    // Alpha is kept.
    assert_eq!(css(Rgba::new(1.0, 0.0, 0.0, 0.5).shade(0.5)), "rgba(96, 32, 32, 0.5)");
}

#[test]
fn shade_handles_every_hue_sector() {
    // l 0.5 s 1 colours at the six primaries and secondaries, darkened to l 0.25, s 0.5.
    assert_eq!(css(Rgba::from_hex(0xffff00).shade(0.5)), "#606020");
    assert_eq!(css(Rgba::from_hex(0x00ffff).shade(0.5)), "#206060");
    assert_eq!(css(Rgba::from_hex(0xff00ff).shade(0.5)), "#602060");
    // A light colour (l > 0.5) takes the other saturation formula: #ff8080 is h 0, s 1, l 0.75.
    assert_eq!(css(Rgba::from_hex(0xff8080).shade(0.8)), "#eb4848");
}

#[test]
fn alpha_scales_opacity_and_clamps() {
    assert_eq!(css(Rgba::from_hex(0x000000).alpha(0.35)), "rgba(0, 0, 0, 0.35)");
    assert_eq!(css(Rgba::new(0.0, 0.0, 0.0, 0.5).alpha(0.5)), "rgba(0, 0, 0, 0.25)");
    assert_eq!(css(Rgba::from_hex(0xffffff).alpha(4.0)), "#ffffff");
    assert_eq!(css(Rgba::from_hex(0xffffff).alpha(-1.0)), "rgba(255, 255, 255, 0)");
}

#[test]
fn mix_moves_each_channel_and_alpha_toward_the_second_colour() {
    let black = Rgba::from_hex(0x000000);
    let white = Rgba::from_hex(0xffffff);
    assert_eq!(css(black.mix(white, 0.5)), "#808080");
    assert_eq!(css(black.mix(white, 0.0)), "#000000");
    assert_eq!(css(black.mix(white, 1.0)), "#ffffff");
    assert_eq!(css(black.mix(white, 7.0)), "#ffffff", "factor clamps to 1");
    assert_eq!(css(black.mix(white, -2.0)), "#000000", "factor clamps to 0");
    assert_eq!(css(Rgba::from_hex(0x3584e4).mix(Rgba::from_hex(0x2ec27e), 0.2)), "#3490d0");
    assert_eq!(css(black.mix(black.alpha(0.0), 0.5)), "rgba(0, 0, 0, 0.5)");
}

#[test]
fn over_paints_a_share_of_the_colour_on_a_base() {
    // tokens.json: dim is window_fg at 55 % over window_bg.
    let fg = Rgba::from_hex(0x000000);
    let bg = Rgba::from_hex(0xffffff);
    assert_eq!(css(fg.over(bg, 0.55)), "#737373");
    assert_eq!(css(fg.over(bg, 0.0)), "#ffffff");
}

#[test]
fn new_clamps_channels_and_turns_nan_into_zero() {
    assert_eq!(css(Rgba::new(2.0, -1.0, f64::NAN, 1.0)), "#ff0000");
    assert_eq!(css(Rgba::new(0.0, 0.0, 0.0, f64::NAN)), "rgba(0, 0, 0, 0)");
}

#[test]
fn luminance_runs_from_black_to_white() {
    assert!(Rgba::from_hex(0x000000).luminance().abs() < 1e-9);
    assert!((Rgba::from_hex(0xffffff).luminance() - 1.0).abs() < 1e-9);
    // Lecter's dark window (#222226) is dark, its light window (#fafafb) light.
    assert!(Rgba::from_hex(0x222226).luminance() < 0.05);
    assert!(Rgba::from_hex(0xfafafb).luminance() > 0.9);
    // Green weighs most: WCAG's 0.7152.
    assert!((Rgba::from_hex(0x00ff00).luminance() - 0.7152).abs() < 1e-4);
    assert!((Rgba::from_hex(0x0000ff).luminance() - 0.0722).abs() < 1e-4);
    // The low segment of the sRGB curve: 10/255 is linear 10/255/12.92.
    let dark = Rgba::new(10.0 / 255.0, 10.0 / 255.0, 10.0 / 255.0, 1.0);
    assert!((dark.luminance() - 10.0 / 255.0 / 12.92).abs() < 1e-9);
}

#[test]
fn standalone_accent_matches_the_lecter_theme_for_adwaita_blue() {
    // docs/design/tokens.json: accent-bg #3584e4 gives accent #0461be (light) and #81d0ff (dark).
    let blue = Rgba::from_hex(0x3584e4);
    assert_eq!(css(blue.standalone(false)), "#0461be");
    assert_eq!(css(blue.standalone(true)), "#81d0ff");
}

#[test]
fn standalone_accent_keeps_a_colour_already_on_the_right_side() {
    // A dark accent on a light theme and a light one on a dark theme come back unchanged.
    assert_eq!(css(Rgba::from_hex(0x1a3d6b).standalone(false)), "#1a3d6b");
    assert_eq!(css(Rgba::from_hex(0xe0f0ff).standalone(true)), "#e0f0ff");
}
