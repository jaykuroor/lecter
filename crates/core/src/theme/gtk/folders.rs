//! Where GTK themes are installed, in GTK's lookup order: `$XDG_DATA_HOME/themes`
//! (`~/.local/share/themes`), `~/.themes`, then `<dir>/themes` for each of `$XDG_DATA_DIRS`
//! (`/usr/share/themes` always among them), then Flatpak theme extensions
//! (`org.gtk.Gtk3theme.<Name>` runtimes, user then system). The first folder holding a name
//! wins. A theme counts when it has `gtk-4.0/gtk.css` or `gtk-3.0/gtk.css`
//! (12-settings-theme-onboarding.md#theme). All reads are bounded and blocking: async callers
//! run them in `spawn_blocking`.

use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::tokens::Scheme;

/// The longest theme name accepted, in bytes.
pub const MAX_NAME_BYTES: usize = 128;
/// The most themes listed.
pub const MAX_THEMES: usize = 1000;
/// The most entries read from one folder.
const MAX_ENTRIES: usize = 4096;
/// The prefix of a Flatpak GTK theme extension's runtime folder.
const FLATPAK_PREFIX: &str = "org.gtk.Gtk3theme.";
/// The stylesheet folders, the GTK 4 one first.
const VERSIONS: [&str; 2] = ["gtk-4.0", "gtk-3.0"];

/// An installed theme, as Settings lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct InstalledTheme {
    /// The theme's name, as `gtk-theme` and `ui.theme` give it.
    pub name: String,
    /// The folder it was found in.
    pub folder: String,
}

/// The stylesheets of one theme: `gtk.css`, and `gtk-dark.css` when it has one, from the same
/// GTK version folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThemeFiles {
    /// `gtk-4.0/gtk.css`, else `gtk-3.0/gtk.css`.
    pub light: PathBuf,
    /// `gtk-dark.css` beside it.
    pub dark: Option<PathBuf>,
}

impl ThemeFiles {
    /// The stylesheet for the desktop's preference: the dark one when the desktop prefers dark
    /// and the theme has one.
    pub fn for_scheme(&self, scheme: Option<Scheme>) -> &Path {
        match (&self.dark, scheme) {
            (Some(dark), Some(Scheme::Dark)) => dark,
            _ => &self.light,
        }
    }
}

/// The folders themes are looked up in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThemeDirs {
    folders: Vec<PathBuf>,
    flatpak: Vec<PathBuf>,
}

impl ThemeDirs {
    /// Theme folders (`<root>/<Name>/gtk-*/gtk.css`) and Flatpak runtime folders, in order.
    pub fn new(folders: Vec<PathBuf>, flatpak: Vec<PathBuf>) -> Self {
        Self { folders, flatpak }
    }

    /// The standard folders, from `HOME`, `XDG_DATA_HOME` and `XDG_DATA_DIRS` as `env` gives them.
    pub fn standard(env: impl Fn(&str) -> Option<OsString>) -> Self {
        let set = |key: &str| env(key).filter(|v| !v.is_empty());
        let home = set("HOME").map(PathBuf::from);
        let data_home =
            set("XDG_DATA_HOME").map(PathBuf::from).or_else(|| home.as_ref().map(|h| h.join(".local/share")));
        let data_dirs: Vec<PathBuf> = match set("XDG_DATA_DIRS") {
            Some(dirs) => xdg_dirs(&dirs),
            None => vec![PathBuf::from("/usr/local/share"), PathBuf::from("/usr/share")],
        };
        let mut folders = Vec::new();
        if let Some(d) = &data_home {
            folders.push(d.join("themes"));
        }
        if let Some(h) = &home {
            folders.push(h.join(".themes"));
        }
        folders.extend(data_dirs.iter().map(|d| d.join("themes")));
        let system = PathBuf::from("/usr/share/themes");
        if !folders.contains(&system) {
            folders.push(system);
        }
        let mut flatpak = Vec::new();
        if let Some(d) = &data_home {
            flatpak.push(d.join("flatpak/runtime"));
        }
        flatpak.push(PathBuf::from("/var/lib/flatpak/runtime"));
        Self { folders, flatpak }
    }

    /// Every installed theme with a GTK 3 or 4 stylesheet, each name once (the first folder
    /// wins), sorted by name ignoring case; at most [`MAX_THEMES`].
    #[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
    pub fn list(&self) -> Vec<InstalledTheme> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        let mut add = |name: String, root: &Path, out: &mut Vec<InstalledTheme>| {
            if out.len() < MAX_THEMES && seen.insert(name.clone()) {
                out.push(InstalledTheme { name, folder: root.display().to_string() });
            }
        };
        for root in &self.folders {
            for name in names(root) {
                if stylesheets(&root.join(&name)).is_some() {
                    add(name, root, &mut out);
                }
            }
        }
        for root in &self.flatpak {
            for entry in names(root) {
                if let Some(name) = entry.strip_prefix(FLATPAK_PREFIX)
                    && valid_name(name)
                    && flatpak_files(&root.join(&entry)).is_some()
                {
                    add(name.to_owned(), root, &mut out);
                }
            }
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.name.cmp(&b.name)));
        out
    }

    /// The stylesheets of the theme called `name`, from the first folder that has it; `None`
    /// for a name that isn't a plain folder name (no separators, no `..`, not hidden).
    pub fn find(&self, name: &str) -> Option<ThemeFiles> {
        if !valid_name(name) {
            return None;
        }
        self.folders.iter().find_map(|root| stylesheets(&root.join(name))).or_else(|| {
            self.flatpak.iter().find_map(|root| flatpak_files(&root.join(format!("{FLATPAK_PREFIX}{name}"))))
        })
    }
}

/// Whether `name` can only name a folder directly inside a theme root.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_BYTES
        && !name.starts_with('.')
        && !name.chars().any(|c| matches!(c, '/' | '\\' | ':' | '\0') || c.is_control())
}

/// The valid, visible entry names of a folder; nothing when it can't be read.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn names(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries.take(MAX_ENTRIES).filter_map(|e| e.ok()?.file_name().into_string().ok()).filter(|n| valid_name(n)).collect()
}

/// The folders of an `XDG_DATA_DIRS` value: split on `:`, as the XDG Base Directory spec defines
/// it, on every OS (not on the platform's `PATH` separator, `;` on Windows). Relative entries are
/// ignored, as the spec says; an entry counts as absolute when it starts at a root (`/a` on
/// Windows too).
fn xdg_dirs(value: &std::ffi::OsStr) -> Vec<PathBuf> {
    #[cfg(unix)]
    let parts: Vec<PathBuf> = {
        use std::os::unix::ffi::OsStrExt;
        value.as_bytes().split(|b| *b == b':').map(|p| PathBuf::from(std::ffi::OsStr::from_bytes(p))).collect()
    };
    // Outside Unix the value only ever comes from a test or a user who set it by hand.
    #[cfg(not(unix))]
    let parts: Vec<PathBuf> = value.to_string_lossy().split(':').map(PathBuf::from).collect();
    parts.into_iter().filter(|p| p.has_root()).collect()
}

/// `gtk-4.0/gtk.css`, else `gtk-3.0/gtk.css`, of a theme folder, with `gtk-dark.css` beside it.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn stylesheets(theme: &Path) -> Option<ThemeFiles> {
    let is_file = |p: &Path| std::fs::metadata(p).is_ok_and(|m| m.is_file());
    VERSIONS.iter().find_map(|version| {
        let light = theme.join(version).join("gtk.css");
        is_file(&light).then(|| {
            let dark = theme.join(version).join("gtk-dark.css");
            ThemeFiles { light, dark: is_file(&dark).then_some(dark) }
        })
    })
}

/// A Flatpak theme extension: `<runtime>/<arch>/<branch>/active/files/gtk-*/gtk.css`.
fn flatpak_files(runtime: &Path) -> Option<ThemeFiles> {
    names(runtime).into_iter().take(16).find_map(|arch| {
        let arch = runtime.join(arch);
        names(&arch).into_iter().take(16).find_map(|branch| stylesheets(&arch.join(branch).join("active/files")))
    })
}

#[cfg(test)]
#[path = "folders_tests.rs"]
mod tests;
