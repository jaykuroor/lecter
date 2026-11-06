#![allow(clippy::disallowed_methods, reason = "tests build fixture folders on plain test threads")]

use std::collections::HashMap;
use std::ffi::OsString;

use super::*;
use crate::testenv::TestEnv;
use crate::theme::gtk::fixture;

fn theme(root: &Path, name: &str, version: &str) -> PathBuf {
    let dir = root.join(name).join(version);
    std::fs::create_dir_all(&dir).unwrap();
    let css = dir.join("gtk.css");
    std::fs::write(&css, "@define-color theme_bg_color #ffffff;").unwrap();
    css
}

fn names(list: &[InstalledTheme]) -> Vec<&str> {
    list.iter().map(|t| t.name.as_str()).collect()
}

#[test]
fn lists_the_fixture_themes_with_a_stylesheet_sorted_by_name() {
    let dirs = ThemeDirs::new(vec![fixture("")], vec![]);
    let list = dirs.list();
    assert_eq!(names(&list), ["Adwaitish", "Both", "Greyish", "Imported", "Nightish", "Variant"]);
    assert!(list.iter().all(|t| t.folder == fixture("").display().to_string()));
}

#[test]
fn gtk4_wins_over_gtk3_and_a_dark_stylesheet_is_found_beside_it() {
    let dirs = ThemeDirs::new(vec![fixture("")], vec![]);
    let both = dirs.find("Both").unwrap();
    assert_eq!(both.light, fixture("Both/gtk-4.0/gtk.css"));
    assert_eq!(both.dark, None);
    assert_eq!(dirs.find("Greyish").unwrap().light, fixture("Greyish/gtk-3.0/gtk.css"));
    let variant = dirs.find("Variant").unwrap();
    assert_eq!(variant.dark, Some(fixture("Variant/gtk-3.0/gtk-dark.css")));
    assert_eq!(variant.for_scheme(Some(Scheme::Dark)), fixture("Variant/gtk-3.0/gtk-dark.css"));
    assert_eq!(variant.for_scheme(Some(Scheme::Light)), fixture("Variant/gtk-3.0/gtk.css"));
    assert_eq!(variant.for_scheme(None), fixture("Variant/gtk-3.0/gtk.css"));
    assert_eq!(both.for_scheme(Some(Scheme::Dark)), fixture("Both/gtk-4.0/gtk.css"));
    assert_eq!(dirs.find("NoCss"), None);
    assert_eq!(dirs.find("Missing"), None);
}

#[test]
fn the_first_folder_holding_a_name_wins() {
    let env = TestEnv::new().unwrap();
    let user = env.home().join("user");
    let system = env.home().join("system");
    let mine = theme(&user, "Same", "gtk-3.0");
    theme(&system, "Same", "gtk-4.0");
    theme(&system, "Other", "gtk-3.0");
    let dirs = ThemeDirs::new(vec![user.clone(), system.clone()], vec![]);
    assert_eq!(dirs.find("Same").unwrap().light, mine);
    let list = dirs.list();
    assert_eq!(names(&list), ["Other", "Same"]);
    assert_eq!(list[1].folder, user.display().to_string());
    assert_eq!(list[0].folder, system.display().to_string());
}

#[test]
fn names_that_could_leave_a_theme_folder_are_refused() {
    let env = TestEnv::new().unwrap();
    let root = env.home().join("themes");
    theme(&root, ".hidden", "gtk-3.0");
    theme(env.home(), "outside", "gtk-3.0");
    theme(&root, "inner/nested", "gtk-3.0");
    let dirs = ThemeDirs::new(vec![root], vec![]);
    for bad in ["", ".hidden", "..", "../outside", "inner/nested", "a\\b", "a\0b", "Adwaita:dark", "tab\there"] {
        assert_eq!(dirs.find(bad), None, "{bad:?}");
        assert!(!valid_name(bad), "{bad:?}");
    }
    assert!(valid_name(&"n".repeat(MAX_NAME_BYTES)));
    assert!(!valid_name(&"n".repeat(MAX_NAME_BYTES + 1)));
    assert!(valid_name("Yaru-prussiangreen-dark"));
    assert!(valid_name("Nordic bluish accent"));
    // `.hidden` is hidden and `inner` has no stylesheet of its own.
    assert!(dirs.list().is_empty(), "{:?}", dirs.list());
}

#[test]
fn flatpak_theme_extensions_are_listed_and_found_after_folders() {
    let env = TestEnv::new().unwrap();
    let runtime = env.home().join("flatpak/runtime");
    let files = runtime.join("org.gtk.Gtk3theme.Flat-Dark/x86_64/3.22/active/files");
    let css = theme(&files, "", "gtk-3.0");
    std::fs::create_dir_all(runtime.join("org.gnome.Platform/x86_64/47/active/files/gtk-3.0")).unwrap();
    std::fs::write(runtime.join("org.gnome.Platform/x86_64/47/active/files/gtk-3.0/gtk.css"), "").unwrap();
    std::fs::create_dir_all(runtime.join("org.gtk.Gtk3theme.Empty/x86_64/3.22/active/files")).unwrap();
    let folders = env.home().join("themes");
    let shadowing = theme(&folders, "Greyish", "gtk-3.0");
    std::fs::create_dir_all(runtime.join("org.gtk.Gtk3theme.Greyish/x86_64/3.22/active/files")).unwrap();
    theme(&runtime.join("org.gtk.Gtk3theme.Greyish/x86_64/3.22/active/files"), "", "gtk-3.0");
    let dirs = ThemeDirs::new(vec![folders.clone()], vec![runtime.clone()]);
    let list = dirs.list();
    assert_eq!(names(&list), ["Flat-Dark", "Greyish"]);
    assert_eq!(list[0].folder, runtime.display().to_string());
    assert_eq!(list[1].folder, folders.display().to_string());
    assert_eq!(dirs.find("Flat-Dark").unwrap().light, css);
    assert_eq!(dirs.find("Greyish").unwrap().light, shadowing);
    assert_eq!(dirs.find("Empty"), None);
}

#[cfg(unix)]
#[test]
fn a_symlinked_theme_folder_counts() {
    let env = TestEnv::new().unwrap();
    let elsewhere = env.home().join("elsewhere");
    theme(&elsewhere, "Real", "gtk-4.0");
    let root = env.home().join("themes");
    std::fs::create_dir_all(&root).unwrap();
    std::os::unix::fs::symlink(elsewhere.join("Real"), root.join("Linked")).unwrap();
    let dirs = ThemeDirs::new(vec![root.clone()], vec![]);
    assert_eq!(names(&dirs.list()), ["Linked"]);
    assert_eq!(dirs.find("Linked").unwrap().light, root.join("Linked/gtk-4.0/gtk.css"));
}

#[test]
fn the_list_stops_at_max_themes() {
    let env = TestEnv::new().unwrap();
    let root = env.home().join("themes");
    for i in 0..MAX_THEMES + 5 {
        theme(&root, &format!("t{i:04}"), "gtk-3.0");
    }
    let list = ThemeDirs::new(vec![root], vec![]).list();
    assert_eq!(list.len(), MAX_THEMES);
}

#[test]
fn sorting_ignores_case() {
    let env = TestEnv::new().unwrap();
    // "alpha" sits in a folder of its own: a case-insensitive file system (APFS, NTFS) can't hold
    // it beside "Alpha". Different case is a different name, so both are listed.
    let root = env.home().join("themes");
    let other = env.home().join("more-themes");
    for name in ["beta", "Alpha", "Gamma"] {
        theme(&root, name, "gtk-3.0");
    }
    theme(&other, "alpha", "gtk-3.0");
    assert_eq!(names(&ThemeDirs::new(vec![other, root], vec![]).list()), ["Alpha", "alpha", "beta", "Gamma"]);
}

fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
    let map: HashMap<String, OsString> = pairs.iter().map(|(k, v)| ((*k).to_owned(), OsString::from(v))).collect();
    move |k| map.get(k).cloned()
}

#[test]
fn the_standard_folders_follow_gtks_lookup_order() {
    let dirs = ThemeDirs::standard(env_of(&[("HOME", "/h")]));
    assert_eq!(
        dirs,
        ThemeDirs::new(
            vec![
                "/h/.local/share/themes".into(),
                "/h/.themes".into(),
                "/usr/local/share/themes".into(),
                "/usr/share/themes".into()
            ],
            vec!["/h/.local/share/flatpak/runtime".into(), "/var/lib/flatpak/runtime".into()],
        )
    );
}

#[test]
fn xdg_variables_move_the_folders_and_usr_share_stays() {
    let dirs =
        ThemeDirs::standard(env_of(&[("HOME", "/h"), ("XDG_DATA_HOME", "/data"), ("XDG_DATA_DIRS", "/a:relative:/b")]));
    assert_eq!(
        dirs,
        ThemeDirs::new(
            vec![
                "/data/themes".into(),
                "/h/.themes".into(),
                "/a/themes".into(),
                "/b/themes".into(),
                "/usr/share/themes".into()
            ],
            vec!["/data/flatpak/runtime".into(), "/var/lib/flatpak/runtime".into()],
        )
    );
    let with_usr = ThemeDirs::standard(env_of(&[("HOME", "/h"), ("XDG_DATA_DIRS", "/usr/share")]));
    assert_eq!(with_usr.folders.iter().filter(|p| **p == Path::new("/usr/share/themes")).count(), 1);
}

#[test]
fn empty_or_missing_home_leaves_only_system_folders() {
    let dirs = ThemeDirs::standard(env_of(&[("HOME", ""), ("XDG_DATA_HOME", "")]));
    assert_eq!(
        dirs,
        ThemeDirs::new(
            vec!["/usr/local/share/themes".into(), "/usr/share/themes".into()],
            vec!["/var/lib/flatpak/runtime".into()],
        )
    );
}
